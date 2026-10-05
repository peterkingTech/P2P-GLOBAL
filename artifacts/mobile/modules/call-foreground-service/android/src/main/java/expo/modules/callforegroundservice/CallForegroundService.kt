package expo.modules.callforegroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Stage 26B — Android foreground service for an ACTIVE (already-connected)
 * P2P Agora call. Its only job is to keep this process from being
 * suspended/throttled by the OS while the app is backgrounded during a
 * call; it does not touch Agora, the engine, or any call logic itself —
 * see hooks/useAgoraEngine.native.ts and lib/callBackgroundSupport.ts for
 * how it is started/stopped from the existing call lifecycle.
 *
 * Started only once a call reaches its existing "connected" state (never
 * at ring/connecting time) and stopped through the existing termination
 * path — see the call screens (audio.tsx/video.tsx/group.tsx) for the
 * exact call sites.
 */
class CallForegroundService : Service() {
  companion object {
    private const val CHANNEL_ID = "p2p_active_call"
    private const val NOTIFICATION_ID = 7301
    private const val ACTION_START = "expo.modules.callforegroundservice.action.START"
    private const val ACTION_STOP = "expo.modules.callforegroundservice.action.STOP"
    private const val EXTRA_IS_VIDEO = "isVideo"

    /** Safe to call repeatedly — re-entering while already running only
     * updates the existing notification, never creates a duplicate service
     * instance (Android itself guarantees at most one live instance of a
     * given Service subclass per process). */
    fun start(context: Context, isVideo: Boolean) {
      val intent = Intent(context, CallForegroundService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_IS_VIDEO, isVideo)
      // Android 12+ throws ForegroundServiceStartNotAllowedException when the
      // app is in the background at this moment (e.g. the call connected
      // after the user switched apps). The call itself must carry on; it
      // just runs without background protection.
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        android.util.Log.w("CallForegroundService", "start refused: ${e.message}")
      }
    }

    /** Safe to call even if the service was never started, and safe to
     * call more than once. stopService never starts anything, so unlike
     * startService(ACTION_STOP) it can't hit Android 8+'s background-start
     * restriction when a call ends while the app is in the background. */
    fun stop(context: Context) {
      context.stopService(Intent(context, CallForegroundService::class.java))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      @Suppress("DEPRECATION")
      stopForeground(true)
      stopSelf()
      return START_NOT_STICKY
    }

    val isVideo = intent?.getBooleanExtra(EXTRA_IS_VIDEO, false) ?: false
    createChannelIfNeeded()
    val notification = buildNotification()
    // On Android 14+ a microphone/camera service can only enter the
    // foreground while the app itself is in use (and camera needs its
    // runtime permission). An uncaught SecurityException here would crash
    // the app mid-call; stopping quietly keeps the call running in the
    // foreground as before.
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val type = if (isVideo) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        } else {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        startForeground(NOTIFICATION_ID, notification, type)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      android.util.Log.w("CallForegroundService", "startForeground refused: ${e.message}")
      stopSelf()
    }
    // START_NOT_STICKY: if the OS kills this process outright, the service
    // must not be automatically restarted with a stale/no-op intent — the
    // call screen (still mounted, or already gone) is the only correct
    // source of truth for whether a call is genuinely still active.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannelIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        // IMPORTANCE_LOW: visible and persistent (required for a
        // foreground-service notification), but silent — this is
        // deliberately distinct from the existing "calls" channel
        // (lib/push.ts, MAX importance, used only for the *incoming* call
        // ring) and must never be confused with it.
        val channel = NotificationChannel(CHANNEL_ID, "Active call", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
      }
    }
  }

  private fun buildNotification(): Notification {
    // Deliberately generic — no caller name, no call/channel identifiers.
    // This notification is visible on the lock screen by default; it must
    // never leak private content (matches the existing incoming-call
    // notification's own content restraint).
    // Tapping it brings the existing app task (and the call screen still
    // mounted in it) back to the front.
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("P2P Call")
      .setContentText("Call in progress")
      .setSmallIcon(applicationInfo.icon)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }
}
