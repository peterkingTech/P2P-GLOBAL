package expo.modules.p2pcallsystem

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.telecom.DisconnectCause
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallsManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Native side of P2P calls on Android.
 *
 * - Every 1:1 call (incoming and outgoing) is registered with Telecom through
 *   Jetpack core-telecom, as a self-managed VoIP call. That is what makes the
 *   OS treat it as a phone call (other calls, Bluetooth/car/watch controls)
 *   and, on Android 16.1+, what puts it in the system call log.
 * - An incoming call rings natively — notification with a full-screen
 *   lock-screen UI and a looping ringtone — so it rings while the app is in
 *   the background or closed (the push reaches P2PFirebaseMessagingService).
 * - Media never goes through here: Agora and the existing call screens are
 *   untouched. This only tells the OS what state the call is in.
 */
object CallSystem {
  private const val TAG = "P2PCallSystem"
  private const val PREFS = "p2p_call_system"
  // Mirrors the server's no-answer sweep (lib/callSweep.ts, 45s); the server
  // normally stops the ringing first via a call_state push.
  const val RING_TIMEOUT_MS = 45_000L

  private sealed class Action {
    object Answer : Action()
    object Active : Action()
    data class Disconnect(val code: Int) : Action()
  }

  private class ActiveCall(val info: CallInfo, val incoming: Boolean) {
    val actions = Channel<Action>(Channel.UNLIMITED)
    @Volatile var answered = false
    @Volatile var connected = false
    var timeoutJob: Job? = null
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val calls = ConcurrentHashMap<String, ActiveCall>()
  // Calls already over — a late push/realtime report for one must not ring.
  private val finished: MutableSet<String> = java.util.Collections.newSetFromMap(ConcurrentHashMap())
  private var callsManager: CallsManager? = null
  @Volatile var module: P2PCallSystemModule? = null

  /** core-telecom needs Android 8.0 (API 26). */
  fun isSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

  fun isRinging(callId: String): Boolean = calls[callId]?.let { it.incoming && !it.answered } ?: false

  // ── configuration persisted for code that runs without JS ──────────────
  fun configure(context: Context, apiUrl: String, scheme: String, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("apiUrl", apiUrl).putString("scheme", scheme).putBoolean("enabled", enabled).apply()
  }

  /**
   * Server-controlled switch (GET /calls/config, env NATIVE_CALLS_ANDROID).
   * When off, call pushes go back to expo-notifications exactly as before.
   */
  fun enabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", true)

  fun scheme(context: Context): String =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("scheme", null) ?: "p2pglobalbiblestudy"

