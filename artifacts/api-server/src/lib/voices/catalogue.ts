// P2P VOICES — the shared catalogue. Each enabled provider's OWN account voice list is fetched dynamically, cached
// (memory, plus the database table p2p_voice_catalogue when migration 254 is applied so a restart keeps the last
// verified list), refreshed every 12 hours, and — when a provider is down — the last verified list is served with
// `stale: true` (its voices still listed, so a chosen voice isn't silently swapped). Nothing is hard-coded.
import { supabaseServiceRole as db } from "../supabase";
import { logger } from "../logger";
import { PROVIDERS, CANDIDATES } from "./providers";
import type { Characteristic, Presentation, ProviderId, ProviderStatus, Voice, VoiceProvider } from "./types";

const TTL_MS = 12 * 3600_000;
const FAIL_RETRY_MS = 5 * 60_000;
interface Entry { voices: Voice[]; refreshedAt: string | null; checkedAt: number; stale: boolean; error: string | null }
const cache = new Map<ProviderId, Entry>();
const loading = new Map<ProviderId, Promise<Entry>>();
let providersOverride: VoiceProvider[] | null = null;
/** Tests only: replace the provider list (fakes), and clear the cache. */
export function setProvidersForTests(p: VoiceProvider[] | null) { providersOverride = p; cache.clear(); loading.clear(); }
export const providers = () => providersOverride ?? PROVIDERS;

async function persisted(id: ProviderId): Promise<Entry | null> {
  if (providersOverride) return null;
  try {
    const { data, error } = await db.from("p2p_voice_catalogue").select("voices,refreshed_at").eq("provider", id).maybeSingle();
    if (error || !data) return null;
    return { voices: (data as { voices: Voice[] }).voices ?? [], refreshedAt: (data as { refreshed_at: string }).refreshed_at, checkedAt: 0, stale: true, error: null };
  } catch { return null; }
}
async function persist(id: ProviderId, e: Entry) {
  if (providersOverride) return;
  try { await db.from("p2p_voice_catalogue").upsert({ provider: id, voices: e.voices, refreshed_at: e.refreshedAt }, { onConflict: "provider" }); } catch { /* table not applied yet: memory only */ }
}

async function load(p: VoiceProvider, force = false): Promise<Entry> {
  const hit = cache.get(p.id);
  const age = hit ? Date.now() - hit.checkedAt : Infinity;
  if (hit && !force && (hit.error ? age < FAIL_RETRY_MS : age < TTL_MS)) return hit;
  const running = loading.get(p.id);
  if (running) return running; // one refresh at a time per provider
  const job = (async (): Promise<Entry> => {
    const ctl = new AbortController();
    try {
      const voices = await p.listVoices(ctl.signal);
      const e: Entry = { voices, refreshedAt: new Date().toISOString(), checkedAt: Date.now(), stale: false, error: null };
      cache.set(p.id, e);
      void persist(p.id, e);
      return e;
    } catch (err) {
      const last = hit ?? (await persisted(p.id));
      const e: Entry = { voices: last?.voices ?? [], refreshedAt: last?.refreshedAt ?? null, checkedAt: Date.now(), stale: true, error: (err as Error)?.message ?? "unavailable" };
      logger.warn({ provider: p.id, code: (err as { code?: string })?.code }, "voices: catalogue refresh failed — serving the last verified list");
      cache.set(p.id, e);
      return e;
    } finally { loading.delete(p.id); }
  })();
  loading.set(p.id, job);
  return job;
}

export function providerStatuses(): ProviderStatus[] {
  return providers().map((p) => ({ id: p.id, name: p.name, role: p.role, ...p.status(), policy: p.policy }));
}
export const candidates = () => CANDIDATES;

/** Every voice of every ENABLED provider (a disabled provider contributes nothing, not even cached voices). */
export async function allVoices(force = false): Promise<{ voices: Voice[]; providers: (ProviderStatus & { refreshedAt: string | null; stale: boolean; count: number })[] }> {
  const ps = providers();
  const entries = await Promise.all(ps.map(async (p) => (p.status().enabled ? { p, e: await load(p, force) } : { p, e: null })));
  const voices = entries.flatMap(({ e }) => e?.voices ?? []);
  return { voices, providers: entries.map(({ p, e }) => ({ id: p.id, name: p.name, role: p.role, ...p.status(), policy: p.policy, refreshedAt: e?.refreshedAt ?? null, stale: !!e?.stale, count: e?.voices.length ?? 0 })) };
}
/** A provider whose audio may not be kept (policy.offlineAllowed false) is offered only to app versions that keep no
 *  copy (they send policy=1 / honoursPolicy). Older apps keep every P2P Voice clip for offline use. */
export const liveOnly = (v: Voice) => v.canSynthesize && providers().find((p) => p.id === v.provider)?.policy.offlineAllowed === false;
const forClient = (vs: Voice[], honoursPolicy: boolean) => (honoursPolicy ? vs : vs.filter((v) => !liveOnly(v)));
export async function voiceById(id: string): Promise<Voice | null> {
  const provider = id.split(":")[0] as ProviderId;
  const p = providers().find((x) => x.id === provider);
  if (!p || !p.status().enabled) return null;
  return (await load(p)).voices.find((v) => v.id === id) ?? null;
}

export interface CatalogueQuery { language?: string | null; accent?: string | null; provider?: ProviderId | null; presentation?: Presentation | null; characteristic?: Characteristic | null;
  q?: string | null; purpose?: "everyday" | "story" | null; page?: number; pageSize?: number; honoursPolicy?: boolean }
