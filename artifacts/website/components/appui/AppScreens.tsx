import {
  DEMO_FAMILY,
  DEMO_HOME_FEED,
  DEMO_MISSIONS,
  DEMO_STUDY,
  DEMO_WIN,
} from "@/lib/content/demo-universe";

// Phase 4 — polished mock UI for the App Showcase. These are presentation
// mockups built from the real app's terminology and information
// architecture (see the original app audit) — not screenshots, and not a
// claim that this exact layout ships in the app today. Every dynamic
// value comes from lib/content/demo-universe.ts (fictional, internally
// coherent) rather than any real P2P activity.

function Avatar({ initials, tone = "forest" }: { initials: string; tone?: "forest" | "ember" }) {
  return <span className={`app-avatar tone-${tone}`}>{initials}</span>;
}

function TabBar({ active }: { active: string }) {
  const tabs = ["Home", "Learn", "Prayer", "Family", "Missions"];
  return (
    <nav className="app-tabbar" aria-hidden="true">
      {tabs.map((t) => (
        <span key={t} className={`app-tab${t === active ? " active" : ""}`}>
          <span className="app-tab-dot" />
          {t}
        </span>
      ))}
    </nav>
  );
}

export function HomeScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">{DEMO_HOME_FEED.greeting}</span>
        <Avatar initials="D" />
      </div>
      <p className="app-eyebrow">{DEMO_HOME_FEED.continueLabel}</p>
      <div className="app-card app-card-scripture">
        <span className="app-card-label">Today&rsquo;s Scripture</span>
        <span className="app-card-title serif">{DEMO_HOME_FEED.todaysScripture}</span>
      </div>
      <div className="app-stage-row">
        {DEMO_HOME_FEED.stages.map((s) => (
          <span key={s} className="app-stage-pill">
            {s}
          </span>
        ))}
      </div>
      <div className="app-card app-card-list">
        <span className="app-card-label">Kingdom School</span>
        <div className="app-list-item">
          <Avatar initials="ID" tone="ember" />
          <div>
            <span className="app-list-title">Identity in Christ</span>
            <span className="app-list-sub">Module 2 · Lesson 5</span>
          </div>
        </div>
      </div>
      <TabBar active="Home" />
    </div>
  );
}

export function LearnScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">Kingdom School</span>
      </div>
      <div className="app-card app-card-scripture tone-ember">
        <span className="app-card-label">{DEMO_STUDY.module}</span>
        <span className="app-card-title serif">{DEMO_STUDY.title}</span>
        <div className="app-progress-track">
          <div className="app-progress-fill" style={{ width: `${DEMO_STUDY.progressPct}%` }} />
        </div>
        <span className="app-progress-label">{DEMO_STUDY.progressLabel}</span>
      </div>
      {["Knowing God", "The Lordship of Jesus"].map((t) => (
        <div className="app-list-item" key={t}>
          <Avatar initials={t[0]} />
          <div>
            <span className="app-list-title">{t}</span>
            <span className="app-list-sub">Continue study</span>
          </div>
        </div>
      ))}
      <TabBar active="Learn" />
    </div>
  );
}

export function PrayerScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">Pray the Word</span>
      </div>
      <div className="app-card tone-water">
        <span className="app-card-label">Family Prayer</span>
        <span className="app-card-title serif">Shared Requests</span>
      </div>
      <div className="app-list-item">
        <Avatar initials="M" />
        <div>
          <span className="app-list-title">Michael</span>
          <span className="app-list-sub">Praying for a job interview</span>
        </div>
      </div>
      <div className="app-list-item">
        <Avatar initials="S" tone="ember" />
        <div>
          <span className="app-list-title">Sarah</span>
          <span className="app-list-sub">Pray Together · tonight</span>
        </div>
      </div>
      <TabBar active="Prayer" />
    </div>
  );
}

export function FamilyScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">{DEMO_FAMILY.name}</span>
        <span className="app-count">{DEMO_FAMILY.memberCount} People</span>
      </div>
      <div className="app-card tone-ember">
        <span className="app-card-label">Next Gathering</span>
        <span className="app-card-title serif">{DEMO_FAMILY.nextGathering}</span>
      </div>
      <div className="app-list-item">
        <Avatar initials="KG" tone="forest" />
        <div>
          <span className="app-list-title">{DEMO_FAMILY.currentStudy}</span>
          <span className="app-list-sub">{DEMO_FAMILY.lessonProgress}</span>
        </div>
      </div>
      <div className="app-stage-row">
        {["Scripture", "Notes", "Voice"].map((s) => (
          <span key={s} className="app-stage-pill">
            {s}
          </span>
        ))}
      </div>
      <TabBar active="Family" />
    </div>
  );
}

export function MissionsScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">Missions</span>
      </div>
      {DEMO_MISSIONS.slice(0, 3).map((m) => (
        <div className="app-list-item" key={m.title}>
          <Avatar initials={m.kind[0]} tone="ember" />
          <div>
            <span className="app-list-title">{m.title}</span>
            <span className="app-list-sub">{m.place}</span>
          </div>
        </div>
      ))}
      <TabBar active="Missions" />
    </div>
  );
}

export function StoriesScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">Kingdom Stories</span>
      </div>
      <div className="app-card app-card-scripture tone-parchment">
        <span className="app-card-label">Revival</span>
        <span className="app-card-title serif">When the Fire Spread</span>
        <span className="app-progress-label">Stories of faith through generations</span>
      </div>
      <div className="app-list-item">
        <Avatar initials="PF" />
        <div>
          <span className="app-list-title">Perpetua &amp; Felicity</span>
          <span className="app-list-sub">Early church · 6 min read</span>
        </div>
      </div>
      <TabBar active="Home" />
    </div>
  );
}

export function WinsScreen() {
  return (
    <div className="app-ui">
      <div className="app-topbar">
        <span className="app-greeting">Kingdom Wins</span>
      </div>
      <span className="app-eyebrow">What God is doing in people&rsquo;s journeys</span>
      <div className="app-card tone-water">
        <span className="app-card-label">DEMO STORY</span>
        <span className="app-card-title serif" style={{ fontStyle: "italic" }}>
          &ldquo;{DEMO_WIN.quote}&rdquo;
        </span>
        <span className="app-progress-label">— {DEMO_WIN.attribution}</span>
      </div>
      <TabBar active="Home" />
    </div>
  );
}

export const APP_SCREEN_COMPONENTS: Record<string, React.ComponentType> = {
  P2P_APP_SCREEN_HOME: HomeScreen,
  P2P_APP_SCREEN_LEARN: LearnScreen,
  P2P_APP_SCREEN_PRAYER: PrayerScreen,
  P2P_APP_SCREEN_FAMILY: FamilyScreen,
  P2P_APP_SCREEN_STORIES: StoriesScreen,
  P2P_APP_SCREEN_WINS: WinsScreen,
};
