// FREE TRANSLATION PROVIDER — Azure AI Translator, free tier F0 (owner 2026-11-19: "a free plan for translation";
// 2 million characters a month on the owner's Azure account; Anthropic credit had run out). Machine translation of
// P2P-authored content only (the engine's licence check runs first), never Bible verse text. Every result is stored
// as a DRAFT for human review (the engine's existing review step): a test showed a theological mistranslation in
// Yoruba, so nothing machine-translated goes live unchecked. Microsoft's Translator does not store or learn from the
// text it translates. The key stays on the server.
//
// Fields: only translatable text is sent. Identifiers, URLs and Scripture reference fields are left as they are; a
// Scripture reference written inside prose ("John 3:16") is protected so it stays exactly as written — the same rule
// the Claude path follows ("references are language-agnostic identifiers").
import { BOOKS } from "./scriptureTopics";

const ENDPOINT = "https://api.cognitive.microsofttranslator.com";
export const azureKey = () => process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_TRANSLATION_KEY || "";
export const azureRegion = () => process.env.AZURE_TRANSLATOR_REGION || "";
/** P2P language code → Azure's (null = Azure doesn't offer it, e.g. Twi). */
export function azureLanguage(code: string): string | null {
  const map: Record<string, string> = { zh: "zh-Hans", "zh-TW": "zh-Hant", tl: "fil", he: "he", tw: "", ak: "" };
  const c = code in map ? map[code] : code;
  return c ? c : null;
}
export class TranslatorError extends Error { constructor(message: string, public code: string) { super(message); } }

// ── Scripture references stay exactly as written ──
const NAMES = [...BOOKS.map((b) => b.name), "Psalm", "Song of Songs"].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const REF = new RegExp(`\\b(?:${NAMES.join("|")})\\.?\\s+\\d{1,3}(?::\\d{1,3}(?:\\s*[-–]\\s*\\d{1,3}(?::\\d{1,3})?)?)?(?:\\s*[-–]\\s*\\d{1,3})?\\b`, "g");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** Plain text → HTML where references can't be translated and line breaks survive. */
export function protect(text: string): string {
  return esc(text).replace(REF, (m) => `<span class="notranslate">${m}</span>`).replace(/\r?\n/g, "<br/>");
}
export function unprotect(html: string): string {
  return unesc(html.replace(/<br\s*\/?>/gi, "\n").replace(/<span class="notranslate">([\s\S]*?)<\/span>/g, "$1").replace(/<\/?span[^>]*>/g, ""));
}

// ── Which values are translated ──
const SKIP_KEY = /^(id|.*_id|.*Id|ids|url|.*_url|.*Url|scriptureRefs|verse_ref|verseRef|reference|ref|refs|code|slug|kind|type|block_type)$/;
type Leaf = { path: (string | number)[]; text: string };
export function collectLeaves(value: unknown, path: (string | number)[] = [], out: Leaf[] = []): Leaf[] {
  const key = path[path.length - 1];
  if (typeof key === "string" && SKIP_KEY.test(key)) return out;
  if (typeof value === "string") { if (value.trim()) out.push({ path, text: value }); return out; }
  if (Array.isArray(value)) value.forEach((v, i) => collectLeaves(v, [...path, i], out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collectLeaves(v, [...path, k], out);
  return out;
}
function setAt(root: Record<string, unknown>, path: (string | number)[], v: string) {
  let o: any = root;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = v;
}

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let fetcher: Fetcher = (u, i) => fetch(u, i) as never;
let wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let RETRIES_429 = 5;
export const setTranslatorFetcherForTests = (f: Fetcher, opts: { noWait?: boolean } = {}) => { fetcher = f; if (opts.noWait) { wait = async () => {}; RETRIES_429 = 2; } };

/** Translates every text value of `source` into `targetLang`; same shape back. Returns the characters used. */
export async function azureTranslate<T extends Record<string, unknown>>(source: T, targetLang: string): Promise<{ result: T; characters: number }> {
  const key = azureKey(), region = azureRegion();
  if (!key) throw new TranslatorError("Azure Translator isn't set up (AZURE_TRANSLATOR_KEY).", "not_configured");
  const to = azureLanguage(targetLang);
  if (!to) throw new TranslatorError(`Azure Translator doesn't support this language (${targetLang}).`, "unsupported_language");
  const result = JSON.parse(JSON.stringify(source)) as T;
  const leaves = collectLeaves(result);
  let characters = 0;
  // Azure: up to 1,000 texts and 50,000 characters per request — batched well inside that.
  for (let i = 0; i < leaves.length;) {
    const batch: Leaf[] = []; let size = 0;
    while (i < leaves.length && batch.length < 100 && (size + leaves[i].text.length < 40_000 || !batch.length)) { size += leaves[i].text.length; batch.push(leaves[i++]); }
    const call = () => fetcher(`${ENDPOINT}/translate?api-version=3.0&from=en&to=${encodeURIComponent(to)}&textType=html`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, ...(region ? { "Ocp-Apim-Subscription-Region": region } : {}), "Content-Type": "application/json" },
      body: JSON.stringify(batch.map((l) => ({ text: protect(l.text) }))),
    });
    // 429 = the free tier's SPEED limit (characters per minute): wait and try again. 403 = the MONTHLY allowance is
    // used up: stop (the free tier never charges). Only the second ends translation for the month.
    let res = await call();
    for (let attempt = 1; res.status === 429 && attempt <= RETRIES_429; attempt++) {
      await wait(Math.min(120_000, 20_000 * attempt));
      res = await call();
    }
    if (res.status === 403) throw new TranslatorError("The free translation allowance for this month is used up (Azure F0). Translation continues next month.", "quota");
    if (res.status === 429) throw new TranslatorError("Azure Translator is busy (free-tier speed limit). Try again in a few minutes.", "rate_limited");
    if (!res.ok) throw new TranslatorError(`Azure Translator error ${res.status}.`, "provider_error");
    const out = (await res.json()) as { translations: { text: string }[] }[];
    out.forEach((o, k) => { setAt(result as Record<string, unknown>, batch[k].path, unprotect(o.translations[0]?.text ?? batch[k].text)); });
    characters += size;
  }
  return { result, characters };
}
