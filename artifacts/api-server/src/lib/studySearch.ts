// STUDY WORKSPACE SEARCH (owner brief 2026-11-18, "My Plan — personal Bible study workspace"). Pure rules over
// data the API already has; routes/studyWorkspace.ts feeds it. Any word, subject or question → findings in eight
// groups, each with a count, its source and WHY it is there. Source-grounded only:
//   • Scriptures — DIRECT: the words found in the Bible text (the translation's own search); CONCEPTUAL: passages
//     P2P editors chose for a Scripture topic whose name matches the search.
//   • Bible Stories — Kingdom Stories whose chapters retell or quote those passages (lib/planDiscovery overlap).
//   • Definitions — Easton's Bible Dictionary articles titled with the search's words.
//   • Greek and Hebrew — original-language words whose English meanings match (STEPBible lexicon index).
//   • Commentaries / Cross-references — the study tools for the passages found (each opens its own source).
//   • (Biblical Themes group REMOVED 2026-11-18, owner: "remove biblical themes entirely". Topics still supply their
//     editor-chosen passages to Scriptures, and connected topics still appear in the Connected-concepts row.)
//   • Historical Context — Easton articles that discuss the words in their text (background, not Scripture).
//   • Connected concepts — the other ways the BSB translates the original-language words behind the search
//     (e.g. χάρις G5485 is rendered grace, favor, thanks): a lexical link from the STEPBible/BSB data, shown with
//     the word, its Strong's number and how often — never a theological claim of our own.
// Never keyword "concepts": a connection is shown only when a record links it (a shared passage, a title, a lexicon entry).
import { overlaps, passageSpan, type DiscoveryIndex, type IndexedTopic } from "./planDiscovery";
import { passageDisplay, type Passage } from "./studyPlans";

export const STUDY_GROUPS = ["scriptures", "stories", "definitions", "greek_hebrew", "commentaries", "cross_references", "history", "mine"] as const;
export type StudyGroup = (typeof STUDY_GROUPS)[number];
export interface Finding {
  key: string; group: StudyGroup; title: string; subtitle: string | null; kind: string; ref: Record<string, unknown>;
  /** "direct" = the words themselves; "conceptual" = linked by an editorial record; "background" = reference material. */
  match: "direct" | "conceptual" | "background";
  why: { code: string; params?: Record<string, string | number> };
  source: string;
}
// Words too common to identify a subject on their own (they still count inside a longer phrase).
const GENERIC = new Set(["again", "way", "ways", "god", "gods", "lord", "jesus", "christ", "holy", "the", "a", "an", "of", "to", "in", "and", "my", "me", "i", "how", "what", "why", "is", "be", "being",
  "with", "for", "on", "do", "does", "can", "will", "about", "your", "his", "her", "our", "we", "you", "it", "that", "this", "who", "when", "where"]);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Shorter forms to try when a word has no lexicon entry (lordship → lord, forgiveness → forgive, overcoming → overcome). */
export function stems(w: string): string[] {
  const out: string[] = [];
  for (const [suf, rep] of [["ship", ""], ["ness", ""], ["ment", ""], ["ing", "e"], ["ing", ""], ["ed", ""], ["s", ""]] as const)
    if (w.endsWith(suf) && w.length - suf.length >= 3) out.push(w.slice(0, -suf.length) + rep);
  return [...new Set(out)];
}
const FILLER = new Set(["then", "may", "but", "and", "will", "shall", "let", "us", "i", "the", "a", "an", "to", "of", "my", "his", "her", "your", "our", "their", "be", "is", "was", "not", "for", "in", "with", "who", "you", "he", "she", "they", "we", "it"]);
export type Concept = { concept: string; kind: "lexicon"; lemma: string; strongs: string; count: number; via: string } | { concept: string; kind: "easton"; article: string; articleId: string };
/** Lexical concepts: other single-word BSB renderings of a lexicon word whose own meaning (gloss) is the searched
 *  word — e.g. χάρις "grace" is also rendered favor, gracious. Strict on purpose: no phrases, no rare renderings,
 *  no forms of the searched word itself. */
