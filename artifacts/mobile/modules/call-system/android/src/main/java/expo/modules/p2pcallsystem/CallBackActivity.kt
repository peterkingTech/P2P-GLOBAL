package expo.modules.p2pcallsystem

import android.app.Activity
import android.net.Uri
import android.os.Bundle

/**
 * android.telecom.action.CALL_BACK — the user chose to return a P2P call
 * from the system call log (Android 16.1+ unified call history). The intent
 * carries Telecom's id for the original call; CallSystem remembered who that
 * call was with, so this starts a new P2P call of the same type to them via
 * the app's /call/callback route.
 */
class CallBackActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val extras = intent?.extras
    // TelecomManager.EXTRA_UUID (API 36.1) — read by key rather than the
    // constant so this compiles against compileSdk 36.
    val telecomCallId = extras?.keySet()
      ?.firstOrNull { it.endsWith("UUID", ignoreCase = true) }
      ?.let { key -> extras.get(key)?.toString() }
    val peer = telecomCallId?.let { CallSystem.peerForTelecomCall(this, it) }
    val scheme = CallSystem.scheme(this)
    val uri = if (peer != null && peer.optString("peerId").isNotEmpty()) {
      Uri.Builder().scheme(scheme).authority("call").appendPath("callback")
        .appendQueryParameter("peerId", peer.optString("peerId"))
        .appendQueryParameter("peerName", peer.optString("peerName"))
        .appendQueryParameter("callType", peer.optString("callType", "audio"))
        .build()
    } else {
      // Unknown call — open the app's own call history instead.
      Uri.Builder().scheme(scheme).authority("call").appendPath("history").build()
    }
    CallSystem.openApp(this, uri)
    finish()
  }
}
