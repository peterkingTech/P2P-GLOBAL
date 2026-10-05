package expo.modules.p2pcallsystem

import android.app.ActivityManager
import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Takes over expo-notifications' FCM service (see app.plugin.js) so a call
 * push can ring natively even when the app is closed — FCM starts this
 * service on its own for a high-priority message. Everything that isn't
 * call signalling goes to Expo's handling unchanged.
 *
 * Expo's push service puts our payload, as JSON, in the message's "body".
 */
class P2PFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    try {
      if (!CallSystem.enabled(applicationContext)) {
        super.onMessageReceived(remoteMessage)
        return
      }
      val body = remoteMessage.data["body"]?.let { JSONObject(it) }
      when (body?.optString("notificationType")) {
        "incoming_call" -> {
          val info = CallInfo.fromJson(body)
          val isInvitation = body.has("invitationId") && !body.isNull("invitationId") && body.optString("invitationId").isNotEmpty()
          // Crisis calls can't be declined and group invitations are a
          // different flow: both keep the app's existing handling.
          if (info != null && info.callType != "crisis" && !isInvitation) {
            // In the foreground the app's own ringing screen shows the call;
            // Telecom still needs to know about it.
            CallSystem.reportIncoming(applicationContext, info, showUi = !appInForeground())
            return
          }
        }
        "call_state" -> {
          CallSystem.endFromServer(applicationContext, body.optString("callId"), body.optString("status"))
          return
        }
      }
    } catch (e: Exception) {
      Log.w("P2PCallSystem", "call push handling failed; passing to Expo", e)
    }
    super.onMessageReceived(remoteMessage)
  }

  private fun appInForeground(): Boolean {
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    return state.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }
}
