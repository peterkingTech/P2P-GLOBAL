import WidgetKit
import SwiftUI
import UIKit

// P2P Global home-screen and Lock Screen widgets (WidgetKit).
//
// Every widget reads the ONE snapshot the app wrote into the shared App Group
// (lib/widgetSnapshot.ts → modules/p2p-widgets). Nothing here fetches data,
// starts or completes anything: a tap only opens the app at the right screen.
// The greeting and the verse of the day are worked out on the phone (same
// rule as the app), so they stay right offline; everything else shows the
// last synchronised data and says so when it is more than a day old.
// Private content (journal text, prayer requests, messages, answers) is never
// in the snapshot. Lock Screen widgets show only generic text unless the
// person turns "Details on Lock Screen" on in the app.

// MARK: - Snapshot (mirrors lib/widgetSnapshot.ts, version 1)

struct P2PSnapshot: Decodable {
  struct Greeting: Decodable { let name: String? }
  struct Verse: Decodable { let ref: String; let text: String; let url: String }
  struct School: Decodable {
    let hasProgress: Bool; let moduleTitle: String?; let completedLessons: Int; let lessonCount: Int
    let modulesCompleted: Int; let totalModules: Int; let url: String
  }
  struct Plans: Decodable { let activeCount: Int; let title: String?; let url: String }
  struct Story: Decodable { let title: String?; let detail: String?; let url: String }
  struct Learning: Decodable { let toDo: Int; let awaitingReview: Int; let feedback: Int; let toReview: Int; let known: Bool; let url: String }
  struct Together: Decodable { let title: String?; let detail: String?; let activeCount: Int; let url: String }
  struct Gathering: Decodable { let title: String?; let startsAt: String?; let place: String?; let url: String
    enum CodingKeys: String, CodingKey { case title, startsAt, place = "where", url }
  }
  struct Reminders: Decodable { let prayerUrl: String; let journalUrl: String }
  struct Privacy: Decodable { let lockScreenDetails: Bool; let showCommunity: Bool }

  let version: Int
  let updatedAt: String
  let signedIn: Bool
  let greeting: Greeting
  let verses: [Verse]
  let verseUrl: String
  let school: School
  let plans: Plans
  let story: Story
  let learning: Learning
  let together: Together
  let gathering: Gathering
  let reminders: Reminders
  let privacy: Privacy
}

enum P2PStore {
  static let key = "p2p.widgets.snapshot"
  static func load() -> P2PSnapshot? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "P2PAppGroup") as? String,
          let json = UserDefaults(suiteName: group)?.string(forKey: key),
          let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(P2PSnapshot.self, from: data)
  }
}

// MARK: - Timeline

struct P2PEntry: TimelineEntry {
  let date: Date
  let snapshot: P2PSnapshot?
}

struct P2PProvider: TimelineProvider {
  func placeholder(in context: Context) -> P2PEntry { P2PEntry(date: Date(), snapshot: nil) }

  func getSnapshot(in context: Context, completion: @escaping (P2PEntry) -> Void) {
    completion(P2PEntry(date: Date(), snapshot: P2PStore.load()))
  }

  /// One entry now and one at each greeting change (12:00, 18:00) and at
  /// midnight (new verse). The app also asks for a reload whenever its data
  /// changes. iOS decides the exact refresh time.
  func getTimeline(in context: Context, completion: @escaping (Timeline<P2PEntry>) -> Void) {
    let snap = P2PStore.load()
    let now = Date()
    let cal = Calendar.current
    let start = cal.startOfDay(for: now)
    var dates = [now]
    for hour in [12, 18] {
      if let d = cal.date(byAdding: .hour, value: hour, to: start), d > now { dates.append(d) }
    }
    let midnight = cal.date(byAdding: .day, value: 1, to: start) ?? now.addingTimeInterval(86_400)
    dates.append(midnight)
    completion(Timeline(entries: dates.map { P2PEntry(date: $0, snapshot: snap) }, policy: .after(midnight)))
  }
}

// MARK: - Shared rules (same as the Android widgets)

enum P2PText {
  static func greeting(_ date: Date) -> String {
    let h = Calendar.current.component(.hour, from: date)
    return h < 12 ? "GOOD MORNING" : (h < 18 ? "GOOD AFTERNOON" : "GOOD EVENING")
  }

  /// Today's verse by the app's own rule: day of month % list length.
  static func verse(_ s: P2PSnapshot?, _ date: Date) -> P2PSnapshot.Verse? {
    guard let list = s?.verses, !list.isEmpty else { return nil }
    return list[Calendar.current.component(.day, from: date) % list.count]
  }

