import AVFoundation
import CallKit
import Foundation
import Intents
import PushKit

/**
 Native side of P2P calls on iOS.

 - Every 1:1 call is reported to CallKit, so it rings with the system call UI
   (lock screen included), shows up in Phone → Recents
   (`includesCallsInRecents`), and can be returned from there.
 - PushKit VoIP pushes wake the app for an incoming call even when it is
   closed. iOS requires every VoIP push to be reported to CallKit right away,
   which `reportIncoming` always does — even for a call already over.
 - Media never goes through here: Agora and the call screens are untouched.

 JS learns about native events by pulling `drainEvents()` whenever the module
 signals "onCallEvent" (and once at startup), so an event that happens before
 JS is listening — e.g. Answer tapped while the app was launching — is never
 lost.
 */
final class CallKitManager: NSObject {
  static let shared = CallKitManager()

  private struct Call {
    var info: [String: Any]
    let incoming: Bool
    var answered = false
    var connected = false
  }

  private let provider: CXProvider
  private let controller = CXCallController()
  private var pushRegistry: PKPushRegistry?
  private(set) var voipToken: String?

  // Mutated on the main queue only.
  private var calls: [UUID: Call] = [:]
  private var finished = Set<UUID>()
  private var endingFromApp = Set<UUID>()

  private let eventsLock = NSLock()
  private var pendingEvents: [[String: Any]] = []

  weak var module: P2PCallSystemModule?
  private let defaults = UserDefaults.standard

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = true
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  // MARK: - Setup

  func startPushRegistry() {
    DispatchQueue.main.async {
      guard self.pushRegistry == nil else { return }
      let registry = PKPushRegistry(queue: .main)
      registry.delegate = self
      registry.desiredPushTypes = [.voIP]
      self.pushRegistry = registry
    }
  }

  func configure(apiUrl: String) {
    defaults.set(apiUrl, forKey: "p2pCallSystem.apiUrl")
  }

  // MARK: - Events to JS

  private func enqueue(_ event: [String: Any]) {
    eventsLock.lock()
    pendingEvents.append(event)
    eventsLock.unlock()
    module?.signal()
  }

  func drainEvents() -> [[String: Any]] {
    eventsLock.lock()
    defer { eventsLock.unlock() }
    let events = pendingEvents
    pendingEvents.removeAll()
    return events
  }

  // MARK: - Incoming

  /// Rings an incoming call through CallKit. Idempotent per call id.
  func reportIncoming(uuid: UUID, info: [String: Any], completion: (() -> Void)? = nil) {
    if calls[uuid] != nil {
      completion?()
      return
    }
    let alreadyOver = finished.contains(uuid) || info["callId"] == nil
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: (info["callerId"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "p2p")
    update.localizedCallerName = (info["callerName"] as? String) ?? "P2P Global"
    update.hasVideo = (info["callType"] as? String) == "video"
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    calls[uuid] = Call(info: info, incoming: true)
    rememberPeer(info)

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      DispatchQueue.main.async {
        guard let self = self else { completion?(); return }
        if let error = error as? CXErrorCodeIncomingCallError, error.code == .callUUIDAlreadyExists {
          // Already ringing (push and realtime both reported it).
        } else if error != nil {
          self.calls.removeValue(forKey: uuid)
        } else if alreadyOver {
          // Reported because iOS requires it for every VoIP push; it's over.
          self.finish(uuid, reason: .remoteEnded)
        } else {
          DispatchQueue.main.asyncAfter(deadline: .now() + 45) { [weak self] in
            guard let self = self, let call = self.calls[uuid], !call.answered else { return }
            self.finish(uuid, reason: .unanswered)
          }
        }
        completion?()
      }
    }
  }

  func reportIncomingFromApp(_ info: [String: Any]) {
    guard let id = info["callId"] as? String, let uuid = UUID(uuidString: id) else { return }
    DispatchQueue.main.async { self.reportIncoming(uuid: uuid, info: info) }
  }

  func answerFromApp(_ callId: String) {
    guard let uuid = UUID(uuidString: callId) else { return }
    DispatchQueue.main.async {
      guard let call = self.calls[uuid], call.incoming, !call.answered else { return }
      self.controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { _ in }
    }
  }

  // MARK: - Outgoing

