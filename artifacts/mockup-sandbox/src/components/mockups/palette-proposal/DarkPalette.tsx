// Proposed "Deep Forest" dark palette — Core Curriculum screen mockup
// For approval before applying app-wide

const PALETTE = {
  bg: "#07120D",
  card: "#0D2218",
  cardBorder: "#1A3D2B",
  textPrimary: "#EDE8DE",
  textSecondary: "#9DC4B0",
  textMuted: "#4E7A62",
  accentGreen: "#1D9E75",
  primaryGreen: "#28B885",
  amber: "#D4922A",
  navBg: "#060E09",
  navBorder: "#163529",
  progressTrack: "#1A3D2B",
  progressFill: "#1D9E75",
  levelBadgeBg: "rgba(29,158,117,0.2)",
  levelBadgeText: "#7ED9C0",
};

const modules = [
  {
    id: "m0", level: 0, title: "Module 0: PEER-TO-PEER ORIENTATION",
    description: "Getting started with P2P Bible study",
    image: "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Module%20Title%20Pictures/Peer%20to%20Peer.jpeg",
    lessons: 5, completed: 5, locked: false,
  },
  {
    id: "m1", level: 1, title: "Module 1: YOUR NEW IDENTITY IN CHRIST",
    description: "Discovering who you are in Christ",
    image: "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Module%20Title%20Pictures/Identity%20In%20Christ%202.jpeg",
    lessons: 6, completed: 3, locked: false,
  },
  {
    id: "m2", level: 2, title: "Module 2: KNOWING GOD",
    description: "Exploring the character and nature of God",
    image: "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Module%20Title%20Pictures/Knowing%20God.jpeg",
    lessons: 6, completed: 0, locked: true,
  },
  {
    id: "m3", level: 3, title: "Module 3: THE LORDSHIP OF JESUS CHRIST",
    description: "Making Jesus Lord of every area of life",
    image: "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Module%20Title%20Pictures/The%20Lordship%20Of%20Jesus%20Christ.jpeg",
    lessons: 5, completed: 0, locked: true,
  },
];

function ModuleCard({ mod }: { mod: typeof modules[0] }) {
  const pct = mod.lessons > 0 ? Math.round((mod.completed / mod.lessons) * 100) : 0;
  const isStarted = mod.completed > 0;
  const isComplete = pct === 100;

  return (
    <div
      style={{
        backgroundColor: PALETTE.card,
        borderRadius: 16,
        border: `1px solid ${PALETTE.cardBorder}`,
        padding: 14,
        display: "flex",
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
        opacity: mod.locked ? 0.55 : 1,
        marginBottom: 8,
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img
          src={mod.image}
          alt={mod.title}
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            objectFit: "cover",
            display: "block",
          }}
        />
        {mod.locked && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 10,
            background: "rgba(6,14,9,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            🔒
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Level badge */}
        <div style={{ display: "inline-block", marginBottom: 4 }}>
          <span style={{
            fontSize: 10,
            color: PALETTE.levelBadgeText,
            background: PALETTE.levelBadgeBg,
            borderRadius: 6,
            padding: "2px 7px",
            fontWeight: 600,
            letterSpacing: "0.4px",
          }}>
            L{mod.level}
          </span>
        </div>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: mod.locked ? PALETTE.textMuted : PALETTE.textPrimary,
          lineHeight: "17px",
          marginBottom: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {mod.title}
        </div>
        <div style={{
          fontSize: 11,
          color: PALETTE.textMuted,
          marginBottom: mod.locked ? 0 : 6,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {mod.description}
        </div>
        {!mod.locked && (
          <div>
            <div style={{
              height: 5,
              background: PALETTE.progressTrack,
              borderRadius: 3,
              overflow: "hidden",
              marginBottom: 3,
            }}>
              <div style={{
                height: "100%",
                width: `${pct}%`,
                background: isComplete ? PALETTE.accentGreen : isStarted ? PALETTE.primaryGreen : PALETTE.progressTrack,
                borderRadius: 3,
                transition: "width 0.3s",
              }} />
            </div>
            <span style={{ fontSize: 10, color: PALETTE.textMuted }}>
              {mod.completed}/{mod.lessons} lessons
              {isComplete ? " · Complete ✓" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Arrow / lock */}
      <div style={{ color: mod.locked ? PALETTE.textMuted : PALETTE.accentGreen, fontSize: 16, flexShrink: 0 }}>
        {mod.locked ? "🔒" : "▶"}
      </div>
    </div>
  );
}

export function DarkPalette() {
  return (
    <div style={{
      width: 390,
      minHeight: 844,
      background: PALETTE.bg,
      fontFamily: "'Inter', system-ui, sans-serif",
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      border: `1px solid ${PALETTE.cardBorder}`,
      borderRadius: 20,
      overflow: "hidden",
    }}>
      {/* Status bar mock */}
      <div style={{
        height: 44,
        background: PALETTE.navBg,
        borderBottom: `1px solid ${PALETTE.navBorder}`,
        display: "flex",
        alignItems: "center",
        paddingInline: 20,
        justifyContent: "space-between",
      }}>
        <span style={{ color: PALETTE.textPrimary, fontSize: 13, fontWeight: 600 }}>9:41</span>
        <span style={{ color: PALETTE.textMuted, fontSize: 11 }}>● ● ●</span>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 80px" }}>
        {/* Screen title */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 800,
            color: PALETTE.textPrimary,
            lineHeight: "32px",
          }}>
            Core Curriculum
          </h1>
          <p style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: PALETTE.textMuted,
          }}>
            Your discipleship journey
          </p>
        </div>

        {/* Progress overview pill */}
        <div style={{
          background: PALETTE.card,
          border: `1px solid ${PALETTE.cardBorder}`,
          borderRadius: 14,
          padding: "12px 16px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            background: `conic-gradient(${PALETTE.accentGreen} 53%, ${PALETTE.progressTrack} 0)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              background: PALETTE.card,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              color: PALETTE.accentGreen,
            }}>53%</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: PALETTE.textPrimary }}>
              8 of 15 lessons done
            </div>
            <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 2 }}>
              Keep going — you're past halfway!
            </div>
          </div>
        </div>

        {/* Section label */}
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: PALETTE.textMuted,
          letterSpacing: "0.8px",
          textTransform: "uppercase",
          marginBottom: 10,
        }}>
          All Modules
        </div>

        {/* Module cards */}
        {modules.map((mod) => (
          <ModuleCard key={mod.id} mod={mod} />
        ))}
      </div>

      {/* Bottom nav bar */}
      <div style={{
        height: 64,
        background: PALETTE.navBg,
        borderTop: `1px solid ${PALETTE.navBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        paddingBottom: 4,
        flexShrink: 0,
      }}>
        {[
          { icon: "🏠", label: "Home" },
          { icon: "📖", label: "Learn", active: true },
          { icon: "🌍", label: "Missions" },
          { icon: "🙏", label: "Prayer" },
        ].map((t) => (
          <div key={t.label} style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{
              fontSize: 10,
              color: t.active ? PALETTE.accentGreen : PALETTE.textMuted,
              fontWeight: t.active ? 700 : 400,
            }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
