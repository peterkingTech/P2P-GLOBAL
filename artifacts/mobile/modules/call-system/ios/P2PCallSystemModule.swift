import ExpoModulesCore

/// JS bridge — see lib/callSystem.ts for how the app uses it.
public class P2PCallSystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("P2PCallSystem")

    // A signal only: JS then pulls consumePendingEvents(), so nothing that
    // happened before JS started listening is lost.
    Events("onCallEvent")

    OnCreate {
      CallKitManager.shared.module = self
      CallKitManager.shared.startPushRegistry()
    }

    Function("isSupported") { true }

    Function("configure") { (apiUrl: String, _: String, _: Bool) in
      CallKitManager.shared.configure(apiUrl: apiUrl)
    }

    Function("reportIncomingCall") { (info: [String: Any], _: Bool) in
      CallKitManager.shared.reportIncomingFromApp(info)
    }

    Function("answerCall") { (callId: String) in
      CallKitManager.shared.answerFromApp(callId)
    }

    Function("startOutgoingCall") { (info: [String: Any]) in
      CallKitManager.shared.startOutgoing(info)
    }

    Function("reportConnected") { (callId: String) in
      CallKitManager.shared.reportConnected(callId)
    }

    Function("endCall") { (callId: String, reason: String) in
      CallKitManager.shared.endFromApp(callId, reason: reason)
    }

    Function("getVoipToken") { () -> String? in
      CallKitManager.shared.voipToken
    }

    Function("consumePendingEvents") { () -> [[String: Any]] in
      CallKitManager.shared.drainEvents()
    }
  }

  func signal() {
    sendEvent("onCallEvent", [:])
  }
}
