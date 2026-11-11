// Comprehensive Checks whose ONE stored question holds several numbered questions ("1. … 2. … 3. …" —
// every Kingdom Stories check is written this way). Owner decision 2026-11-11: split them ON SCREEN, so
// every numbered question has its own answer box and its own "Share Your Response". Nothing changes in
// the database: the answers are submitted together as ONE answer, each under its question —
//
//   1. What words open the biblical creation account…?
//   <answer>
//
//   2. According to Genesis 1:1–2, …?
//   <answer>
//
// — so peer evaluation, progress and the evaluator's view work exactly as before (the evaluator now sees
// which answer belongs to which question). An answer written before this (one block, no headings) is
// left as it is: it can't be split, so it keeps one Share for the whole answer.
//
// Pure (no React): used by the answer card in app/lesson/[id].tsx (lessons and Kingdom Stories).

/** "1. …" / "2) …" at the start of a line. */
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;

/**
 * The numbered questions inside a check question, in order — or null when it isn't a numbered list of at
 * least two (then the question is shown and answered whole, as before). Numbers must run 1, 2, 3…
 * A question may continue over several lines; text before "1." is ignored only if it is a lead-in label.
 */
export function splitCheckQuestion(text: string | null | undefined): string[] | null {
  if (!text) return null;
  const parts: string[] = [];
  let lead = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(NUMBERED);
    if (m && Number(m[1]) === parts.length + 1) { parts.push(m[2].trim()); continue; }
    if (!parts.length) { lead += line.trim(); continue; }
    if (line.trim()) parts[parts.length - 1] = `${parts[parts.length - 1]} ${line.trim()}`.trim();
  }
  // A long lead-in (real instructions) means this isn't a plain numbered list — keep it whole.
  if (parts.length < 2 || lead.length > 80 || parts.some((p) => !p)) return null;
  return parts;
}

const header = (i: number, q: string) => `${i + 1}. ${q}`;

/** One answer from the separate answers, each under its question (blank answers are kept as blank). */
export function combineAnswers(parts: string[], answers: string[]): string {
  return parts.map((q, i) => `${header(i, q)}\n${(answers[i] ?? "").trim()}`).join("\n\n");
}

/**
 * The separate answers back out of a combined answer — or null when the text wasn't written in parts
 * (an earlier answer), so it is never split wrongly.
 */
export function splitCombinedAnswer(text: string | null | undefined, parts: string[]): string[] | null {
  if (!text || parts.length < 2) return null;
  const at: number[] = [];
  let from = 0;
  for (let i = 0; i < parts.length; i++) {
    const h = header(i, parts[i]);
    const idx = text.indexOf(h, from);
    if (idx < 0 || (idx > 0 && text[idx - 1] !== "\n")) return null;
    at.push(idx);
    from = idx + h.length;
  }
  if (at[0] !== 0) return null;
  return parts.map((q, i) => text.slice(at[i] + header(i, q).length, i + 1 < at.length ? at[i + 1] : text.length).trim());
}

/** Drafts for the separate answers are kept as one saved draft (JSON array). */
export function readPartDrafts(raw: string, count: number): string[] {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return Array.from({ length: count }, (_, i) => (typeof v[i] === "string" ? v[i] : ""));
  } catch { /* not a parts draft (e.g. an older single-box draft) */ }
  return Array.from({ length: count }, (_, i) => (i === 0 && raw && !raw.trim().startsWith("[") ? raw : ""));
}
export const writePartDrafts = (answers: string[]) => (answers.some((a) => a.trim()) ? JSON.stringify(answers) : "");
