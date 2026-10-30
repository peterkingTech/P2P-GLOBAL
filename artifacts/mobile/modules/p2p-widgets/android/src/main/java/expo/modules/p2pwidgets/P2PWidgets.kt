package expo.modules.p2pwidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// P2P Global home-screen widgets (Android). Every widget reads the ONE
// snapshot the app wrote (lib/widgetSnapshot.ts → WidgetStore) and fills the
// shared card layout (res/layout/p2p_widget_card.xml). Nothing here fetches
// data, starts or completes anything: a tap only opens the app at the right
// screen. The greeting and the verse of the day are worked out on the phone,
// so they stay right offline; everything else shows the last synchronised
// data and says so when it is more than a day old. Private content (journal
// text, prayer requests, messages, answers) is never in the snapshot.

/** Where the app stores the snapshot (app-private SharedPreferences). */
object WidgetStore {
  private const val PREFS = "p2p_widgets"
  private const val KEY = "snapshot"

  fun write(ctx: Context, json: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  fun clear(ctx: Context) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
  }

  fun read(ctx: Context): JSONObject? = try {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)?.let { JSONObject(it) }
  } catch (e: Exception) {
    null
  }
}

/** What one widget shows. A null field is hidden. */
data class Card(
  val kicker: String,
  val title: String?,
  val body: String? = null,
  val meta: String? = null,
  val action: String? = null,
  val url: String? = null,
  /** 0–100, or null for no progress bar. */
  val progress: Int? = null,
  /** A second tap target on the action line (e.g. Journal on the prayer widget). */
  val actionUrl: String? = null,
)

object P2PWidgets {
  private val providers: List<Class<out AppWidgetProvider>> = listOf(
    GreetingWidget::class.java, SchoolWidget::class.java, PlansWidget::class.java, StoryWidget::class.java,
    LearningWidget::class.java, TogetherWidget::class.java, ReflectWidget::class.java,
  )

  /** Redraw every P2P widget the person has placed. */
  fun updateAll(ctx: Context) {
    val mgr = AppWidgetManager.getInstance(ctx)
    for (cls in providers) {
      val ids = mgr.getAppWidgetIds(ComponentName(ctx, cls))
      if (ids.isEmpty()) continue
      val intent = Intent(ctx, cls)
        .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      ctx.sendBroadcast(intent)
    }
  }

  fun installedCount(ctx: Context): Int {
    val mgr = AppWidgetManager.getInstance(ctx)
    return providers.sumOf { mgr.getAppWidgetIds(ComponentName(ctx, it)).size }
  }

