// LANGUAGE REGISTRY — one place that identifies every language P2P shows, and the REPRESENTATIVE country
// flag shown beside its name wherever a participant chooses a language (owner brief 2026-11-13).
//
//   • A flag is for recognising a language at a glance. It does not mean a language belongs to one
//     country, and it says nothing about a speaker's nationality. Languages spoken in many countries get
//     ONE representative flag, used everywhere (`also` lists other major countries, for search and notes).
//   • Existing language IDs are never changed. Each entry's `id` is the code the app already uses (the i18n
//     code where there is one), and `codes` lists the other IDs the same language arrives with elsewhere:
//     ISO 639-3 / 639-2B codes from Bible providers, device voice tags (reduced to their base), and the
//     Dictionary's "hebrew" / "aramaic" / "greek" keys. One language = one entry, whatever its ID.
//   • A language is not a Bible translation and not a voice: translations and voices keep their own records;
//     this only names and flags their language.
//   • Mappings marked `review` need the owner's confirmation (see REVIEW_NOTES); where no country can stand
//     for a language (Aramaic), `country` is null and no flag is shown — never an invented one.
import { flagFromCode } from "@/lib/countryNames";

export interface LanguageEntry {
  /** The ID the app already uses (unchanged). */
  id: string;
  /** Other IDs for the same language seen across the app (ISO 639-3/2B, voice bases, dictionary keys). */
  codes: string[];
  /** The language's name in itself. */
  native: string;
  /** The English name. */
  english: string;
  /** Representative country (ISO 3166 alpha-2), or null when none is representative. */
  country: string | null;
  /** Other countries where it is widely used (information and search only — never a second entry). */
  also?: string[];
  /** Other names people search with. */
  aliases?: string[];
  rtl?: boolean;
  /** Needs the owner's review (reason in REVIEW_NOTES). */
  review?: boolean;
}

const L = (id: string, native: string, english: string, country: string | null, codes: string[] = [], extra: Partial<LanguageEntry> = {}): LanguageEntry =>
  ({ id, native, english, country, codes, ...extra });

