import Intents
import UIKit
import UserNotifications

// P2P Global — iOS Notification Service Extension.
//
// Runs when a push with `mutable-content` arrives (the API sets it only when
// there is a sender photo or a preview token). Expo delivers our data in
// userInfo["body"]: routing fields (notificationId, conversationId, …), the
// sender photo at ["_richContent"]["image"], and — only for recipients who
// chose "Name and message" — a short-lived ["previewToken"].
//
//  1. Photo + preview are fetched in parallel (each with its own timeout):
//     - the photo becomes a Communication Notification (photo + name) or, if
//       that isn't possible, an image attachment;
//     - the token is exchanged at POST <P2PApiBaseURL>/notifications/preview
//       (header X-P2P-Preview-Token). The server re-checks recipient,
//       membership, deletion and the CURRENT privacy level; anything else is
//       a 404 and we simply show the notification as sent.
//  2. Voice: downloaded only from P2PTrustedMediaHost's voice-messages
//     storage, only up to 5 MB (Apple's audio attachment limit), attached as
//     m4a. Longer → the long-press view says to open the app.
//     The server's `display` decides where text may appear: "banner"
//     (Name and message) also puts it in the banner; "hold" (Name, reveal
//     message on hold) keeps the banner generic — text only in the
//     press-and-hold view. Missing/unknown → "hold".
//  3. userInfo["p2pPreview"] tells the long-press view (Notification Content
//     Extension) what it may show. Routing data in userInfo["body"] is never
//     changed, nor badge or sound.
// Any error → the original notification. On the system timeout → the
// ORIGINAL notification (never a half-built one).
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?
  private var tempDirs: [URL] = []
  private let lock = NSLock()

  private static let audioLimitBytes = 5 * 1024 * 1024
  private static let photoLimitBytes = 5 * 1024 * 1024
  private static let maxPreviewText = 1000
  private static let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.urlCache = nil
    c.httpCookieStorage = nil
    c.timeoutIntervalForRequest = 8
    c.timeoutIntervalForResource = 12
    return URLSession(configuration: c)
  }()

  private struct Preview {
    var kind: String          // "text" | "voice"
    var display: String       // "banner" (Name and message) | "hold" (reveal on hold)
    var text: String?
    var voiceURL: URL?
    var durationSeconds: Int?
  }

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    self.original = request.content
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      finish(request.content)
      return
    }

    let body = request.content.userInfo["body"] as? [String: Any] ?? [:]
    let rich = body["_richContent"] as? [String: Any]
    let photoURL = Self.httpsURL(rich?["image"])
    var token: String? = nil
    if let t = body["previewToken"] as? String, !t.isEmpty, t.count <= 1024 { token = t }
    let apiBase = Self.config("P2PApiBaseURL").flatMap { Self.httpsURL($0) }

    var photoData: Data? = nil
    var preview: Preview? = nil
    let group = DispatchGroup()
    if let photoURL = photoURL {
      group.enter()
      fetchData(photoURL, limit: Self.photoLimitBytes) { data in
        self.lock.lock(); photoData = data; self.lock.unlock()
        group.leave()
      }
    }
    if let token = token, let apiBase = apiBase {
      group.enter()
      fetchPreview(apiBase: apiBase, token: token) { p in
        self.lock.lock(); preview = p; self.lock.unlock()
        group.leave()
      }
    }
    group.notify(queue: DispatchQueue.global(qos: .userInitiated)) {
      self.lock.lock(); let photo = photoData; let pv = preview; self.lock.unlock()
      self.complete(content, body: body, photo: photo, preview: pv)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    // Out of time: show the notification exactly as it was sent.
    if let original = original { finish(original) }
  }

  // MARK: - Assembly

  private func complete(_ content: UNMutableNotificationContent, body: [String: Any], photo: Data?, preview: Preview?) {
    var p2p: [String: Any] = ["v": 1]
    if let photo = photo, let thumb = Self.thumbnail(photo) { p2p["photo"] = thumb.base64EncodedString() }

    let finishWith: (Bool) -> Void = { voiceAttached in
      if let pv = preview {
        p2p["kind"] = pv.kind
        if let d = pv.durationSeconds { p2p["durationSeconds"] = d }
        p2p["display"] = pv.display
        if pv.kind == "text", let text = pv.text {
          p2p["text"] = text // shown in the press-and-hold view
          if pv.display == "banner" {
            content.body = text // "Name and message" only; iOS still hides it per their lock-screen setting
          }
        }
        if pv.kind == "voice" {
          p2p["voiceAttached"] = voiceAttached
          if !voiceAttached { p2p["voiceTooLong"] = pv.voiceURL != nil }
        }
      }
      var info = content.userInfo
      info["p2pPreview"] = p2p
      content.userInfo = info

      if let photo = photo, let updated = self.communicationContent(content, body: body, imageData: photo) {
        self.finish(updated)
        return
      }
      if let photo = photo, !voiceAttached, let a = self.attachment(data: photo, name: "sender.jpg", identifier: "sender-photo", typeHint: nil) {
        content.attachments = [a] + content.attachments
      }
      self.finish(content)
    }

    if let pv = preview, pv.kind == "voice", let url = pv.voiceURL {
      downloadVoice(url) { file in
        if let file = file, let a = try? UNNotificationAttachment(identifier: "voice", url: file, options: [UNNotificationAttachmentOptionsTypeHintKey: "public.mpeg-4-audio"]) {
          content.attachments = [a]
          finishWith(true)
        } else {
          finishWith(false)
        }
      }
    } else {
      finishWith(false)
    }
  }

  private func finish(_ content: UNNotificationContent) {
    lock.lock()
    let handler = contentHandler
    contentHandler = nil
    let dirs = tempDirs
    tempDirs = []
    lock.unlock()
    guard let handler = handler else { return }
    handler(content)
    // Attachments are moved into the system's store on delivery; anything
    // left in our temp folders is ours to remove.
    for d in dirs { try? FileManager.default.removeItem(at: d) }
  }

  // MARK: - Network (HTTPS only, bounded)

  private func fetchData(_ url: URL, limit: Int, completion: @escaping (Data?) -> Void) {
    Self.session.dataTask(with: url) { data, response, _ in
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
            let data = data, !data.isEmpty, data.count <= limit else { completion(nil); return }
      completion(data)
    }.resume()
  }

  private func fetchPreview(apiBase: URL, token: String, completion: @escaping (Preview?) -> Void) {
    var req = URLRequest(url: apiBase.appendingPathComponent("notifications").appendingPathComponent("preview"))
    req.httpMethod = "POST"
    req.setValue(token, forHTTPHeaderField: "X-P2P-Preview-Token")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    Self.session.dataTask(with: req) { data, response, _ in
      guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data = data, data.count <= 64 * 1024,
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let kind = json["kind"] as? String else { completion(nil); return }
      // Anything but an explicit "banner" keeps the text out of the banner.
      let display = (json["display"] as? String) == "banner" ? "banner" : "hold"
      if kind == "text", let raw = json["text"] as? String {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { completion(nil); return }
        completion(Preview(kind: "text", display: display, text: String(text.prefix(Self.maxPreviewText)), voiceURL: nil, durationSeconds: nil))
        return
      }
      if kind == "voice" {
        let voice = json["voice"] as? [String: Any]
        let url = Self.trustedVoiceURL(voice?["url"])
        var duration: Int? = nil
        if let d = voice?["durationSeconds"] as? NSNumber, d.doubleValue > 0, d.doubleValue < 86_400 { duration = d.intValue }
        completion(Preview(kind: "voice", display: display, text: nil, voiceURL: url, durationSeconds: duration))
        return
      }
      completion(nil)
    }.resume()
  }

  private func downloadVoice(_ url: URL, completion: @escaping (URL?) -> Void) {
    Self.session.downloadTask(with: url) { location, response, _ in
      guard let location = location, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { completion(nil); return }
      if http.expectedContentLength > Int64(Self.audioLimitBytes) { completion(nil); return }
      let size = ((try? FileManager.default.attributesOfItem(atPath: location.path))?[.size] as? NSNumber)?.intValue ?? Int.max
      guard size > 0, size <= Self.audioLimitBytes, let dir = self.makeTempDir() else { completion(nil); return }
      let dest = dir.appendingPathComponent("voice.m4a")
      do { try FileManager.default.moveItem(at: location, to: dest); completion(dest) } catch { completion(nil) }
    }.resume()
  }

  // MARK: - Helpers

  // Communication Notifications need iOS 15+; the app's minimum is 16.4.
  private func communicationIntent(_ content: UNMutableNotificationContent, body: [String: Any], imageData: Data) -> INSendMessageIntent? {
    let senderId = (body["senderId"] ?? body["fromUserId"] ?? body["responderId"] ?? body["learnerId"] ?? body["requesterId"]) as? String
    guard let senderId = senderId, !content.title.isEmpty else { return nil }
    let image = INImage(imageData: imageData)
    let sender = INPerson(
      personHandle: INPersonHandle(value: senderId, type: .unknown),
      nameComponents: nil,
      displayName: content.title,
      image: image,
      contactIdentifier: nil,
      customIdentifier: senderId
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: (body["conversationId"] as? String) ?? senderId,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    intent.setImage(image, forParameterNamed: \.sender)
    return intent
  }

  private func communicationContent(_ content: UNMutableNotificationContent, body: [String: Any], imageData: Data) -> UNNotificationContent? {
    guard let intent = communicationIntent(content, body: body, imageData: imageData) else { return nil }
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate(completion: nil)
    return try? content.updating(from: intent)
  }

  private func attachment(data: Data, name: String, identifier: String, typeHint: String?) -> UNNotificationAttachment? {
    guard let dir = makeTempDir() else { return nil }
    let file = dir.appendingPathComponent(name)
    do {
      try data.write(to: file)
      var options: [AnyHashable: Any]? = nil
      if let typeHint = typeHint { options = [UNNotificationAttachmentOptionsTypeHintKey: typeHint] }
      return try UNNotificationAttachment(identifier: identifier, url: file, options: options)
    } catch {
      return nil
    }
  }

  private func makeTempDir() -> URL? {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString, isDirectory: true)
    do { try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) } catch { return nil }
    lock.lock(); tempDirs.append(dir); lock.unlock()
    return dir
  }

  /// A small JPEG of the sender photo for the long-press view (~120 px).
  private static func thumbnail(_ data: Data) -> Data? {
    guard let image = UIImage(data: data) else { return nil }
    let side: CGFloat = 120
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
    let scaled = renderer.image { _ in
      let s = image.size
      let scale = max(side / max(s.width, 1), side / max(s.height, 1))
      let w = s.width * scale, h = s.height * scale
      image.draw(in: CGRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
    }
    return scaled.jpegData(compressionQuality: 0.8)
  }

  private static func config(_ key: String) -> String? {
    guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String, !v.isEmpty, !v.hasPrefix("__") else { return nil }
    return v
  }

  private static func httpsURL(_ raw: Any?) -> URL? {
    guard let s = raw as? String, s.count <= 2048, let url = URL(string: s), url.scheme == "https", url.host != nil else { return nil }
    return url
  }

  /// Voice links only from our own public voice-messages storage.
  private static func trustedVoiceURL(_ raw: Any?) -> URL? {
    guard let url = httpsURL(raw), let host = config("P2PTrustedMediaHost"), url.host == host,
          url.user == nil, url.password == nil,
          url.path.hasPrefix("/storage/v1/object/public/voice-messages/"), !url.path.contains("..") else { return nil }
    return url
  }
}