  fun render(ctx: Context, c: Card): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.p2p_widget_card)
    setText(v, R.id.p2p_widget_kicker, c.kicker)
    setText(v, R.id.p2p_widget_title, c.title)
    setText(v, R.id.p2p_widget_body, c.body)
    setText(v, R.id.p2p_widget_meta, c.meta)
    setText(v, R.id.p2p_widget_action, c.action)
    val progress = c.progress
    if (progress != null) {
      v.setViewVisibility(R.id.p2p_widget_progress, View.VISIBLE)
      v.setProgressBar(R.id.p2p_widget_progress, 100, progress.coerceIn(0, 100), false)
    } else {
      v.setViewVisibility(R.id.p2p_widget_progress, View.GONE)
    }
    v.setOnClickPendingIntent(R.id.p2p_widget_root, openIntent(ctx, c.url))
    val actionUrl = c.actionUrl
    if (actionUrl != null) v.setOnClickPendingIntent(R.id.p2p_widget_action, openIntent(ctx, actionUrl))
    return v
  }

  private fun setText(v: RemoteViews, id: Int, text: String?) {
    if (text.isNullOrEmpty()) {
      v.setViewVisibility(id, View.GONE)
    } else {
      v.setViewVisibility(id, View.VISIBLE)
      v.setTextViewText(id, text)
    }
  }

  /** Opens the app at `url` (the app's own link), or just opens the app. */
  private fun openIntent(ctx: Context, url: String?): PendingIntent {
    val intent = if (url != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(ctx.packageName)
    } else {
      ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      ctx, (url ?: "open").hashCode(), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  // ── Snapshot helpers ─────────────────────────────────────────────────────
  fun str(o: JSONObject?, key: String): String? =
    if (o == null || o.isNull(key)) null else o.optString(key).takeIf { it.isNotEmpty() }

  fun int(o: JSONObject?, key: String): Int = o?.optInt(key, 0) ?: 0

  fun greeting(): String {
    val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return if (h < 12) "GOOD MORNING" else if (h < 18) "GOOD AFTERNOON" else "GOOD EVENING"
  }

  /** Today's verse by the app's own rule: day of month % list length. */
  fun verseOfDay(s: JSONObject?): JSONObject? {
    val list = s?.optJSONArray("verses") ?: return null
    if (list.length() == 0) return null
    return list.optJSONObject(Calendar.getInstance().get(Calendar.DAY_OF_MONTH) % list.length())
  }

  private fun parseIso(iso: String?): Date? {
    if (iso == null || iso.length < 19) return null
    return try {
      val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
      f.timeZone = TimeZone.getTimeZone("UTC")
      f.parse(iso.substring(0, 19))
    } catch (e: Exception) {
      null
    }
  }

  /** "May be out of date" once the app hasn't refreshed the widgets for a day. */
  fun staleNote(s: JSONObject?): String? {
    val at = parseIso(str(s, "updatedAt")) ?: return null
    return if (System.currentTimeMillis() - at.time > 24L * 60 * 60 * 1000) "May be out of date · open P2P to refresh" else null
  }

  fun whenText(iso: String?): String? =
    parseIso(iso)?.let { SimpleDateFormat("EEE d MMM · HH:mm", Locale.getDefault()).format(it) }

  val signedOut = Card("P2P GLOBAL", "Open P2P Global", "Sign in to see your learning here.", action = "Open the app →")
}

/** Shared behaviour: read the snapshot, build the card, draw it. */
abstract class P2PWidgetProvider : AppWidgetProvider() {
  abstract fun card(s: JSONObject?): Card

  /** Widgets that show nothing personal still work when signed out. */
  open val worksSignedOut: Boolean = false

  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    val s = WidgetStore.read(ctx)
    val signedIn = s?.optBoolean("signedIn", false) ?: false
    val card = if (signedIn || worksSignedOut) card(s) else P2PWidgets.signedOut
    for (id in ids) mgr.updateAppWidget(id, P2PWidgets.render(ctx, card))
  }
}

class GreetingWidget : P2PWidgetProvider() {
  override val worksSignedOut = true
  override fun card(s: JSONObject?): Card {
    val verse = P2PWidgets.verseOfDay(s)
    val name = P2PWidgets.str(s?.optJSONObject("greeting"), "name")
    return Card(
      kicker = P2PWidgets.greeting(),
      title = name ?: "Welcome",
      body = P2PWidgets.str(verse, "text")?.let { "“$it”" } ?: "Remain in Christ today.",
      meta = P2PWidgets.str(verse, "ref"),
      action = "Read Scripture →",
      url = P2PWidgets.str(verse, "url") ?: P2PWidgets.str(s, "verseUrl"),
    )
  }
}

class SchoolWidget : P2PWidgetProvider() {
  override fun card(s: JSONObject?): Card {
    val k = s?.optJSONObject("school")
    val done = P2PWidgets.int(k, "modulesCompleted")
    val total = P2PWidgets.int(k, "totalModules")
    val core = if (total > 0) "Core Curriculum: $done of $total modules" else null
    val pct = if (total > 0) done * 100 / total else null
    val note = P2PWidgets.staleNote(s) ?: core
    val url = P2PWidgets.str(k, "url")
    if (k?.optBoolean("hasProgress", false) == true) {
      val count = P2PWidgets.int(k, "lessonCount")
      val lesson = minOf(P2PWidgets.int(k, "completedLessons") + 1, count)
      return Card("KINGDOM SCHOOL", P2PWidgets.str(k, "moduleTitle"), "Lesson $lesson of $count · Your next step is ready.", note, "Continue learning →", url, pct)
    }
    if (total > 0 && done >= total) {
      return Card("KINGDOM SCHOOL", "Core Curriculum complete", "Keep growing with Learning Plans.", note, "Explore Kingdom School →", url, 100)
    }
    return Card("KINGDOM SCHOOL", "Start with Foundations", "Your discipleship journey begins here.", note, "Open Kingdom School →", url, pct)
  }
}