  private fun apiUrl(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("apiUrl", null)

  // ── incoming ───────────────────────────────────────────────────────────
  /**
   * Report a ringing call. Idempotent per callId: the push and the app's
   * realtime listener can both report the same call. [showUi] = ring
   * natively (app not in the foreground); false = the app's own ringing
   * screen is showing it and Telecom only needs to know.
   */
  fun reportIncoming(context: Context, info: CallInfo, showUi: Boolean) {
    if (finished.contains(info.callId)) return
    val existing = calls[info.callId]
    if (existing != null) {
      if (showUi && !existing.answered) IncomingCallNotifier.show(context, info)
      return
    }
    val call = ActiveCall(info, incoming = true)
    calls[info.callId] = call
    if (showUi) IncomingCallNotifier.show(context, info)
    // Fetch the caller's photo now: the full-screen ringing UI uses it, and
    // the notification is refreshed (silently) to show it as the avatar.
    if (info.photoUrl.isNotEmpty()) {
      CallPhotoCache.load(context, info.photoUrl) { bitmap ->
        if (bitmap != null && showUi && isRinging(info.callId)) IncomingCallNotifier.show(context, info)
      }
    }
    if (isSupported()) startTelecom(context.applicationContext, call)
    call.timeoutJob = scope.launch {
      delay(RING_TIMEOUT_MS)
      if (!call.answered) end(context, info.callId, "missed")
    }
  }

  /** The user accepted (native screen, notification, or the app's screen). */
  fun answer(context: Context, callId: String) {
    val call = calls[callId] ?: return
    if (call.answered) return
    call.answered = true
    call.timeoutJob?.cancel()
    IncomingCallNotifier.cancel(context, callId)
    call.actions.trySend(Action.Answer)
  }

  /** The user declined natively: stop ringing, settle the call server-side. */
  fun decline(context: Context, callId: String) {
    val info = calls[callId]?.info
    end(context, callId, "declined")
    module?.emit("onCallDeclined", mapOf("callId" to callId))
    if (info != null) postNativeDecline(context, info)
  }

  // ── outgoing ───────────────────────────────────────────────────────────
  fun startOutgoing(context: Context, info: CallInfo) {
    if (calls.containsKey(info.callId) || finished.contains(info.callId)) return
    val call = ActiveCall(info, incoming = false)
    calls[info.callId] = call
    if (isSupported()) startTelecom(context.applicationContext, call)
  }

  /** Media is flowing — the call is now "active" to the OS. */
  fun reportConnected(callId: String) {
    val call = calls[callId] ?: return
    if (call.connected) return
    call.connected = true
    call.actions.trySend(Action.Active)
  }

  // ── ending ─────────────────────────────────────────────────────────────
  /**
   * End a call for [reason] (the app's CallEndReason). Maps to the Telecom
   * disconnect cause that decides how the call log records it: an unanswered
   * incoming call → missed, declined → rejected, otherwise local/remote end.
   */
  fun end(context: Context, callId: String, reason: String) {
    // "Answered on another device" never ends the call this device answered.
    if (reason == "answered_elsewhere" && calls[callId]?.answered == true) return
    finished.add(callId)
    val call = calls.remove(callId)
    if (call == null) {
      IncomingCallNotifier.cancel(context, callId)
      return
    }
    call.timeoutJob?.cancel()
    IncomingCallNotifier.cancel(context, callId)
    IncomingCallActivity.finishFor(callId)
    call.actions.trySend(Action.Disconnect(disconnectCode(call, reason)))
    call.actions.close()
  }

  /** A server call_state push: the call stopped ringing elsewhere. */
  fun endFromServer(context: Context, callId: String, status: String) {
    val call = calls[callId] ?: return
    if (call.answered) return
    val reason = when (status) {
      "accepted" -> "answered_elsewhere"
      "declined" -> "declined"
      else -> "missed" // cancelled by the caller, timed out, busy
    }
    end(context, callId, reason)
    module?.emit("onCallEnded", mapOf("callId" to callId, "reason" to reason))
  }

  private fun disconnectCode(call: ActiveCall, reason: String): Int = when {
    reason == "declined" && call.incoming && !call.answered -> DisconnectCause.REJECTED
    call.incoming && !call.answered -> DisconnectCause.MISSED
    reason == "local_end" || reason == "user" -> DisconnectCause.LOCAL
    else -> DisconnectCause.REMOTE
  }

  // ── Telecom ────────────────────────────────────────────────────────────
  @SuppressLint("MissingPermission")
  @RequiresApi(Build.VERSION_CODES.O)
  private fun manager(context: Context): CallsManager? {
    callsManager?.let { return it }
    return try {
      val m = CallsManager(context)
      m.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING)
      callsManager = m
      m
    } catch (e: Exception) {
      Log.w(TAG, "registerAppWithTelecom failed", e)
      null
    }
  }