export function conceptsFrom(records: { id: string; lemma: string; gloss: string; renderings: { text: string; count: number }[] }[], q: string, max = 6): Concept[] {
  const own = [...new Set([...contentWords(q), ...contentWords(q).flatMap(stems)])];
  const best = new Map<string, Concept & { kind: "lexicon" }>();
  for (const r of records) {
    const gloss = fold(r.gloss);
    if (!own.some((w) => gloss.split(" ").some((g) => g === w || g.startsWith(w)))) continue; // the word must MEAN the search
    for (const rd of r.renderings) {
      const words = fold(rd.text).split(" ").filter((w) => w && !FILLER.has(w));
      if (words.length !== 1 || rd.count < 3) continue;
      let c = words[0];
      if (c.length < 4 || GENERIC.has(c) || own.some((w) => c.startsWith(w) || w.startsWith(c))) continue;
      if (c.endsWith("s") && best.has(c.slice(0, -1))) continue;
      if (best.has(c + "s")) { const plural = best.get(c + "s")!; best.delete(c + "s"); best.set(c, { ...plural, concept: c, count: Math.max(plural.count, rd.count) }); continue; }
      const prev = best.get(c);
      if (!prev || rd.count > prev.count) best.set(c, { concept: c, kind: "lexicon", lemma: r.lemma, strongs: r.id, count: rd.count, via: own.find((w) => gloss.includes(w)) ?? own[0] });
    }
  }
  return [...best.values()].sort((x, y) => y.count - x.count).slice(0, max);
}
/** Easton concepts: from the article TITLED with the search (not one that merely mentions it) — Easton's own
 *  "see" cross-references, and subjects the article discusses that P2P editors have also made a Scripture topic. */
export function eastonConcepts(article: { id: string; title: string; plain: string; paragraphs: unknown[][] } | null, topicTitles: string[], q: string, max = 8): Concept[] {
  if (!article) return [];
  const own = new Set([...contentWords(q), ...contentWords(q).flatMap(stems), ...contentWords(article.title)]);
  const out: Concept[] = [];
  const add = (c: string) => { const f = fold(c); if (f.length >= 4 && !own.has(f) && !out.some((x) => x.concept === f)) out.push({ concept: f, kind: "easton", article: article.title, articleId: article.id }); };
  for (const seg of article.paragraphs.flat()) if (Array.isArray(seg) && seg[0] === "s" && typeof seg[2] === "string") add(seg[2]);
  const text = ` ${fold(article.plain)} `;
  for (const t of topicTitles) { const f = fold(t); if (f.split(" ").length <= 2 && text.includes(` ${f} `)) add(t); }
  return out.slice(0, max);
}
export const contentWords = (q: string) => fold(q).split(" ").filter((w) => w.length > 2 && !GENERIC.has(w)).map((w) => w.replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})s$/, ""));

/** Topics the search names: the whole title, or every content word of the title appears in the search (or v.v.). */
export function matchTopics(q: string, topics: IndexedTopic[]): IndexedTopic[] {
  const fq = fold(q), qw = new Set(contentWords(q));
  return topics.filter((t) => {
    const ft = fold(t.title);
    if (ft === fq || fq.includes(ft) && ft.length >= 4) return true;
    const tw = contentWords(t.title);
    return tw.length > 0 && (tw.every((w) => qw.has(w)) || ([...qw].length > 0 && [...qw].every((w) => tw.includes(w))));
  });
}
/** Topics connected to these by sharing at least one editor-chosen passage (most shared first). */
export function connectedTopics(matched: IndexedTopic[], topics: IndexedTopic[], max = 8): { topic: IndexedTopic; shared: number; via: string }[] {
  const mine = matched.flatMap((t) => t.passages.map((p) => passageSpan(p.passage)));
  const names = new Set(matched.map((t) => t.slug));
  return topics.filter((t) => !names.has(t.slug)).map((t) => {
    const hits = t.passages.filter((p) => mine.some((m) => overlaps(m, passageSpan(p.passage))));
    return { topic: t, shared: hits.length, via: hits[0] ? passageDisplay(hits[0].passage) : "" };
  }).filter((x) => x.shared > 0).sort((a, b) => b.shared - a.shared).slice(0, max);
}

