// P2P Together's own visual identity — not modeled on Discord, Slack,
// Teams, Zoom, Telegram, WhatsApp, Spotify, or YouTube's interfaces.
// Every Together component (components/family/*, app/family/worship/*)
// draws from this one token set rather than hardcoding its own colors,
// so the whole surface reads as one coherent, original design language.
//
// Palette story — chosen to communicate Community, Discipleship,
// Connection, Scripture, Worship, Peace, Growth, and Togetherness:
//  - background: a deep, warm near-black green — a gathered room at
//    dusk, not a stark "streaming app" black canvas.
//  - growth (green): life and growth — the room's primary accent for
//    active/confirming actions (Prayer, "Prayed", Share, Play).
//  - light (gold): Scripture, warmth, peace — candlelight, used for the
//    room's "sacred" surfaces (Scripture references, the current mode
//    badge, focused prayer).
//  - connection (soft blue): the thread between people — used sparingly
//    for connective actions only (transfer host, shelf/notes links),
//    never as a dominant UI color the way most call apps use blue.
//  - rest (muted brick red): closing/ending actions — a quiet stop, not
//    an alarm red.
export const colors = {
  background: "#0B120E",
  sheet: "#141F19",
  surface: "rgba(255,255,255,0.05)",
  surfaceRaised: "rgba(255,255,255,0.08)",
  surfaceInset: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.12)",
  borderFaint: "rgba(255,255,255,0.08)",

  growth: "#1D9E75",
  growthSoft: "rgba(29,158,117,0.18)",
  light: "#B8860B",
  lightSoft: "rgba(184,134,11,0.18)",
  connection: "#5B8DEF",
  connectionSoft: "rgba(91,141,239,0.18)",
  rest: "#B85C52",
  restSoft: "rgba(184,92,82,0.18)",

  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.72)",
  textTertiary: "rgba(255,255,255,0.52)",
  textFaint: "rgba(255,255,255,0.36)",
  onLight: "#1A1200", // dark text for use on light/gold-tinted surfaces
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const radii = { sm: 8, md: 10, lg: 12, xl: 16, pill: 999 } as const;

// A named type scale, not per-component ad hoc font sizes — every size
// here also carries an explicit lineHeight (≥1.3x) for readability.
export const type = {
  display: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold" as const },
  title: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_700Bold" as const },
  label: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_700Bold" as const, letterSpacing: 0.6 },
  body: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" as const },
  bodyEmph: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" as const },
  caption: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" as const },
  micro: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_500Medium" as const },
} as const;

// WCAG 2.5.5 / iOS HIG minimum tappable size — every control in
// Together should meet or exceed this even where the visible glyph
// (an icon, an emoji) is smaller; use as a hitSlop floor or minWidth/
// minHeight on the touchable itself.
export const MIN_TOUCH_TARGET = 44;

// A single breakpoint: below it, Together is the mobile composition
// (large content area, simple bottom controls); at or above it, the
// screen switches to the desktop composition (content-focused center,
// a companion gathering area, contextual controls, optional
// conversation panel).
export const DESKTOP_BREAKPOINT = 900;
