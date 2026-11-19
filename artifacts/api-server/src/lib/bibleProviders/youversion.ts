// YOUVERSION PLATFORM — the owner's licensed Bible versions (owner 2026-11-19: "add the new translations").
// COPYRIGHT RULE (owner): everything follows each version's licence. YouVersion's developer guidance asks apps to
// show each version's attribution from its own metadata, fetched fresh, kept as text, and to honour each version's
// licence; it states nothing about caching, offline, speech or AI — so under our rule ("unknown = no") these Bibles
// are DISPLAY-ONLY: no server cache, no offline copy, no copying/sharing of verse text, no P2P Voice, no AI.
// The key stays on the server (Railway "YouVersion_API_Key").
// The same private-use marks lib/bibleReader withJesusRanges() turns into words-of-Jesus ranges.
const WJ = { open: "", close: "" };

const BASE = "https://api.youversion.com/v1";
export const yvKey = () => process.env.YouVersion_API_Key || process.env.YOUVERSION_API_KEY || "";
export const YV_ID_RE = /^\d{1,7}$/;
export class YouVersionError extends Error { constructor(message: string, public status: number) { super(message); } }
type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let fetcher: Fetcher = (u, i) => fetch(u, i) as never;
export const setYouVersionFetcherForTests = (f: Fetcher) => { fetcher = f; };

async function get(path: string): Promise<any> {
  const key = yvKey();
  if (!key) throw new YouVersionError("This Bible isn't available right now.", 503);
  const res = await fetcher(`${BASE}${path}`, { headers: { "X-YVP-App-Key": key, Accept: "application/json" } });
  if (res.status === 404 || res.status === 422) throw new YouVersionError("That passage isn't available in this translation.", 404);
  if (res.status === 401 || res.status === 403) throw new YouVersionError("This Bible isn't available right now.", 503);
  if (!res.ok) throw new YouVersionError("The Bible couldn't be loaded. Please try again.", 502);
  return res.json();
}

/** The version's own record: attribution (copyright, else promotional text) and the books it contains. Fetched on
 *  every chapter so the attribution shown is always current (YouVersion's guidance). */
export async function getYvMeta(id: string): Promise<{ copyright: string; books: string[]; title: string }> {
  if (!YV_ID_RE.test(id)) throw new YouVersionError("That translation isn't available", 404);
  const m = await get(`/bibles/${id}`);
  const attribution = String(m?.copyright || m?.promotional_content || "").trim();
  if (!attribution) throw new YouVersionError("This Bible can't be shown without its copyright notice.", 503);
  return { copyright: attribution, books: Array.isArray(m?.books) ? m.books.map(String) : [], title: String(m?.localized_title || m?.title || "") };
}

export interface ParsedVerse { verse: number; text: string; paragraph: number; poetry: boolean }
const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const HEADING = /^(d|s\d?|ms\d?|mr|r|sp|cl|qa)$/;
const SKIP = /^(yv-vlbl|yv-n|yv-h|note|f|x|fr|ft|fq|xo|xt)$/;
/** YouVersion's chapter HTML → P2P verses (words of Jesus marked for the shared emphasis ranges) and headings. */
export function parseYouVersionHtml(html: string): { verses: ParsedVerse[]; headings: { beforeVerse: number; text: string }[] } {
  const verses: ParsedVerse[] = [];
  const headings: { beforeVerse: number; text: string }[] = [];
  const stack: { tag: string; cls: string }[] = [];
  let paragraph = 0, poetry = false, current: ParsedVerse | null = null, heading = "";
  const inside = (re: RegExp) => stack.some((e) => e.cls.split(/\s+/).some((c) => re.test(c)));
  const tok = /<(\/?)(div|span|p|br)\b([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = tok.exec(html))) {
    const [, close, tagRaw, attrs, text] = m;
    if (text !== undefined) {
      if (inside(SKIP)) continue;
      const t = decode(text);
      if (inside(HEADING)) { heading += t; continue; }
      if (current) current.text += inside(/^wj$/) ? `${WJ.open}${t}${WJ.close}` : t;
      continue;
    }
    const tag = tagRaw.toLowerCase();
    if (tag === "br") { if (current) current.text += " "; continue; }
    if (close) {
      const e = stack.pop();
      if (e && e.cls.split(/\s+/).some((c) => HEADING.test(c)) && heading.trim()) {
        headings.push({ beforeVerse: (current?.verse ?? 0) + 1, text: heading.replace(/\s+/g, " ").trim() });
        heading = "";
      }
      continue;
    }
    const cls = (/class="([^"]*)"/.exec(attrs)?.[1] ?? "").trim();
    const selfClosing = /\/\s*$/.test(attrs);
    if (cls.split(/\s+/).includes("yv-v")) {
      const n = Number(/\bv="(\d+)"/.exec(attrs)?.[1]);
      if (Number.isInteger(n) && n > 0 && (!current || n !== current.verse)) { current = { verse: n, text: "", paragraph, poetry }; verses.push(current); }
      if (!selfClosing) stack.push({ tag, cls });
      continue;
    }
    if (tag === "div" || tag === "p") {
      const isPara = cls.split(/\s+/).some((c) => /^(p|m|mi|pi\d?|pc|pm|pmo|nb|q\d?|qc|qr|qm\d?|li\d?|b)$/.test(c));
      if (isPara) { paragraph++; poetry = cls.split(/\s+/).some((c) => /^q/.test(c)); if (current) { current.text += " "; } }
    }
    if (!selfClosing) stack.push({ tag, cls });
  }
  // A verse carried on into a new paragraph keeps its first paragraph; tidy spaces.
  return { verses: verses.map((v) => ({ ...v, text: v.text.replace(/\s+/g, " ").trim() })).filter((v) => v.text), headings };
}

export async function getYvChapter(id: string, book: string, chapter: number) {
  if (!YV_ID_RE.test(id)) throw new YouVersionError("That translation isn't available", 404);
  const [meta, passage] = await Promise.all([getYvMeta(id), get(`/bibles/${id}/passages/${book}.${chapter}?format=html`)]);
  const parsed = parseYouVersionHtml(String(passage?.content ?? ""));
  if (!parsed.verses.length) throw new YouVersionError("That passage isn't available in this translation.", 404);
  return { ...parsed, copyright: meta.copyright, books: meta.books };
}