  static func parse(_ iso: String?) -> Date? {
    guard let iso = iso else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: iso) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: iso)
  }

  static func staleNote(_ s: P2PSnapshot?, _ date: Date) -> String? {
    guard let at = parse(s?.updatedAt) else { return nil }
    return date.timeIntervalSince(at) > 86_400 ? "May be out of date · open P2P to refresh" : nil
  }

  static func when(_ iso: String?) -> String? {
    guard let d = parse(iso) else { return nil }
    let f = DateFormatter()
    f.setLocalizedDateFormatFromTemplate("EEEdMMMHHmm")
    return f.string(from: d)
  }
}

enum P2PKind { case greeting, verse, school, lesson, progress, plans, story, learning, together, reflect }

struct P2PCard {
  var kicker: String
  var title: String?
  var body: String? = nil
  var meta: String? = nil
  var action: String? = nil
  var url: String? = nil
  var progress: Double? = nil
  /// Short generic text for the Lock Screen when details are off.
  var lockTitle: String
}

func p2pCard(_ kind: P2PKind, _ s: P2PSnapshot?, _ date: Date) -> P2PCard {
  let stale = P2PText.staleNote(s, date)
  if s?.signedIn != true && kind != .greeting && kind != .verse {
    return P2PCard(kicker: "P2P GLOBAL", title: "Open P2P Global", body: "Sign in to see your learning here.", action: "Open the app →", lockTitle: "Open P2P Global")
  }
  switch kind {
  case .greeting:
    let v = P2PText.verse(s, date)
    return P2PCard(kicker: P2PText.greeting(date), title: s?.greeting.name ?? "Welcome",
                   body: v.map { "“\($0.text)”" } ?? "Remain in Christ today.", meta: v?.ref,
                   action: "Read Scripture →", url: v?.url ?? s?.verseUrl, lockTitle: P2PText.greeting(date).capitalized)
  case .verse:
    let v = P2PText.verse(s, date)
    return P2PCard(kicker: "TODAY'S SCRIPTURE", title: nil, body: v.map { "“\($0.text)”" } ?? "Open P2P Global to load today's Scripture.",
                   meta: v?.ref, action: "Read Scripture →", url: v?.url ?? s?.verseUrl, lockTitle: v?.ref ?? "Today's Scripture")
  case .school, .lesson:
    let k = s!.school
    let core = k.totalModules > 0 ? "Core Curriculum: \(k.modulesCompleted) of \(k.totalModules) modules" : nil
    let pct = k.totalModules > 0 ? Double(k.modulesCompleted) / Double(k.totalModules) : nil
    if k.hasProgress {
      let lesson = min(k.completedLessons + 1, k.lessonCount)
      return P2PCard(kicker: kind == .lesson ? "CONTINUE YOUR LESSON" : "KINGDOM SCHOOL", title: k.moduleTitle,
                     body: "Lesson \(lesson) of \(k.lessonCount) · Your next step is ready.", meta: stale ?? (kind == .school ? core : nil),
                     action: "Continue learning →", url: k.url, progress: kind == .school ? pct : nil, lockTitle: "Continue learning")
    }
    if k.totalModules > 0 && k.modulesCompleted >= k.totalModules {
      return P2PCard(kicker: "KINGDOM SCHOOL", title: "Core Curriculum complete", body: "Keep growing with Learning Plans.",
                     meta: stale ?? core, action: "Explore Kingdom School →", url: k.url, progress: 1, lockTitle: "Kingdom School")
    }
    return P2PCard(kicker: "KINGDOM SCHOOL", title: "Start with Foundations", body: "Your discipleship journey begins here.",
                   meta: stale ?? core, action: "Open Kingdom School →", url: k.url, progress: kind == .school ? pct : nil, lockTitle: "Kingdom School")
  case .progress:
    let k = s!.school
    let pct = k.totalModules > 0 ? Double(k.modulesCompleted) / Double(k.totalModules) : 0
    return P2PCard(kicker: "CORE CURRICULUM", title: "\(k.modulesCompleted) of \(k.totalModules) modules",
                   body: k.hasProgress ? k.moduleTitle : nil, meta: stale, action: "Continue your journey →", url: k.url, progress: pct,
                   lockTitle: "\(k.modulesCompleted)/\(k.totalModules)")
  case .plans:
    let p = s!.plans
    if p.activeCount > 0, let title = p.title {
      return P2PCard(kicker: "MY LEARNING PLANS", title: title, body: p.activeCount == 1 ? "1 active plan" : "\(p.activeCount) active plans",
                     meta: stale, action: "Continue plan →", url: p.url, lockTitle: "Continue your plan")
    }
    return P2PCard(kicker: "MY LEARNING PLANS", title: "No active plan", body: "Choose a plan to grow in a specific area.",
                   meta: stale, action: "Find a plan →", url: p.url, lockTitle: "Learning Plans")
  case .story:
    let st = s!.story
    if let title = st.title {
      return P2PCard(kicker: "KINGDOM STORIES", title: title, body: st.detail, meta: stale, action: "Continue reading →", url: st.url, lockTitle: "Continue your story")
    }
    return P2PCard(kicker: "KINGDOM STORIES", title: "Start a Kingdom Story", body: "Bible stories in biblical order.",
                   meta: stale, action: "Open Kingdom Stories →", url: st.url, lockTitle: "Kingdom Stories")
  case .learning:
    let l = s!.learning
    if !l.known {
      return P2PCard(kicker: "MY LEARNING", title: "Your learning", body: "Open P2P Global to load your work.", action: "Open My Learning →", url: l.url, lockTitle: "My Learning")
    }
    let lines = "Awaiting review: \(l.awaitingReview)\nFeedback: \(l.feedback)\nFor you to review: \(l.toReview)"
    return P2PCard(kicker: "MY LEARNING", title: l.toDo == 1 ? "1 item to do" : "\(l.toDo) items to do", body: lines,
                   meta: stale, action: "Open My Learning →", url: l.url, lockTitle: l.toDo == 1 ? "1 item to do" : "\(l.toDo) items to do")
  case .together:
    let t = s!.together
    let g = s!.gathering
    let gWhen = P2PText.when(g.startsAt)
    let gathering: String? = (g.title != nil && gWhen != nil) ? "Next Gathering: \(g.title!) · \(gWhen!)" : nil
    if let title = t.title {
      return P2PCard(kicker: "STUDY TOGETHER", title: title, body: t.detail, meta: stale ?? gathering, action: "View study →", url: t.url, lockTitle: "Study Together")
    }
    if let gt = g.title, let w = gWhen {
      return P2PCard(kicker: "UPCOMING GATHERING", title: gt, body: w, meta: stale ?? g.place, action: "View details →", url: g.url, lockTitle: "Upcoming Gathering")
    }
    return P2PCard(kicker: "STUDY TOGETHER", title: "No shared study right now", body: "Study a lesson or story with your people.",
                   meta: stale, action: "Open Study Together →", url: t.url, lockTitle: "Study Together")
  case .reflect:
    return P2PCard(kicker: "TIME TO PRAY", title: "Set aside a moment with God.", body: "What have you learned today? Write it in your journal.",
                   action: "Open Prayer →", url: s?.reminders.prayerUrl, lockTitle: "Time to pray")
  }
}

