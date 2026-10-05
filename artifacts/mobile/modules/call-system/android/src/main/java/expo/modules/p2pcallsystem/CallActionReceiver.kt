package expo.modules.p2pcallsystem

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Decline pressed on the incoming-call notification. Works with no JS running. */
class CallActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_DECLINE = "expo.modules.p2pcallsystem.action.DECLINE"
    const val EXTRA_CALL_ID = "callId"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_DECLINE) return
    val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return
    CallSystem.decline(context.applicationContext, callId)
  }
}
