package expo.modules.p2pcallsystem

import android.net.Uri
import org.json.JSONObject

/**
 * One P2P call as the native layer sees it. Field names match the
 * incoming-call push payload (api-server /calls/start) and the
 * /call/incoming route params, so the same data round-trips unchanged.
 *
 * For an incoming call [peerId]/[peerName] are the caller; for an outgoing
 * call they are the person being called.
 */
data class CallInfo(
  val callId: String,
  val channelName: String,
  val callType: String,
  val peerId: String,
  val peerName: String,
  val conversationId: String,
  val callLogId: String,
  val declineToken: String,
  /** The other person's profile photo URL, or "" (ringing UI shows an avatar). */
  val photoUrl: String = "",
) {
  val isVideo: Boolean get() = callType == "video"

  fun toJson(): JSONObject = JSONObject()
    .put("callId", callId)
    .put("channelName", channelName)
    .put("callType", callType)
    .put("callerId", peerId)
    .put("callerName", peerName)
    .put("conversationId", conversationId)
    .put("callLogId", callLogId)
    .put("declineToken", declineToken)
    .put("callerPhotoUrl", photoUrl)

  fun toEventMap(): Map<String, Any?> = mapOf(
    "callerPhotoUrl" to photoUrl,
    "callId" to callId,
    "channelName" to channelName,
    "callType" to callType,
    "callerId" to peerId,
    "callerName" to peerName,
    "conversationId" to conversationId,
    "callLogId" to callLogId,
  )

  /** Deep link into the app's ringing screen, optionally running an action. */
  fun incomingScreenUri(scheme: String, action: String?): Uri {
    val b = Uri.Builder().scheme(scheme).authority("call").appendPath("incoming")
      .appendQueryParameter("callId", callId)
      .appendQueryParameter("channelName", channelName)
      .appendQueryParameter("callType", callType)
      .appendQueryParameter("callerId", peerId)
      .appendQueryParameter("callerName", peerName)
      .appendQueryParameter("conversationId", conversationId)
      .appendQueryParameter("callLogId", callLogId)
      .appendQueryParameter("invitationId", "")
      .appendQueryParameter("callerPhotoUrl", photoUrl)
    if (action != null) b.appendQueryParameter("action", action)
    return b.build()
  }

  companion object {
    // JSONObject.optString turns a JSON null into the text "null".
    private fun JSONObject.str(key: String, fallback: String = ""): String =
      if (!has(key) || isNull(key)) fallback else optString(key, fallback)

    fun fromJson(o: JSONObject): CallInfo? {
      val callId = o.str("callId")
      if (callId.isEmpty()) return null
      return CallInfo(
        callId = callId,
        channelName = o.str("channelName"),
        callType = o.str("callType", "audio"),
        peerId = o.str("callerId", o.str("peerId")),
        peerName = o.str("callerName", o.str("peerName", "Someone")).ifEmpty { "Someone" },
        conversationId = o.str("conversationId"),
        callLogId = o.str("callLogId"),
        declineToken = o.str("declineToken"),
        photoUrl = o.str("callerPhotoUrl"),
      )
    }

    fun fromMap(m: Map<String, Any?>): CallInfo? = fromJson(JSONObject(m.filterValues { it != null }))
  }
}