  @SuppressLint("MissingPermission")
  @RequiresApi(Build.VERSION_CODES.O)
  private fun startTelecom(context: Context, call: ActiveCall) {
    val mgr = manager(context) ?: return
    val callType = if (call.info.isVideo) CallAttributesCompat.CALL_TYPE_VIDEO_CALL else CallAttributesCompat.CALL_TYPE_AUDIO_CALL
    val attributes = CallAttributesCompat(
      displayName = call.info.peerName,
      address = Uri.fromParts("p2p", call.info.peerId.ifEmpty { call.info.callId }, null),
      direction = if (call.incoming) CallAttributesCompat.DIRECTION_INCOMING else CallAttributesCompat.DIRECTION_OUTGOING,
      callType = callType,
    )
    scope.launch {
      try {
        mgr.addCall(
          attributes,
          onAnswer = { _ -> onSystemAnswer(context, call.info.callId) },
          onDisconnect = { _ -> onSystemDisconnect(context, call.info.callId) },
          onSetActive = { },
          onSetInactive = { },
        ) {
          rememberPeer(context, getCallId().toString(), call.info)
          launch {
            for (action in call.actions) {
              when (action) {
                is Action.Answer -> answer(callType)
                is Action.Active -> setActive()
                is Action.Disconnect -> disconnect(DisconnectCause(action.code))
              }
            }
          }
        }
      } catch (e: Exception) {
        // The call still rings and connects without Telecom; only the OS
        // integration (call log, system controls) is missing for it.
        Log.w(TAG, "Telecom addCall failed for ${call.info.callId}", e)
      }
    }
  }

  /** Telecom asked to answer (e.g. from a watch or car) — same as Accept. */
  private fun onSystemAnswer(context: Context, callId: String) {
    val info = calls[callId]?.info ?: return
    answer(context, callId)
    openApp(context, info.incomingScreenUri(scheme(context), "accept"))
  }

  /** Telecom ended the call (system UI, another call, a headset). */
  private fun onSystemDisconnect(context: Context, callId: String) {
    val call = calls[callId] ?: return
    val ringing = call.incoming && !call.answered
    calls.remove(callId)
    finished.add(callId)
    call.timeoutJob?.cancel()
    call.actions.close()
    IncomingCallNotifier.cancel(context, callId)
    IncomingCallActivity.finishFor(callId)
    if (ringing) {
      module?.emit("onCallDeclined", mapOf("callId" to callId))
      postNativeDecline(context, call.info)
    } else {
      module?.emit("onCallEnded", mapOf("callId" to callId, "reason" to "local_end"))
    }
  }

  fun openApp(context: Context, uri: Uri) {
    try {
      context.startActivity(
        Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (e: Exception) {
      Log.w(TAG, "openApp failed", e)
    }
  }

  // ── "call back" from the system call log ───────────────────────────────
  /** Telecom's call id → who the call was with, for ACTION_CALL_BACK. */
  private fun rememberPeer(context: Context, telecomCallId: String, info: CallInfo) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val peers = JSONObject(prefs.getString("peers", "{}") ?: "{}")
    peers.put(telecomCallId, JSONObject().put("peerId", info.peerId).put("peerName", info.peerName).put("callType", info.callType))
    // Keep the newest 300 entries.
    while (peers.length() > 300) peers.remove(peers.keys().next())
    prefs.edit().putString("peers", peers.toString()).apply()
  }

  fun peerForTelecomCall(context: Context, telecomCallId: String): JSONObject? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return JSONObject(prefs.getString("peers", "{}") ?: "{}").optJSONObject(telecomCallId)
  }

  // ── decline without JS ─────────────────────────────────────────────────
  private fun postNativeDecline(context: Context, info: CallInfo) {
    val base = apiUrl(context) ?: return
    if (info.declineToken.isEmpty()) return
    Thread {
      try {
        val conn = URL("$base/calls/native-decline").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().put("callId", info.callId).put("token", info.declineToken).toString()
        conn.outputStream.use { it.write(body.toByteArray()) }
        Log.i(TAG, "native decline → ${conn.responseCode}")
        conn.disconnect()
      } catch (e: Exception) {
        Log.w(TAG, "native decline failed", e)
      }
    }.start()
  }
}