export const LANGUAGES: LanguageEntry[] = [
  // ── The 36 app languages (lib/i18n.ts SUPPORTED_LANGUAGES) ──
  L("en", "English", "English", "GB", ["eng"], { also: ["US", "AU", "CA", "NG", "GH", "KE", "IN"], review: true }),
  L("de", "Deutsch", "German", "DE", ["deu", "ger"], { also: ["AT", "CH"] }),
  L("es", "Español", "Spanish", "ES", ["spa"], { also: ["MX", "AR", "CO", "US"], aliases: ["Castellano", "Castilian"] }),
  L("fr", "Français", "French", "FR", ["fra", "fre"], { also: ["CA", "BE", "CH", "CI", "SN", "CD", "CM"] }),
  L("pt", "Português", "Portuguese", "PT", ["por"], { also: ["BR", "AO", "MZ"], review: true }),
  L("it", "Italiano", "Italian", "IT", ["ita"]),
  L("nl", "Nederlands", "Dutch", "NL", ["nld", "dut"], { also: ["BE", "SR"], aliases: ["Flemish"] }),
  L("pl", "Polski", "Polish", "PL", ["pol"]),
  L("ro", "Română", "Romanian", "RO", ["ron", "rum"], { also: ["MD"] }),
  L("el", "Ελληνικά", "Greek", "GR", ["ell", "gre", "greek", "grc"], { also: ["CY"] }),
  L("ru", "Русский", "Russian", "RU", ["rus"]),
  L("uk", "Українська", "Ukrainian", "UA", ["ukr"]),
  L("tr", "Türkçe", "Turkish", "TR", ["tur"], { also: ["CY"] }),
  L("ar", "العربية", "Arabic", "SA", ["ara", "arb"], { also: ["EG", "MA", "DZ", "IQ", "JO", "AE"], rtl: true }),
  L("he", "עברית", "Hebrew", "IL", ["heb", "hebrew", "hbo"], { rtl: true, review: true }),
  L("fa", "فارسی", "Persian", "IR", ["fas", "per", "pes"], { also: ["AF", "TJ"], aliases: ["Farsi", "Dari"], rtl: true }),
  L("hi", "हिन्दी", "Hindi", "IN", ["hin"]),
  L("bn", "বাংলা", "Bengali", "BD", ["ben"], { also: ["IN"], aliases: ["Bangla"] }),
  L("ur", "اردو", "Urdu", "PK", ["urd"], { also: ["IN"], rtl: true }),
  L("ta", "தமிழ்", "Tamil", "IN", ["tam"], { also: ["LK", "SG"] }),
  L("te", "తెలుగు", "Telugu", "IN", ["tel"]),
  L("zh", "中文(简体)", "Chinese (Simplified)", "CN", ["zho", "chi", "cmn", "zh-cn", "zh-hans", "zh-sg"], { also: ["SG"], aliases: ["Mandarin", "Chinese", "Simplified Chinese"] }),
  L("zh-TW", "中文(繁體)", "Chinese (Traditional)", "TW", ["zh-tw", "zh-hant", "zh-hk", "zh-mo"], { also: ["HK", "MO"], aliases: ["Traditional Chinese"], review: true }),
  L("ja", "日本語", "Japanese", "JP", ["jpn"]),
  L("ko", "한국어", "Korean", "KR", ["kor"]),
  L("th", "ภาษาไทย", "Thai", "TH", ["tha"]),
  L("vi", "Tiếng Việt", "Vietnamese", "VN", ["vie"]),
  L("id", "Bahasa Indonesia", "Indonesian", "ID", ["ind"]),
  L("ms", "Bahasa Melayu", "Malay", "MY", ["msa", "may", "zsm"], { also: ["BN", "SG"] }),
  L("sw", "Kiswahili", "Swahili", "KE", ["swa", "swh"], { also: ["TZ", "UG", "CD"] }),
  L("ha", "Hausa", "Hausa", "NG", ["hau"], { also: ["NE", "GH"] }),
  L("yo", "Yorùbá", "Yoruba", "NG", ["yor"], { also: ["BJ"] }),
  L("ig", "Igbo", "Igbo", "NG", ["ibo"]),
  L("tl", "Filipino", "Filipino", "PH", ["tgl", "fil"], { aliases: ["Tagalog"] }),
  L("zu", "isiZulu", "Zulu", "ZA", ["zul"]),
  L("tw", "Twi", "Twi (Akan)", "GH", ["twi", "ak", "aka"], { aliases: ["Akan", "Asante", "Akuapem"] }),
  // ── Languages with a DB row or locale file but not yet in the app list (lib/i18n.ts notes) ──
  L("am", "አማርኛ", "Amharic", "ET", ["amh"]),
  L("cs", "Čeština", "Czech", "CZ", ["ces", "cze"]),
  L("mr", "मराठी", "Marathi", "IN", ["mar"]),
  L("pcm", "Naijá", "Nigerian Pidgin", "NG", [], { aliases: ["Pidgin", "Naija"] }),
  L("af", "Afrikaans", "Afrikaans", "ZA", ["afr"], { also: ["NA"] }),
  L("da", "Dansk", "Danish", "DK", ["dan"]),
  L("no", "Norsk", "Norwegian", "NO", ["nor", "nob", "nb", "nno", "nn"], { aliases: ["Bokmål", "Nynorsk"] }),
  L("pa", "ਪੰਜਾਬੀ", "Punjabi", "IN", ["pan"], { also: ["PK"], aliases: ["Panjabi"], review: true }),
  L("sv", "Svenska", "Swedish", "SE", ["swe"], { also: ["FI"] }),
  // ── Other languages Bible providers can offer (the brief's reference list) ──
  L("wo", "Wolof", "Wolof", "SN", ["wol"], { also: ["GM", "MR"] }),
  L("om", "Afaan Oromoo", "Oromo", "ET", ["orm", "gaz"], { also: ["KE"] }),
  L("so", "Soomaali", "Somali", "SO", ["som"], { also: ["ET", "DJ", "KE"] }),
  L("rw", "Ikinyarwanda", "Kinyarwanda", "RW", ["kin"]),
  L("rn", "Ikirundi", "Kirundi", "BI", ["run"], { aliases: ["Rundi"] }),
  L("xh", "isiXhosa", "Xhosa", "ZA", ["xho"]),
  L("sn", "chiShona", "Shona", "ZW", ["sna"]),
  L("lg", "Luganda", "Luganda", "UG", ["lug"], { aliases: ["Ganda"] }),
  L("ln", "Lingála", "Lingala", "CD", ["lin"], { also: ["CG"] }),
  L("ny", "Chichewa", "Chichewa", "MW", ["nya"], { also: ["ZM"], aliases: ["Chewa", "Nyanja"] }),
  L("mg", "Malagasy", "Malagasy", "MG", ["mlg", "plt"]),
  L("ee", "Eʋegbe", "Ewe", "GH", ["ewe"], { also: ["TG"] }),
  L("gaa", "Gã", "Ga", "GH", []),
  // ── Further languages in the curated Bible library (api-server helloaoRegistry.ts) ──
  L("ach", "Acoli", "Acholi", "UG", [], { also: ["SS"] }),
  L("efi", "Efịk", "Efik", "NG", []),
  L("gu", "ગુજરાતી", "Gujarati", "IN", ["guj"]),
  L("ht", "Kreyòl ayisyen", "Haitian Creole", "HT", ["hat"], { aliases: ["Kreyol", "Haitian"] }),
  L("ki", "Gĩkũyũ", "Kikuyu", "KE", ["kik"]),
  L("kn", "ಕನ್ನಡ", "Kannada", "IN", ["kan"]),
  L("luo", "Dholuo", "Luo", "KE", [], { also: ["TZ"], aliases: ["Dholuo"] }),
  L("ml", "മലയാളം", "Malayalam", "IN", ["mal"]),
  L("my", "မြန်မာ", "Burmese", "MM", ["mya", "bur"], { aliases: ["Myanmar"] }),
  L("nd", "isiNdebele", "North Ndebele", "ZW", ["nde"], { aliases: ["Ndebele"] }),
  L("ne", "नेपाली", "Nepali", "NP", ["nep", "npi"], { also: ["IN"] }),
  L("nyn", "Runyankore", "Runyankore", "UG", [], { aliases: ["Nyankole", "Nkore"] }),
  L("tn", "Setswana", "Tswana", "BW", ["tsn"], { also: ["ZA"] }),
  // ── Biblical original languages (Dictionary / Lexicon filters) ──
  L("arc", "ארמית", "Aramaic", null, ["aramaic", "tmr", "syc"], { rtl: true, review: true }),
];

