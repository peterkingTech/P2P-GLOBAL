package expo.modules.p2pcallsystem

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat

/**
 * The ringing notification for an incoming call: Android's call-style
 * notification (caller, audio/video, Answer/Decline), a full-screen intent
 * that shows [IncomingCallActivity] over the lock screen, and a ringtone
 * that loops until the call is answered, declined or stops ringing.
 */
object IncomingCallNotifier {
  // A channel's sound can't change once created — new sound, new id.
  private const val CHANNEL_ID = "p2p_incoming_call_ring_v1"

  private fun notificationId(callId: String): Int = 0x50320000 xor callId.hashCode()

  private fun requestCode(callId: String, slot: Int): Int = callId.hashCode() * 31 + slot

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Incoming P2P calls", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "Rings when someone calls you on P2P Global"
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    channel.enableVibration(true)
    channel.vibrationPattern = longArrayOf(0, 1000, 800, 1000, 800)
    channel.setSound(
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    )
    manager.createNotificationChannel(channel)
  }

  fun show(context: Context, info: CallInfo) {
    try {
      ensureChannel(context)
      val immutable = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      val fullScreen = PendingIntent.getActivity(
        context, requestCode(info.callId, 1), IncomingCallActivity.intent(context, info, autoAccept = false), immutable
      )
      // Answer opens an activity directly — Android 12+ blocks starting an
      // activity from a broadcast receiver behind a notification action.
      val answer = PendingIntent.getActivity(
        context, requestCode(info.callId, 2), IncomingCallActivity.intent(context, info, autoAccept = true), immutable
      )
      val decline = PendingIntent.getBroadcast(
        context, requestCode(info.callId, 3),
        Intent(context, CallActionReceiver::class.java)
          .setAction(CallActionReceiver.ACTION_DECLINE)
          .putExtra(CallActionReceiver.EXTRA_CALL_ID, info.callId),
        immutable
      )
      val callerBuilder = Person.Builder().setName(info.peerName).setImportant(true)
      // The caller's photo as the call notification's avatar, once cached.
      CallPhotoCache.cached(context, info.photoUrl)?.let { callerBuilder.setIcon(IconCompat.createWithBitmap(it)) }
      val caller = callerBuilder.build()
      val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(info.peerName)
        .setContentText(if (info.isVideo) "Incoming video call" else "Incoming audio call")
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setAutoCancel(false)
        // The push and the app's realtime listener can both report one call.
        .setOnlyAlertOnce(true)
        .setContentIntent(fullScreen)
        .setFullScreenIntent(fullScreen, true)
        .setTimeoutAfter(CallSystem.RING_TIMEOUT_MS)
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(info.isVideo))
        .build()
      // Loop the ringtone until the notification is cancelled.
      notification.flags = notification.flags or Notification.FLAG_INSISTENT
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(notificationId(info.callId), notification)
    } catch (e: Exception) {
      // e.g. notification permission revoked — nothing more can ring here.
      Log.w("P2PCallSystem", "incoming call notification failed", e)
    }
  }

  fun cancel(context: Context, callId: String) {
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(notificationId(callId))
    } catch (_: Exception) { }
  }
}
