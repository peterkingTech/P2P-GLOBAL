import AsyncStorage from "@react-native-async-storage/async-storage";

// Handwriting Studio — the drawing document (version 1) and its local draft
// copy. A drawing is DATA (strokes of points), never a picture or markup, so
// it can be reopened and edited, and every reviewer sees it drawn by the same
// read-only renderer (components/handwriting/DrawingView). The server checks
// and rebuilds every document (api-server lib/learningAttachments.ts) — the
// limits here match it.
//
// Input comes from a swappable surface (components/handwriting/DrawingSurface):
// finger, stylus, Apple Pencil, mouse and pen all produce the same strokes. A
// future native PencilKit surface on iPad turns its strokes into this same
// format, so nothing about storage, submission or review changes.

export const PAGE = { width: 1000, height: 1414 } as const;
export const LIMITS = { pages: 20, strokesPerPage: 3000, pointsPerStroke: 5000, totalPoints: 200000, bytes: 2 * 1024 * 1024, caption: 500 } as const;

export type Tool = "pen" | "pencil" | "highlighter";
export type Background = "blank" | "lined" | "grid";
export type Point = [number, number] | [number, number, number];
export interface Stroke { tool: Tool; color: string; width: number; points: Point[] }
export interface Page { background: Background; strokes: Stroke[] }
export interface DrawingDoc { version: 1; pages: Page[] }

/** Colours always have a name (never colour alone). */
export const COLORS: { name: string; hex: string }[] = [
  { name: "Black", hex: "#1f2933" }, { name: "Blue", hex: "#1d4ed8" }, { name: "Green", hex: "#15803d" }, { name: "Red", hex: "#b91c1c" },
  { name: "Purple", hex: "#7e22ce" }, { name: "Orange", hex: "#c2410c" }, { name: "Brown", hex: "#78350f" }, { name: "Grey", hex: "#6b7280" },
];
export const WIDTHS: { name: string; value: number }[] = [{ name: "Fine", value: 2 }, { name: "Medium", value: 4 }, { name: "Thick", value: 8 }];
export const TOOL_LABEL: Record<Tool, string> = { pen: "Pen", pencil: "Pencil", highlighter: "Highlighter" };
export const BACKGROUND_LABEL: Record<Background, string> = { blank: "Blank", lined: "Lined", grid: "Grid" };

export const emptyPage = (background: Background = "lined"): Page => ({ background, strokes: [] });
export const emptyDoc = (): DrawingDoc => ({ version: 1, pages: [emptyPage()] });

const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A point on the page from a touch on a canvas drawn `scale` page-units per pixel. */
export function toPagePoint(x: number, y: number, scale: number, pressure?: number | null): Point {
  const px = clamp(r1(x * scale), 0, PAGE.width), py = clamp(r1(y * scale), 0, PAGE.height);
  return typeof pressure === "number" && pressure > 0 && pressure <= 1 ? [px, py, Math.round(pressure * 100) / 100] : [px, py];
}

function perpDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Fewer points, same shape (Ramer–Douglas–Peucker), so long sessions stay small and smooth. */
export function simplify(points: Point[], tolerance = 0.8): Point[] {
  if (points.length <= 2) return points.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, idx + 1), tolerance);
  return [...left.slice(0, -1), ...simplify(points.slice(idx), tolerance)];
}

/** A smooth SVG path through the points (quadratic curves through midpoints). A single point becomes a dot. */
export function strokePath(points: Point[]): string {
  if (!points.length) return "";
  const [x0, y0] = points[0];
  if (points.length === 1) return `M${x0} ${y0}L${r1(x0 + 0.1)} ${y0}`;
  if (points.length === 2) return `M${x0} ${y0}L${points[1][0]} ${points[1][1]}`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i], [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  const last = points[points.length - 1];
  return d + `L${last[0]} ${last[1]}`;
}