export interface SearchInputs {
  q: string;
  ix: DiscoveryIndex;
  bible: { translation: string; total: number; results: { bookCode: string; chapter: number; verse: number; reference: string; text: string }[]; usedQuery?: string } | { unavailable: string };
  articles: { id: string; title: string; rank: number; mentions: number; preview: string }[];
  words: { key: string; display: string; ids: string[]; languages: string[] }[];
  /** Other BSB renderings of the matched original-language words (connected concepts), with their evidence. */
  concepts?: Concept[];
  /** A Scripture reference typed as the search ("John 3:16") — the passage is studied from every side. */
  reference?: Passage | null;
  /** The typed passage's text in the person's translation (when it could be read), and that translation. */
  referenceText?: { text: string; translation: string } | null;
  /** The person's OWN notes, highlights and playlists that match (never anyone else's). */
  mine?: { kind: "note" | "highlight" | "playlist"; id: string; title: string; subtitle: string | null; ref: Record<string, unknown> }[];
  /** Verses for EACH word of a several-word search ("lordship", "jesus"), so every group covers both words too. */
  termVerses?: { term: string; translation: string; results: { bookCode: string; chapter: number; verse: number; reference: string; text: string }[] }[];
}
/** Builds the eight groups (pure). */
export function buildStudy(inp: SearchInputs) {
  const out: Finding[] = [];
  const passages: Passage[] = [];
  const addPassage = (p: Passage) => { if (!passages.some((x) => x.book === p.book && x.chapter === p.chapter && x.startVerse === p.startVerse)) passages.push(p); };
  // A typed reference: the passage itself, the topics that include it, its original words (then its stories,
  // commentaries and cross-references follow below from the passage list).
  if (inp.reference) {
    const rp = inp.reference;
    addPassage(rp);
    out.push({ key: `bible:${passageDisplay(rp)}`, group: "scriptures", title: passageDisplay(rp), subtitle: inp.referenceText?.text ?? null, kind: "bible_passage", ref: { ...rp }, match: "direct",
      why: { code: "referenceTyped" }, source: inp.referenceText?.translation ?? "Your search" });
    out.push({ key: `original:${passageDisplay(rp)}`, group: "greek_hebrew", title: passageDisplay(rp), subtitle: null, kind: "deep_study", ref: { ...rp, tab: "original" }, match: "direct", why: { code: "originalWordsOf", params: { passage: passageDisplay(rp) } }, source: "BSB interlinear + STEPBible lexicons" });
  }
  // Scriptures — direct (the words in the text).
  if ("results" in inp.bible) for (const r of inp.bible.results) {
    const p = { book: r.bookCode, chapter: r.chapter, startVerse: r.verse, endVerse: r.verse };
    addPassage(p);
    const usedOther = !!inp.bible.usedQuery && inp.bible.usedQuery !== inp.q;
    out.push({ key: `bible:${r.reference}`, group: "scriptures", title: r.reference, subtitle: r.text, kind: "bible_passage", ref: p, match: "direct",
      why: usedOther ? { code: "wordsInTextPart", params: { translation: inp.bible.translation, words: inp.bible.usedQuery! } } : { code: "wordsInText", params: { translation: inp.bible.translation } }, source: inp.bible.translation });
  }
  // Scriptures — each word of the search on its own (after the verses that have them all).
  for (const tv of inp.termVerses ?? []) for (const r of tv.results) {
    const p = { book: r.bookCode, chapter: r.chapter, startVerse: r.verse, endVerse: r.verse };
    addPassage(p);
    out.push({ key: `bible:${r.reference}`, group: "scriptures", title: r.reference, subtitle: r.text, kind: "bible_passage", ref: p, match: "direct",
      why: { code: "wordsInTextPart", params: { translation: tv.translation, words: tv.term } }, source: tv.translation });
  }
  // Scriptures — conceptual (editor-chosen passages of the matched topics).
  const topics = matchTopics(inp.q, inp.ix.topics);
  for (const t of topics) for (const tp of t.passages) {
    addPassage(tp.passage);
    out.push({ key: `bible:${passageDisplay(tp.passage)}`, group: "scriptures", title: passageDisplay(tp.passage), subtitle: tp.title, kind: "bible_passage", ref: { ...tp.passage }, match: "conceptual",
      why: { code: tp.core ? "topicCore" : "topicSupporting", params: { topic: t.title } }, source: "P2P editors (Explore Scripture by Topic)" });
  }
  // Bible Stories — chapters retelling / quoting those passages.
  const spans = passages.map(passageSpan);
  for (const st of inp.ix.stories) {
    const hit = st.chapters.find((ch) => ch.spans.some((sp) => spans.some((m) => overlaps(m, sp))));
    if (!hit) continue;
    const told = hit.narrative.some((sp) => spans.some((m) => overlaps(m, sp)));
    out.push({ key: `story:${st.id}`, group: "stories", title: st.title, subtitle: hit.title, kind: "kingdom_story", ref: { id: st.id, chapterId: hit.id }, match: told ? "conceptual" : "background",
      why: { code: told ? "storyRetells" : "storyQuotes", params: { chapter: hit.number } }, source: "P2P Kingdom Stories" });
  }
  // Definitions and history (Easton's) — titled vs discussed.
  for (const a of inp.articles) {
    const titled = a.rank <= 6;
    out.push({ key: `article:${a.id}`, group: titled ? "definitions" : "history", title: a.title, subtitle: a.preview, kind: "reference_article", ref: { id: a.id },
      match: "background", why: titled ? { code: "articleTitle" } : { code: "articleMentions", params: { count: a.mentions } }, source: "Easton's Bible Dictionary (1897, public domain)" });
  }
  // Greek and Hebrew — words whose English meaning matches.
  for (const w of inp.words) out.push({ key: `word:${w.key}`, group: "greek_hebrew", title: w.display, subtitle: w.ids.slice(0, 6).join(" · "), kind: "dictionary_term", ref: { key: w.key }, match: "direct",
    why: { code: "meaningMatches", params: { count: w.ids.length, languages: w.languages.join(", ") } }, source: "STEPBible lexicons (TBESH / TBESG, CC BY 4.0)" });
  // Commentaries and cross-references — for the first passages found (each opens its own source).
  const chapters: Passage[] = [];
  for (const p of passages) if (!chapters.some((c) => c.book === p.book && c.chapter === p.chapter)) chapters.push({ book: p.book, chapter: p.chapter });
  for (const c of chapters.slice(0, 8)) {
    const d = passageDisplay(c);
    out.push({ key: `commentary:${d}`, group: "commentaries", title: d, subtitle: null, kind: "commentary", ref: { ...c }, match: "background", why: { code: "commentaryOn", params: { passage: d } }, source: "Deep Study commentaries" });
    out.push({ key: `xref:${d}`, group: "cross_references", title: d, subtitle: null, kind: "deep_study", ref: { ...c, tab: "cross" }, match: "background", why: { code: "crossRefsFor", params: { passage: d } }, source: "OpenBible.info cross references (CC BY)" });
  }
  // My own notes, highlights and playlists.
  for (const m of inp.mine ?? []) out.push({ key: `mine:${m.kind}:${m.id}`, group: "mine", title: m.title, subtitle: m.subtitle, kind: m.kind === "playlist" ? "my_playlist" : "bible_passage", ref: m.ref,
    match: "direct", why: { code: m.kind === "note" ? "myNote" : m.kind === "highlight" ? "myHighlight" : "myPlaylist" }, source: "Only you can see this" });
  // One entry per key (the first, strongest reason wins).
  const seen = new Set<string>();
  const findings = out.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
  const counts = Object.fromEntries(STUDY_GROUPS.map((g) => [g, findings.filter((f) => f.group === g).length])) as Record<StudyGroup, number>;
  const partial = "results" in inp.bible && inp.bible.usedQuery && inp.bible.usedQuery !== inp.q ? inp.bible.usedQuery : null;
  // The concept row: sourced concepts first, then topics linked to the matched ones by shared editor passages.
  const conceptRow = [...(inp.concepts ?? []).map((c) => c.concept), ...connectedTopics(topics, inp.ix.topics).map((c) => c.topic.title)]
    .filter((c, i, a) => a.findIndex((x) => fold(x) === fold(c)) === i).slice(0, 12);
  return { q: inp.q, findings, counts, topics: topics.map((t) => t.title), concepts: conceptRow,
    bibleTotal: "results" in inp.bible ? inp.bible.total : null,
    bibleNote: "unavailable" in inp.bible ? inp.bible.unavailable : partial ? `No verse contains every word of your search, so these verses contain “${partial}”.` : null };
}