  func startOutgoing(_ info: [String: Any]) {
    guard let id = info["callId"] as? String, let uuid = UUID(uuidString: id) else { return }
    DispatchQueue.main.async {
      guard self.calls[uuid] == nil, !self.finished.contains(uuid) else { return }
      let peerId = (info["callerId"] as? String) ?? (info["peerId"] as? String) ?? "p2p"
      let name = (info["callerName"] as? String) ?? (info["peerName"] as? String) ?? "P2P Global"
      let isVideo = (info["callType"] as? String) == "video"
      self.calls[uuid] = Call(info: info, incoming: false)
      self.rememberPeer(info)
      let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: peerId.isEmpty ? "p2p" : peerId))
      action.isVideo = isVideo
      action.contactIdentifier = name
      self.controller.request(CXTransaction(action: action)) { [weak self] error in
        DispatchQueue.main.async {
          guard let self = self else { return }
          if error != nil {
            self.calls.removeValue(forKey: uuid)
            return
          }
          let update = CXCallUpdate()
          update.localizedCallerName = name
          update.hasVideo = isVideo
          update.supportsHolding = false
          update.supportsDTMF = false
          self.provider.reportCall(with: uuid, updated: update)
        }
      }
    }
  }

  func reportConnected(_ callId: String) {
    guard let uuid = UUID(uuidString: callId) else { return }
    DispatchQueue.main.async {
      guard var call = self.calls[uuid], !call.connected else { return }
      call.connected = true
      self.calls[uuid] = call
      if !call.incoming {
        self.provider.reportOutgoingCall(with: uuid, connectedAt: Date())
      }
    }
  }

  // MARK: - Ending

  /// Ends a call for the app's CallEndReason. A hang-up in the app goes
  /// through a CallKit transaction (recorded as ended by this user);
  /// everything else is reported with the matching CallKit reason, which
  /// is what Recents shows (e.g. an unanswered incoming call as missed).
  func endFromApp(_ callId: String, reason: String) {
    guard let uuid = UUID(uuidString: callId) else { return }
    DispatchQueue.main.async {
      guard let call = self.calls[uuid] else {
        self.finished.insert(uuid)
        return
      }
      if reason == "answered_elsewhere" && call.answered { return }
      switch reason {
      case "local_end", "user", "declined":
        self.endingFromApp.insert(uuid)
        self.controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { [weak self] error in
          if error != nil {
            DispatchQueue.main.async {
              self?.endingFromApp.remove(uuid)
              self?.finish(uuid, reason: .remoteEnded)
            }
          }
        }
      case "remote_end", "busy", "remote_declined":
        self.finish(uuid, reason: .remoteEnded)
      case "missed", "cancelled", "no_answer", "timeout":
        self.finish(uuid, reason: .unanswered)
      case "answered_elsewhere":
        self.finish(uuid, reason: .answeredElsewhere)
      case "declined_elsewhere":
        self.finish(uuid, reason: .declinedElsewhere)
      default:
        self.finish(uuid, reason: .failed)
      }
    }
  }

  private func finish(_ uuid: UUID, reason: CXCallEndedReason) {
    guard calls.removeValue(forKey: uuid) != nil else { return }
    finished.insert(uuid)
    provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
  }

  // MARK: - Returning a call from Recents

  private func rememberPeer(_ info: [String: Any]) {
    guard let peerId = (info["callerId"] as? String) ?? (info["peerId"] as? String), !peerId.isEmpty else { return }
    var peers = defaults.dictionary(forKey: "p2pCallSystem.peers") as? [String: [String: String]] ?? [:]
    peers[peerId] = [
      "peerName": (info["callerName"] as? String) ?? (info["peerName"] as? String) ?? "",
      "callType": (info["callType"] as? String) ?? "audio",
    ]
    if peers.count > 300, let first = peers.keys.first { peers.removeValue(forKey: first) }
    defaults.set(peers, forKey: "p2pCallSystem.peers")
  }

  /// Phone → Recents → tap a P2P call: iOS opens the app with a start-call
  /// intent whose handle is the person's P2P user id.
  func handleUserActivity(_ activity: NSUserActivity) -> Bool {
    guard let intent = activity.interaction?.intent else { return false }
    var handle: String?
    var video = false
    if let start = intent as? INStartCallIntent {
      handle = start.contacts?.first?.personHandle?.value
      video = start.callCapability == .videoCall
    } else if let start = intent as? INStartVideoCallIntent {
      handle = start.contacts?.first?.personHandle?.value
      video = true
    } else if let start = intent as? INStartAudioCallIntent {
      handle = start.contacts?.first?.personHandle?.value
    }
    guard let peerId = handle, !peerId.isEmpty, peerId != "p2p" else { return false }
    let saved = (defaults.dictionary(forKey: "p2pCallSystem.peers") as? [String: [String: String]])?[peerId]
    enqueue([
      "type": "callBack",
      "peerId": peerId,
      "peerName": saved?["peerName"] ?? "",
      "callType": video ? "video" : (saved?["callType"] ?? "audio"),
    ])
    return true
  }

  // MARK: - Decline without JS

  private func postNativeDecline(_ info: [String: Any]) {
    guard let base = defaults.string(forKey: "p2pCallSystem.apiUrl"),
          let callId = info["callId"] as? String,
          let token = info["declineToken"] as? String, !token.isEmpty,
          let url = URL(string: "\(base)/calls/native-decline") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["callId": callId, "token": token])
    request.timeoutInterval = 10
    URLSession.shared.dataTask(with: request).resume()
  }
}

// MARK: - CXProviderDelegate

extension CallKitManager: CXProviderDelegate {
  func providerDidReset(_ provider: CXProvider) {
    calls.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard var call = calls[action.callUUID] else {
      action.fail()
      return
    }
    call.answered = true
    calls[action.callUUID] = call
    enqueue(["type": "answered", "call": call.info])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let uuid = action.callUUID
    let call = calls.removeValue(forKey: uuid)
    finished.insert(uuid)
    if endingFromApp.remove(uuid) != nil {
      action.fulfill()
      return
    }
    if let call = call {
      let callId = uuid.uuidString.lowercased()
      if call.incoming && !call.answered {
        postNativeDecline(call.info)
        enqueue(["type": "declined", "callId": callId])
      } else {
        enqueue(["type": "ended", "callId": callId, "reason": "local_end"])
      }
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    enqueue(["type": "muted", "callId": action.callUUID.uuidString.lowercased(), "muted": action.isMuted])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}

// MARK: - PKPushRegistryDelegate

extension CallKitManager: PKPushRegistryDelegate {
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    enqueue(["type": "voipToken", "token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    voipToken = nil
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let info = payload.dictionaryPayload["p2pCall"] as? [String: Any] ?? [:]
    let uuid = (info["callId"] as? String).flatMap { UUID(uuidString: $0) } ?? UUID()
    reportIncoming(uuid: uuid, info: info, completion: completion)
  }
}
