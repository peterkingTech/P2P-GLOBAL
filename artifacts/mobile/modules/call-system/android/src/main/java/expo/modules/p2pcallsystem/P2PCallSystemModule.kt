package expo.modules.p2pcallsystem

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS bridge — see lib/callSystem.ts for how the app uses it. */
class P2PCallSystemModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  fun emit(name: String, payload: Map<String, Any?>) {
    try { sendEvent(name, payload) } catch (_: Exception) { }
  }

  override fun definition() = ModuleDefinition {
    Name("P2PCallSystem")

    Events("onCallAnswered", "onCallDeclined", "onCallEnded", "onCallBack", "onVoipToken")

    OnCreate { CallSystem.module = this@P2PCallSystemModule }
    OnDestroy { if (CallSystem.module === this@P2PCallSystemModule) CallSystem.module = null }

    Function("isSupported") { CallSystem.isSupported() }

    Function("configure") { apiUrl: String, scheme: String, enabled: Boolean ->
      CallSystem.configure(context, apiUrl, scheme, enabled)
    }

    Function("reportIncomingCall") { info: Map<String, Any?>, showUi: Boolean ->
      CallInfo.fromMap(info)?.let { CallSystem.reportIncoming(context, it, showUi) }
    }

    Function("answerCall") { callId: String -> CallSystem.answer(context, callId) }

    Function("startOutgoingCall") { info: Map<String, Any?> ->
      CallInfo.fromMap(info)?.let { CallSystem.startOutgoing(context, it) }
    }

    Function("reportConnected") { callId: String -> CallSystem.reportConnected(callId) }

    Function("endCall") { callId: String, reason: String -> CallSystem.end(context, callId, reason) }

    // iOS-only concepts; present so the JS API is identical on both platforms.
    Function("getVoipToken") { null as String? }
    Function("consumePendingEvents") { emptyList<Map<String, Any?>>() }
  }
}
