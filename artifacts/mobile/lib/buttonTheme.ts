import type { AppColors } from "@/constants/themes";

// P2P Global button tokens — the one source of colour and size for every
// shared button part (components/ui). Pure functions of the reader's theme
// colours, so the same rules work for light, dark and every app style.
// Label colours are chosen by measured contrast (WCAG), never assumed: e.g.
// the dark theme's bright green takes dark text, the light theme's deep green
// takes white.

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "outline" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";
export type IconButtonVariant = "plain" | "tinted" | "overlay";
export type Mode = "light" | "dark";

/** Visual height, padding, label and icon sizes. Small stays 44 to tap (hitSlop). */
export const SIZES: Record<ButtonSize, { height: number; padX: number; font: number; icon: number; radius: number; gap: number }> = {
  sm: { height: 36, padX: 12, font: 13, icon: 16, radius: 10, gap: 6 },
  md: { height: 44, padX: 16, font: 15, icon: 18, radius: 12, gap: 8 },
  lg: { height: 52, padX: 20, font: 16, icon: 20, radius: 12, gap: 8 },
};
export const MIN_TOUCH = 44;
export const LABEL_FONT = "Inter_600SemiBold";
export const DISABLED_OPACITY = 0.45;
/** Extra tap area so a visually smaller control still offers a 44-point target. */
export function hitSlopFor(visual: number): { top: number; bottom: number; left: number; right: number } | undefined {
  const pad = Math.max(0, Math.ceil((MIN_TOUCH - visual) / 2));
  return pad ? { top: pad, bottom: pad, left: pad, right: pad } : undefined;
}

// ── Colour maths ──────────────────────────────────────────────────────────
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
/** a → b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** The first candidate that reaches `min` against `bg`, else the best one. */
export function readableOn(bg: string, candidates: string[], min = 4.5): string {
  const ok = candidates.find((c) => contrast(c, bg) >= min);
  return ok ?? [...candidates].sort((a, b) => contrast(b, bg) - contrast(a, bg))[0];
}

const WHITE = "#FFFFFF";
const INK = "#0B1410";
const DESTRUCTIVE = { light: "#B42318", dark: "#F04438" } as const;

export interface VariantTokens { bg: string; pressedBg: string; hoverBg: string; fg: string; border: string | null }
export interface ButtonTokens {
  mode: Mode;
  surface: string;
  variants: Record<ButtonVariant, VariantTokens>;
  icon: Record<IconButtonVariant, VariantTokens>;
  chip: { bg: string; fg: string; border: string; selectedBg: string; selectedFg: string; pressedBg: string };
  segment: { track: string; selectedBg: string; fg: string; selectedFg: string; border: string };
  focus: string;
  spinner: Record<ButtonVariant, string>;
}

/**
 * Every button colour for one theme. `surface` = the background the buttons
 * sit on. Light vs dark is read from that surface itself, not only from the
 * appearance setting: some styles (Original Dark, Midnight) are dark even
 * when the device is in light mode.
 */
export function buttonTokens(c: AppColors, requested: Mode): ButtonTokens {
  const surface = c.lightCream;
  const mode: Mode = luminance(surface) < 0.2 ? "dark" : luminance(surface) > 0.4 ? "light" : requested;
  const darken = (x: string, t = 0.12) => mix(x, mode === "dark" ? WHITE : "#000000", t);
  const onFill = (bg: string) => readableOn(bg, [WHITE, mode === "dark" ? surface : INK, INK]);

  const primaryBg = c.primaryGreen;
  const destructiveBg = DESTRUCTIVE[mode];
  const secondaryBg = mix(surface, c.accentGreen, mode === "dark" ? 0.2 : 0.14);
  const secondaryFg = readableOn(secondaryBg, mode === "dark" ? [c.lightGreen, c.textDark] : [c.primaryGreen, c.textDark]);
  const linkFg = readableOn(surface, mode === "dark" ? [c.lightGreen, c.primaryGreen, c.textDark] : [c.primaryGreen, c.textDark]);
  const tint = mix(surface, c.accentGreen, mode === "dark" ? 0.16 : 0.1);
  const outlineBorder = mix(c.borderBeige, c.textDark, 0.3);

  const variants: Record<ButtonVariant, VariantTokens> = {
    primary: { bg: primaryBg, pressedBg: darken(primaryBg), hoverBg: darken(primaryBg, 0.06), fg: onFill(primaryBg), border: null },
    secondary: { bg: secondaryBg, pressedBg: darken(secondaryBg, 0.08), hoverBg: darken(secondaryBg, 0.04), fg: secondaryFg, border: null },
    tertiary: { bg: "transparent", pressedBg: tint, hoverBg: mix(surface, c.accentGreen, 0.06), fg: linkFg, border: null },
    outline: { bg: "transparent", pressedBg: tint, hoverBg: mix(surface, c.accentGreen, 0.06), fg: c.textDark, border: outlineBorder },
    destructive: { bg: destructiveBg, pressedBg: darken(destructiveBg), hoverBg: darken(destructiveBg, 0.06), fg: onFill(destructiveBg), border: null },
  };
  return {
    mode, surface, variants,
    icon: {
      plain: { bg: "transparent", pressedBg: tint, hoverBg: mix(surface, c.accentGreen, 0.06), fg: c.textDark, border: null },
      tinted: { bg: secondaryBg, pressedBg: darken(secondaryBg, 0.08), hoverBg: darken(secondaryBg, 0.04), fg: secondaryFg, border: null },
      // Over artwork or video: the same dark scrim and white glyph in every theme.
      overlay: { bg: "rgba(0,0,0,0.55)", pressedBg: "rgba(0,0,0,0.72)", hoverBg: "rgba(0,0,0,0.65)", fg: WHITE, border: null },
    },
    chip: { bg: c.card, fg: c.textDark, border: outlineBorder, selectedBg: primaryBg, selectedFg: onFill(primaryBg), pressedBg: tint },
    segment: { track: mix(surface, c.textDark, mode === "dark" ? 0.12 : 0.06), selectedBg: mode === "dark" ? mix(surface, WHITE, 0.14) : WHITE, fg: c.textDark, selectedFg: c.textDark, border: outlineBorder },
    focus: readableOn(surface, [c.accentGreen, c.primaryGreen, c.textDark], 3),
    spinner: { primary: onFill(primaryBg), secondary: secondaryFg, tertiary: linkFg, outline: c.textDark, destructive: onFill(destructiveBg) },
  };
}

/** Call controls sit on the dark call screen in every theme. */
export const CALL_TOKENS = {
  idle: { bg: "rgba(255,255,255,0.16)", pressedBg: "rgba(255,255,255,0.28)", fg: WHITE },
  active: { bg: WHITE, pressedBg: "#E6E6E6", fg: INK },
  end: { bg: "#E5484D", pressedBg: "#C93C40", fg: WHITE },
  caption: WHITE,
} as const;
