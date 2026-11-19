// RECORDED BIBLE AUDIO from the owner's API.Bible plan (owner 2026-11-19: "new licences … these translations have
// audio too"). Each TEXT edition P2P shows is paired with ITS OWN audio edition — the same publisher's same version
// (checked by name and edition, recorded here by hand; never guessed from the language alone). A chapter's recording
// is a short-lived signed link from API.Bible: it is streamed, never stored, cached offline or redistributed by P2P,
// and the API key never leaves the server. Authorised recorded audio always comes before any generated voice.
import type { TranslationRow } from "./bibleLicence";
import { providerOf } from "./bibleLicence";

/** API.Bible TEXT id → its audio edition in the owner's plan. `nt` = the recording covers the New Testament only. */
export const AUDIO_EDITIONS: Record<string, { audioId: string; label: string; nt?: boolean }> = {
  "b17e246951402e50-01": { audioId: "26b7a1cd2f8f4878-01", label: "Biblica® Open New Arabic Version, Audio Edition" },           // ONAV
  "efd8a351a07d4264-01": { audioId: "2d681a4ce8b8479f-01", label: "Biblica® Open Bengali Contemporary Version, Audio Edition" },  // BCV
  "2133003bb8b5e62b-01": { audioId: "9c67e54fbdca4e3e-01", label: "Biblica® Open Hindi Contemporary Version, Audio Edition" },    // HCV
  "a36fc06b086699f1-02": { audioId: "1b319c1d55564e45-01", label: "Biblica® Open Igbo Contemporary Bible™, Audio Edition" },      // BIUO
  "611f8eb23aec8f13-01": { audioId: "3533f7929cde418c-01", label: "Biblica® Open Kiswahili Contemporary Version™, Audio Edition" }, // ONEN
  "032ec262506b719f-01": { audioId: "232eeaf9dc544361-01", label: "Biblica® Open Indian Tamil Contemporary Version™, Audio Edition" }, // OTCV
  "b6aee081108c0bc6-01": { audioId: "6e21c09d8edb4838-01", label: "Biblica® Open Akuapem Twi Contemporary Bible™, Audio Edition" }, // WAKNA
  "18f6cf27f7b43297-01": { audioId: "03d2ea6f8f7c4a19-01", label: "Biblica® Open Asante Twi Contemporary Bible™, Audio Edition" },  // WASNA
  "b8d1feac6e94bd74-01": { audioId: "2691a33c58f144c3-01", label: "Biblica® Open Yoruba Contemporary Bible, Audio Edition" },      // BMYO
  // Text editions proposed in migration 256 (they play as soon as their text rows exist):
  "317e03834065a236-01": { audioId: "aadc8a2f4bdb467b-01", label: "Berean Standard Audio Bible (non-drama)" },                    // BSB
  "9879dbb7cfe39e4d-01": { audioId: "105a06b6146d11e7-01", label: "World English Bible 2013 (dramatised New Testament)", nt: true }, // WEB
  "1e8ab327edbce67f-01": { audioId: "b35e70bce95d4261-01", label: "Indian Revised Version (IRV) Hindi – 2019" },                   // IRVHin
  "4c3eda00cd317568-01": { audioId: "7fb0e05721aa424f-01", label: "Bengali Indian Revised Version (IRV)" },                        // IRVBen
  "03a021185023710b-01": { audioId: "5b168850d8ff4fe2-01", label: "Tamil Indian Revised Version (IRV)" },                          // IRVTam
  "5b835ce16a1703ff-01": { audioId: "0d7b2453e9ae4513-01", label: "Telugu Indian Revised Version (IRV)" },                         // IRVTel
  "de0270810140edf9-01": { audioId: "9e11d376e401469c-01", label: "Urdu Indian Revised Version (IRV)" },                           // IRVUrd
};
const NT_BOOKS = new Set(["MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"]);

export function audioEditionFor(r: TranslationRow) {
  if (providerOf(r) !== "api.bible" || !r.api_bible_id || r.is_licensed_confirmed === false) return null;
  return AUDIO_EDITIONS[r.api_bible_id] ?? null;
}
export class BibleAudioError extends Error { constructor(message: string, public status: number) { super(message); } }

type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let fetcher: Fetcher = (u, i) => fetch(u, i) as never;
export const setAudioFetcherForTests = (f: Fetcher) => { fetcher = f; };
// Signed links last about an hour; one link per chapter is reused until shortly before it expires (fewer calls).
const links = new Map<string, { url: string; expiresAt: number }>();

/** A chapter's recording: a short-lived streaming link, the reader/edition, and the publisher's copyright. */
export async function chapterAudio(r: TranslationRow, book: string, chapter: number): Promise<{ url: string; expiresAt: string; reader: string; copyright: string | null }> {
  const ed = audioEditionFor(r);
  if (!ed) throw new BibleAudioError("This translation has no recorded audio.", 404);
  if (ed.nt && !NT_BOOKS.has(book)) throw new BibleAudioError("This recording covers the New Testament only.", 404);
  const key = process.env.API_BIBLE_KEY;
  if (!key) throw new BibleAudioError("Recorded audio isn't available right now.", 503);
  const id = `${ed.audioId}:${book}.${chapter}`;
  const hit = links.get(id);
  if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return { url: hit.url, expiresAt: new Date(hit.expiresAt).toISOString(), reader: ed.label, copyright: null };
  const res = await fetcher(`https://rest.api.bible/v1/audio-bibles/${ed.audioId}/chapters/${book}.${chapter}`, { headers: { "api-key": key } });
  if (res.status === 404 || res.status === 400) throw new BibleAudioError("This chapter has no recording.", 404);
  if (!res.ok) throw new BibleAudioError("Recorded audio isn't available right now.", 502);
  const d = ((await res.json()) as { data?: { resourceUrl?: string; expiresAt?: number; copyright?: string } }).data ?? {};
  if (!d.resourceUrl || !/^https:\/\//.test(d.resourceUrl)) throw new BibleAudioError("This chapter has no recording.", 404);
  const expiresAt = (Number(d.expiresAt) || Math.floor(Date.now() / 1000) + 1800) * 1000;
  links.set(id, { url: d.resourceUrl, expiresAt });
  if (links.size > 2000) for (const [k, v] of links) if (v.expiresAt < Date.now()) links.delete(k);
  return { url: d.resourceUrl, expiresAt: new Date(expiresAt).toISOString(), reader: ed.label, copyright: d.copyright ? d.copyright.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) : null };
}