/** Mappings the owner should confirm (shown in the report and kept here so the reason travels with the code). */
export const REVIEW_NOTES: Record<string, string> = {
  en: "English: the app previously showed 🇺🇸 (copied from p2p_languages.flag_emoji); the brief asks for 🇬🇧. Now 🇬🇧 everywhere; the database column is unchanged (no data change).",
  pt: "Portuguese: previously 🇧🇷 (database column); the brief asks for 🇵🇹. Now 🇵🇹; most Portuguese speakers are in Brazil — confirm.",
  "zh-TW": "Traditional Chinese: 🇹🇼 kept from the existing app; used in Taiwan, Hong Kong and Macau — confirm the representative flag.",
  he: "Hebrew: 🇮🇱 per the brief. The Dictionary/Lexicon 'Hebrew' filter means Biblical Hebrew, which uses the same entry — confirm a modern national flag is wanted there.",
  pa: "Punjabi: 🇮🇳 (Gurmukhi script, as in the unused locale file); widely spoken in Pakistan in Shahmukhi script — confirm.",
  arc: "Aramaic: no country can stand for it (an ancient language with modern Neo-Aramaic communities in several countries). No flag shown — confirm, or choose one.",
};

// ── Lookup ──
const norm = (s: string) => s.trim().toLowerCase().replace(/_/g, "-");
const index = new Map<string, LanguageEntry>();
for (const e of LANGUAGES) for (const c of [e.id, ...e.codes]) {
  const k = norm(c);
  if (index.has(k) && index.get(k) !== e) throw new Error(`language code ${c} claimed twice`);
  index.set(k, e);
}
/** The registry entry for any language ID the app uses (i18n code, ISO 639-3, device voice tag, dictionary key). */
export function languageEntry(id: string | null | undefined): LanguageEntry | null {
  if (!id) return null;
  const k = norm(String(id));
  return index.get(k) ?? index.get(k.split("-")[0]) ?? null;
}
/** Representative flag emoji for a language, or null (unknown language, or none is representative). */
export function languageFlag(id: string | null | undefined): string | null {
  const e = languageEntry(id);
  return e?.country ? flagFromCode(e.country) : null;
}
/** English name for a language ID ("" when unknown — callers keep their own fallback). */
export const languageEnglishName = (id: string | null | undefined) => languageEntry(id)?.english ?? "";
export const languageNativeName = (id: string | null | undefined) => languageEntry(id)?.native ?? "";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Does a language match a search? Native name, English name, its ID, any of its codes or aliases. */
export function languageMatches(id: string, q: string): boolean {
  const query = fold(q);
  if (!query) return true;
  const e = languageEntry(id);
  const hay = [id, ...(e ? [e.id, e.native, e.english, ...e.codes, ...(e.aliases ?? [])] : [])].map(fold);
  return hay.some((h) => h.includes(query));
}