// MARK: - Look

enum P2PColor {
  static func dynamic(_ light: UIColor, _ dark: UIColor) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
  }
  static let bg = dynamic(UIColor(red: 1.0, green: 0.984, blue: 0.957, alpha: 1), UIColor(red: 0.078, green: 0.125, blue: 0.106, alpha: 1))
  static let text = dynamic(UIColor(red: 0.122, green: 0.165, blue: 0.141, alpha: 1), UIColor(red: 0.949, green: 0.937, blue: 0.91, alpha: 1))
  static let muted = dynamic(UIColor(red: 0.42, green: 0.392, blue: 0.345, alpha: 1), UIColor(red: 0.71, green: 0.686, blue: 0.639, alpha: 1))
  static let accent = dynamic(UIColor(red: 0.075, green: 0.475, blue: 0.357, alpha: 1), UIColor(red: 0.373, green: 0.827, blue: 0.651, alpha: 1))
}

extension View {
  /// iOS 17+ needs containerBackground; earlier versions draw the background themselves.
  @ViewBuilder func p2pBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self.containerBackground(for: .widget) { color }
    } else {
      self.padding(14).background(color)
    }
  }
}

struct P2PCardView: View {
  let card: P2PCard
  let large: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(card.kicker).font(.caption2.weight(.bold)).foregroundColor(P2PColor.accent).lineLimit(1)
      if let title = card.title {
        Text(title).font(large ? .title3.weight(.bold) : .headline).foregroundColor(P2PColor.text).lineLimit(2)
      }
      if let body = card.body {
        Text(body).font(large ? .body : .footnote).foregroundColor(P2PColor.text).lineLimit(large ? 8 : 4)
      }
      Spacer(minLength: 0)
      if let p = card.progress {
        ProgressView(value: min(max(p, 0), 1)).tint(P2PColor.accent)
      }
      if let meta = card.meta {
        Text(meta).font(.caption2).foregroundColor(P2PColor.muted).lineLimit(1)
      }
      if let action = card.action {
        Text(action).font(.caption.weight(.semibold)).foregroundColor(P2PColor.accent).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct P2PWidgetView: View {
  @Environment(\.widgetFamily) var family
  let kind: P2PKind
  let entry: P2PEntry

  var body: some View {
    let card = p2pCard(kind, entry.snapshot, entry.date)
    let details = entry.snapshot?.privacy.lockScreenDetails ?? false
    let link = card.url.flatMap { URL(string: $0) }
    switch family {
    case .accessoryCircular:
      Gauge(value: card.progress ?? 0) { Text("P2P") } currentValueLabel: { Text(details ? card.lockTitle : "P2P").font(.caption2) }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetURL(link)
        .p2pBackground(.clear)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text(card.kicker).font(.caption2.weight(.bold)).lineLimit(1)
        Text(details ? (card.title ?? card.lockTitle) : card.lockTitle).font(.headline).lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetURL(link)
      .p2pBackground(.clear)
    case .accessoryInline:
      Text(details ? (card.title ?? card.lockTitle) : card.lockTitle)
        .widgetURL(link)
        .p2pBackground(.clear)
    default:
      P2PCardView(card: card, large: family == .systemLarge)
        .widgetURL(link)
        .p2pBackground(P2PColor.bg)
    }
  }
}

// MARK: - Widgets

private let homeSizes: [WidgetFamily] = [.systemSmall, .systemMedium]

struct P2PGreetingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PGreeting", provider: P2PProvider()) { P2PWidgetView(kind: .greeting, entry: $0) }
      .configurationDisplayName("Daily Greeting")
      .description("A greeting for the time of day and today's Scripture.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
  }
}

struct P2PVerseWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PVerse", provider: P2PProvider()) { P2PWidgetView(kind: .verse, entry: $0) }
      .configurationDisplayName("Daily Bible Verse")
      .description("Today's Scripture. Tap to read it in the Bible.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
  }
}