/** Filtered, paginated, with facets that only list values present (so the app never shows an empty filter). */
export async function catalogue(cq: CatalogueQuery) {
  const { voices, providers: ps } = await allVoices();
  // Purpose: ElevenLabs voices are listed for previews/official narration context only; synthesis needs canSynthesize.
  const base = forClient(voices, !!cq.honoursPolicy).filter((v) => v.status === "available" && (cq.purpose === "story" || cq.purpose === "everyday" ? v.canSynthesize : true));
  const q = (cq.q ?? "").trim().toLowerCase();
  const match = (v: Voice, skip?: keyof CatalogueQuery) =>
    (skip === "language" || !cq.language || v.language === cq.language.toLowerCase())
    && (skip === "accent" || !cq.accent || v.accent === cq.accent)
    && (skip === "provider" || !cq.provider || v.provider === cq.provider)
    && (skip === "presentation" || !cq.presentation || v.presentation === cq.presentation)
    && (skip === "characteristic" || !cq.characteristic || v.characteristics.includes(cq.characteristic))
    && (!q || `${v.name} ${v.accent} ${v.languageName} ${v.locale}`.toLowerCase().includes(q));
  const list = base.filter((v) => match(v)).sort((a, b) => a.languageName.localeCompare(b.languageName) || a.accent.localeCompare(b.accent) || a.name.localeCompare(b.name));
  const facet = <K extends string>(skip: keyof CatalogueQuery, key: (v: Voice) => K | K[] | null) => {
    const m = new Map<K, number>();
    for (const v of base.filter((x) => match(x, skip))) for (const k of ([] as K[]).concat(key(v) ?? [])) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
  };
  const pageSize = Math.max(1, Math.min(100, cq.pageSize ?? 40)), page = Math.max(0, cq.page ?? 0);
  return {
    total: list.length, page, pageSize, voices: list.slice(page * pageSize, page * pageSize + pageSize),
    facets: {
      language: facet("language", (v) => v.language).map((x) => ({ ...x, name: base.find((v) => v.language === x.key)?.languageName ?? x.key })),
      accent: facet("accent", (v) => v.accent), provider: facet("provider", (v) => v.provider),
      presentation: facet("presentation", (v) => v.presentation), characteristic: facet("characteristic", (v) => v.characteristics),
    },
    providers: ps.map(({ id, name, enabled, stale, refreshedAt, count }) => ({ id, name, enabled, stale, refreshedAt, count })),
  };
}

// ── The DEFAULT P2P Voice per language (owner 2026-11-18: P2P Voice first, the phone's voice only as backup) ──
// Override with VOICES_DEFAULTS='{"en":"azure:en-GB-SoniaNeural"}' (only voices that really exist are used). Otherwise
// chosen from the real catalogue: the language's main locale (English → British English, as in the owner's brief),
// a narrator voice, female first (the brief's example), a synthesis-capable provider.
const MAIN_LOCALE: Record<string, string> = { en: "en-GB", fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-BR", sw: "sw-KE", ar: "ar-SA", hi: "hi-IN", yo: "yo-NG", ha: "ha-NG", ig: "ig-NG", am: "am-ET", zu: "zu-ZA", af: "af-ZA" };
export async function defaultVoices(honoursPolicy = false): Promise<Record<string, Voice>> {
  const { voices } = await allVoices();
  const usable = forClient(voices, honoursPolicy).filter((v) => v.status === "available" && v.canSynthesize);
  let overrides: Record<string, string> = {};
  try { overrides = JSON.parse(process.env.VOICES_DEFAULTS ?? "{}"); } catch { overrides = {}; }
  const out: Record<string, Voice> = {};
  for (const lang of [...new Set(usable.map((v) => v.language))]) {
    const forced = overrides[lang] ? usable.find((v) => v.id === overrides[lang]) : null;
    if (forced) { out[lang] = forced; continue; }
    const score = (v: Voice) => (v.locale === MAIN_LOCALE[lang] ? 8 : 0) + (v.characteristics.includes("narrator") ? 4 : 0) + (v.presentation === "female" ? 2 : 0)
      + (v.provider === "azure" ? 1 : 0) - (/multilingual|hd|dragon|turbo/i.test(`${v.providerVoiceId} ${v.model ?? ""}`) ? 3 : 0);
    out[lang] = usable.filter((v) => v.language === lang).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0];
  }
  return out;
}

/** Which languages P2P can actually speak, and through whom (only enabled providers' real voices). */
export async function capabilities(honoursPolicy = false) {
  const { voices: all } = await allVoices();
  const voices = forClient(all, honoursPolicy);
  const m = new Map<string, { language: string; languageName: string; providers: Set<ProviderId>; presentations: Set<string>; synth: boolean }>();
  for (const v of voices.filter((x) => x.status === "available")) {
    const c = m.get(v.language) ?? { language: v.language, languageName: v.languageName, providers: new Set(), presentations: new Set(), synth: false };
    c.providers.add(v.provider); if (v.presentation) c.presentations.add(v.presentation); if (v.canSynthesize) c.synth = true;
    m.set(v.language, c);
  }
  return [...m.values()].map((c) => ({ language: c.language, languageName: c.languageName, providers: [...c.providers], presentations: [...c.presentations], canListen: c.synth }))
    .sort((a, b) => a.languageName.localeCompare(b.languageName));
}