/** Line width for a stroke: pressure (only when the device reports it) widens or thins the line. */
export function strokeWidth(s: Stroke): number {
  const ps = s.points.map((p) => p[2]).filter((v): v is number => typeof v === "number");
  const base = s.tool === "highlighter" ? s.width * 4 : s.tool === "pencil" ? Math.max(1, s.width * 0.8) : s.width;
  if (!ps.length || s.tool === "highlighter") return base;
  const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
  return r1(base * (0.6 + avg * 0.8));
}
export const strokeOpacity = (t: Tool) => (t === "highlighter" ? 0.35 : t === "pencil" ? 0.85 : 1);

/** Does this point touch the stroke (for the stroke eraser)? */
export function hitsStroke(s: Stroke, p: Point, radius: number): boolean {
  const pts = s.points;
  for (let i = 0; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) <= radius + s.width) return true;
    if (i > 0 && perpOnSegment(p, pts[i - 1], pts[i]) <= radius + s.width) return true;
  }
  return false;
}
function perpOnSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const pointCount = (d: DrawingDoc) => d.pages.reduce((n, p) => n + p.strokes.reduce((m, s) => m + s.points.length, 0), 0);
export const isEmpty = (d: DrawingDoc) => d.pages.every((p) => !p.strokes.length);
export const docBytes = (d: DrawingDoc) => new TextEncoder().encode(JSON.stringify(d)).length;

/** What stops a document being saved, in words (null = fine). Mirrors the server's checks. */
export function docProblem(d: DrawingDoc): string | null {
  if (!d.pages.length || d.pages.length > LIMITS.pages) return `A drawing can have 1 to ${LIMITS.pages} pages.`;
  if (d.pages.some((p) => p.strokes.length > LIMITS.strokesPerPage)) return "A page has too many strokes. Add a new page.";
  if (pointCount(d) > LIMITS.totalPoints || docBytes(d) > LIMITS.bytes) return "This drawing is too large. Start a new drawing for the rest.";
  return null;
}

// ── Local draft copy (this device, per account) ────────────────────────────
// Saved every few seconds and when the app goes to the background, so a
// crash, a lost connection or closing the app never loses strokes. The
// server copy (owner-only) is saved when the Studio closes and every 30 s.
export interface LocalDraft { doc: DrawingDoc; caption: string; attachmentId: string | null; savedAt: number }
const key = (userId: string, docKey: string) => `p2p.handwriting.v1:${userId}:${docKey}`;
export async function saveLocalDraft(userId: string, docKey: string, d: LocalDraft): Promise<boolean> {
  try {
    const json = JSON.stringify(d);
    if (json.length > LIMITS.bytes * 1.2) return false; // the server copy covers very large drawings
    await AsyncStorage.setItem(key(userId, docKey), json);
    return true;
  } catch { return false; }
}
export async function loadLocalDraft(userId: string, docKey: string): Promise<LocalDraft | null> {
  try { const v = await AsyncStorage.getItem(key(userId, docKey)); return v ? (JSON.parse(v) as LocalDraft) : null; } catch { return null; }
}
export async function clearLocalDraft(userId: string, docKey: string): Promise<void> {
  try { await AsyncStorage.removeItem(key(userId, docKey)); } catch { /* nothing to clear */ }
}

/** Newer of the device copy and the server copy wins (by time saved). */
export function pickNewer(local: LocalDraft | null, server: { doc: DrawingDoc; updatedAt: string } | null): "local" | "server" | null {
  if (!local && !server) return null;
  if (!server) return "local";
  if (!local) return "server";
  return local.savedAt > new Date(server.updatedAt).getTime() ? "local" : "server";
}

// ── Studio results (Studio → the answer box that opened it) ────────────────
type Listener = (attachment: { id: string; pageCount: number | null; caption: string | null }) => void;
const listeners = new Map<string, Listener>();
export const onStudioSaved = (requestKey: string, fn: Listener) => { listeners.set(requestKey, fn); return () => { if (listeners.get(requestKey) === fn) listeners.delete(requestKey); }; };
export const emitStudioSaved = (requestKey: string, a: { id: string; pageCount: number | null; caption: string | null }) => listeners.get(requestKey)?.(a);
