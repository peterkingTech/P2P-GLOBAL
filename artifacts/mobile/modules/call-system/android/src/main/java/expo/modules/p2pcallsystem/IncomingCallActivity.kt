package expo.modules.p2pcallsystem

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Full-screen incoming-call screen (the notification's full-screen intent).
 * Shows over the lock screen and turns the screen on. Accept asks the user to
 * unlock — the call itself runs in the app — then opens the app's ringing
 * screen with action=accept, which settles the call and joins it exactly as
 * an in-app Accept does. Decline settles it natively (no app needed).
 */
class IncomingCallActivity : Activity() {
  companion object {
    private const val EXTRA_CALL = "call"
    private const val EXTRA_AUTO_ACCEPT = "autoAccept"
    private var current: WeakReference<IncomingCallActivity>? = null

    fun intent(context: Context, info: CallInfo, autoAccept: Boolean): Intent =
      Intent(context, IncomingCallActivity::class.java)
        .putExtra(EXTRA_CALL, info.toJson().toString())
        .putExtra(EXTRA_AUTO_ACCEPT, autoAccept)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)

    /** Close the screen when its call stops ringing (cancelled, timed out). */
    fun finishFor(callId: String) {
      val activity = current?.get() ?: return
      if (activity.info?.callId == callId) activity.runOnUiThread { activity.finish() }
    }
  }

  private var info: CallInfo? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    handle(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handle(intent)
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun handle(intent: Intent) {
    val parsed = intent.getStringExtra(EXTRA_CALL)?.let { CallInfo.fromJson(JSONObject(it)) }
    // A stale notification/screen for a call that already stopped ringing.
    if (parsed == null || !CallSystem.isRinging(parsed.callId)) {
      finish()
      return
    }
    info = parsed
    current = WeakReference(this)
    if (intent.getBooleanExtra(EXTRA_AUTO_ACCEPT, false)) accept() else render(parsed)
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun render(call: CallInfo) {
    val density = resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(Color.parseColor("#0B1A13"))
      setPadding(dp(24), dp(96), dp(24), dp(64))
    }
    root.addView(TextView(this).apply {
      text = call.peerName
      setTextColor(Color.WHITE)
      textSize = 30f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = if (call.isVideo) "Incoming video call" else "Incoming audio call"
      setTextColor(Color.parseColor("#B9C7BE"))
      textSize = 17f
      gravity = Gravity.CENTER
      setPadding(0, dp(10), 0, 0)
    })
    root.addView(TextView(this).apply { text = "P2P Global"; setTextColor(Color.parseColor("#7FA493")); textSize = 13f; gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0) })
    root.addView(android.view.View(this), LinearLayout.LayoutParams(1, 0, 1f))

    val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    fun roundButton(label: String, color: String, onTap: () -> Unit) = Button(this).apply {
      text = label
      setTextColor(Color.WHITE)
      textSize = 16f
      isAllCaps = false
      background = GradientDrawable().apply { cornerRadius = dp(36).toFloat(); setColor(Color.parseColor(color)) }
      setOnClickListener { onTap() }
    }
    val lp = LinearLayout.LayoutParams(0, dp(64), 1f).apply { setMargins(dp(12), 0, dp(12), 0) }
    buttons.addView(roundButton("Decline", "#DC2626") { decline() }, lp)
    buttons.addView(roundButton("Accept", "#16A34A") { accept() }, lp)
    root.addView(buttons, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    setContentView(root)
  }

  private fun accept() {
    val call = info ?: return finish()
    CallSystem.answer(this, call.callId)
    val open = {
      CallSystem.openApp(this, call.incomingScreenUri(CallSystem.scheme(this), "accept"))
      finish()
    }
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard.isKeyguardLocked) {
      // The call screen runs in the app, which needs the phone unlocked.
      keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() { open() }
        override fun onDismissCancelled() { open() }
        override fun onDismissError() { open() }
      })
    } else {
      open()
    }
  }

  private fun decline() {
    val call = info ?: return finish()
    CallSystem.decline(this, call.callId)
    finish()
  }
}