class PlansWidget : P2PWidgetProvider() {
  override fun card(s: JSONObject?): Card {
    val p = s?.optJSONObject("plans")
    val n = P2PWidgets.int(p, "activeCount")
    val title = P2PWidgets.str(p, "title")
    val url = P2PWidgets.str(p, "url")
    return if (n > 0 && title != null) {
      Card("MY LEARNING PLANS", title, if (n == 1) "1 active plan" else "$n active plans", P2PWidgets.staleNote(s), "Continue plan →", url)
    } else {
      Card("MY LEARNING PLANS", "No active plan", "Choose a plan to grow in a specific area.", P2PWidgets.staleNote(s), "Find a plan →", url)
    }
  }
}

class StoryWidget : P2PWidgetProvider() {
  override fun card(s: JSONObject?): Card {
    val st = s?.optJSONObject("story")
    val title = P2PWidgets.str(st, "title")
    val url = P2PWidgets.str(st, "url")
    return if (title != null) {
      Card("KINGDOM STORIES", title, P2PWidgets.str(st, "detail"), P2PWidgets.staleNote(s), "Continue reading →", url)
    } else {
      Card("KINGDOM STORIES", "Start a Kingdom Story", "Bible stories in biblical order.", P2PWidgets.staleNote(s), "Open Kingdom Stories →", url)
    }
  }
}

class LearningWidget : P2PWidgetProvider() {
  override fun card(s: JSONObject?): Card {
    val l = s?.optJSONObject("learning")
    val url = P2PWidgets.str(l, "url")
    if (l?.optBoolean("known", false) != true) {
      return Card("MY LEARNING", "Your learning", "Open P2P Global to load your work.", null, "Open My Learning →", url)
    }
    val toDo = P2PWidgets.int(l, "toDo")
    val lines = listOf(
      "Awaiting review: ${P2PWidgets.int(l, "awaitingReview")}",
      "Feedback: ${P2PWidgets.int(l, "feedback")}",
      "For you to review: ${P2PWidgets.int(l, "toReview")}",
    ).joinToString("\n")
    return Card("MY LEARNING", if (toDo == 1) "1 item to do" else "$toDo items to do", lines, P2PWidgets.staleNote(s), "Open My Learning →", url)
  }
}

class TogetherWidget : P2PWidgetProvider() {
  override fun card(s: JSONObject?): Card {
    val t = s?.optJSONObject("together")
    val g = s?.optJSONObject("gathering")
    val gTitle = P2PWidgets.str(g, "title")
    val gWhen = P2PWidgets.whenText(P2PWidgets.str(g, "startsAt"))
    val gathering = if (gTitle != null && gWhen != null) "Next Gathering: $gTitle · $gWhen" else null
    val title = P2PWidgets.str(t, "title")
    return if (title != null) {
      Card("STUDY TOGETHER", title, P2PWidgets.str(t, "detail"), P2PWidgets.staleNote(s) ?: gathering, "View study →", P2PWidgets.str(t, "url"))
    } else if (gTitle != null && gWhen != null) {
      Card("UPCOMING GATHERING", gTitle, gWhen, P2PWidgets.staleNote(s) ?: P2PWidgets.str(g, "where"), "View details →", P2PWidgets.str(g, "url"))
    } else {
      Card("STUDY TOGETHER", "No shared study right now", "Study a lesson or story with your people.", P2PWidgets.staleNote(s), "Open Study Together →", P2PWidgets.str(t, "url"))
    }
  }
}

class ReflectWidget : P2PWidgetProvider() {
  override fun card(s: JSONObject?): Card {
    val r = s?.optJSONObject("reminders")
    return Card(
      kicker = "TIME TO PRAY",
      title = "Set aside a moment with God.",
      body = "What have you learned today?",
      action = "Open journal →",
      url = P2PWidgets.str(r, "prayerUrl"),
      actionUrl = P2PWidgets.str(r, "journalUrl"),
    )
  }
}
