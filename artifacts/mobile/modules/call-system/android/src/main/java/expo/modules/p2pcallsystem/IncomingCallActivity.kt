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
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
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

  /**
   * Full-screen caller photo (cover-cropped around the centre), a gradient
   * that darkens only the top (name) and bottom (controls), the caller's
   * name, "P2P Global Audio/Video", and Decline/Accept. No photo → the P2P
   * avatar (initial in a green circle) on the call theme's dark background.
   * The photo loads asynchronously and never delays answering.
   */
  private fun render(call: CallInfo) {
    val density = resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()
    val match = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

    // Draw under the status/navigation bars so the photo fills the screen.
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility =
      View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION

    val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#0B1A13")) }

    // Fallback avatar, replaced by the photo once it's available.
    val fallback = TextView(this).apply {
      text = call.peerName.trim().take(1).uppercase().ifEmpty { "?" }
      setTextColor(Color.parseColor("#0F6E56"))
      textSize = 64f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#E3F2EC")) }
    }
    root.addView(fallback, FrameLayout.LayoutParams(dp(168), dp(168), Gravity.CENTER))

    val photo = ImageView(this).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      visibility = View.GONE
    }
    root.addView(photo, match)
    fun showPhoto(bitmap: android.graphics.Bitmap?) {
      if (bitmap == null) return
      photo.setImageBitmap(bitmap)
      photo.visibility = View.VISIBLE
      fallback.visibility = View.GONE
    }
    val cached = CallPhotoCache.cached(this, call.photoUrl)
    if (cached != null) showPhoto(cached)
    else if (call.photoUrl.isNotEmpty()) CallPhotoCache.load(this, call.photoUrl) { if (!isFinishing) showPhoto(it) }

    root.addView(View(this).apply {
      background = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(0x9E000000.toInt(), 0x1F000000, 0x00000000, 0x2E000000, 0xC7000000.toInt()),
      )
    }, match)

    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(28), dp(72), dp(28), dp(56))
    }
    // Keep the name and controls clear of the status and navigation bars.
    content.setOnApplyWindowInsetsListener { v, insets ->
      @Suppress("DEPRECATION")
      v.setPadding(dp(28), insets.systemWindowInsetTop + dp(48), dp(28), insets.systemWindowInsetBottom + dp(44))
      insets
    }
    fun TextView.shadow() = setShadowLayer(dp(6).toFloat(), 0f, dp(1).toFloat(), 0x73000000)
    content.addView(TextView(this).apply {
      text = call.peerName
      setTextColor(Color.WHITE)
      textSize = 32f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      maxLines = 2
      shadow()
    })
    content.addView(TextView(this).apply {
      text = if (call.isVideo) "P2P Global Video" else "P2P Global Audio"
      setTextColor(Color.parseColor("#EBFFFFFF"))
      textSize = 16f
      gravity = Gravity.CENTER
      setPadding(0, dp(10), 0, 0)
      shadow()
    })
    content.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))

    val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    fun callButton(label: String, color: String, rotate: Float, onTap: () -> Unit): LinearLayout {
      val circle = FrameLayout(this).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor(color)) }
        isClickable = true
        contentDescription = "$label call"
        setOnClickListener { onTap() }
        addView(ImageView(this@IncomingCallActivity).apply {
          setImageResource(android.R.drawable.sym_action_call)
          setColorFilter(Color.WHITE)
          rotation = rotate
        }, FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER))
      }
      return LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        addView(circle, LinearLayout.LayoutParams(dp(76), dp(76)))
        addView(TextView(this@IncomingCallActivity).apply {
          text = label
          setTextColor(Color.WHITE)
          textSize = 14f
          gravity = Gravity.CENTER
          setPadding(0, dp(10), 0, 0)
          shadow()
        })
      }
    }
    val column = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    buttons.addView(callButton("Decline", "#DC2626", 135f) { decline() }, column)
    buttons.addView(callButton("Accept", "#1D9E75", 0f) { accept() }, column)
    content.addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    root.addView(content, match)
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