struct P2PSchoolWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PKingdomSchool", provider: P2PProvider()) { P2PWidgetView(kind: .school, entry: $0) }
      .configurationDisplayName("Kingdom School")
      .description("Continue learning and see your Core Curriculum progress.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

struct P2PLessonWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PContinueLesson", provider: P2PProvider()) { P2PWidgetView(kind: .lesson, entry: $0) }
      .configurationDisplayName("Continue a Lesson")
      .description("Go straight back to your current Kingdom School lesson.")
      .supportedFamilies([.systemSmall, .accessoryRectangular])
  }
}

struct P2PProgressWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PCoreProgress", provider: P2PProvider()) { P2PWidgetView(kind: .progress, entry: $0) }
      .configurationDisplayName("Core Curriculum Progress")
      .description("Modules you have finished in the Core Curriculum.")
      .supportedFamilies([.systemSmall, .accessoryCircular])
  }
}

struct P2PPlansWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PLearningPlans", provider: P2PProvider()) { P2PWidgetView(kind: .plans, entry: $0) }
      .configurationDisplayName("Learning Plans")
      .description("Your active Learning Plan.")
      .supportedFamilies(homeSizes)
  }
}

struct P2PStoryWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PKingdomStories", provider: P2PProvider()) { P2PWidgetView(kind: .story, entry: $0) }
      .configurationDisplayName("Kingdom Stories")
      .description("Continue the Kingdom Story you are reading.")
      .supportedFamilies(homeSizes)
  }
}

struct P2PLearningWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PMyLearning", provider: P2PProvider()) { P2PWidgetView(kind: .learning, entry: $0) }
      .configurationDisplayName("My Learning")
      .description("Work to do, reviews and feedback on your Comprehensive Checks.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

struct P2PTogetherWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PStudyTogether", provider: P2PProvider()) { P2PWidgetView(kind: .together, entry: $0) }
      .configurationDisplayName("Study Together")
      .description("Your shared study and your next Gathering.")
      .supportedFamilies(homeSizes)
  }
}

struct P2PReflectWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "P2PPrayerJournal", provider: P2PProvider()) { P2PWidgetView(kind: .reflect, entry: $0) }
      .configurationDisplayName("Prayer & Journal")
      .description("A moment to pray or reflect. Never shows your prayers or journal.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

@main
struct P2PWidgetsBundle: WidgetBundle {
  var body: some Widget {
    P2PGreetingWidget()
    P2PVerseWidget()
    P2PSchoolWidget()
    P2PLessonWidget()
    P2PProgressWidget()
    P2PPlansWidget()
    P2PStoryWidget()
    P2PLearningWidget()
    P2PTogetherWidget()
    P2PReflectWidget()
  }
}
