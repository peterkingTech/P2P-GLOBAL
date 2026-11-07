// Kingdom Stories in the reader's content language (migration 243). An APPROVED translation of a
// chapter (p2p_content_translations, content_type kingdom_story_chapter) is laid over the English
// chapter before it is sent: title, story text, Story Lessons, Personal Reflections and the
// Comprehensive Check. The translation stores the chapter part by part (metadata.parts — the same
// parts the Listen player reads, keyed "title", "p0".., "lesson0".., "reflection:<questionId>",
// "check:label", "check:<questionId>"), so the text shown and its narration always line up.
// Anything without a translated part stays in English; drafts and rejected translations are never shown.
import { supabaseServiceRole as db } from "./supabase";

type Part = { key: string; text: string };
type Q = { id: string; question: string };
type Chapter = {
  id: string; title: string; narrative: string; lessons: string[]; reflections: string[];
  learning?: { reflectionQuestions?: Q[]; check?: { title: string; questions: Q[] } | null; [k: string]: unknown };
  [k: string]: unknown;
};

export const LANG_RE = /^[a-z]{2,3}$/;

/** Approved chapter translations for these chapters in `lang`, by chapter id. */
export async function approvedChapterTranslations(chapterIds: string[], lang: string): Promise<Map<string, Part[]>> {
  const out = new Map<string, Part[]>();
  if (!chapterIds.length || !LANG_RE.test(lang) || lang === "en") return out;
  const { data } = await db.from("p2p_content_translations").select("content_id,metadata")
    .eq("content_type", "kingdom_story_chapter").eq("language_code", lang).eq("status", "approved").in("content_id", chapterIds);
  for (const r of (data ?? []) as { content_id: string; metadata: { parts?: Part[] } | null }[]) {
    const parts = (r.metadata?.parts ?? []).filter((p) => p && typeof p.key === "string" && typeof p.text === "string");
    if (parts.length) out.set(r.content_id, parts);
  }
  return out;
}

// "Kapitel 1: Titel." → "Titel"; "Lektion 2. Text" → "Text"; "Frage 3. Text" → "Text".
const afterNumberedLabel = (t: string) => t.replace(/^[^\d\n]{1,40}\d+[.:]\s*/, "");
const noFinalStop = (t: string) => t.replace(/\.\s*$/, "");

/** The chapter with every translated part in place (untranslated parts stay as they are). */
export function translateChapter<C extends Chapter>(ch: C, parts: Part[]): C & { contentLanguageApplied: true } {
  const get = new Map(parts.map((p) => [p.key, p.text]));
  const out: C = { ...ch };
  const t = get.get("title");
  if (t) out.title = noFinalStop(afterNumberedLabel(t));
  // Story text: paragraph i is part "p<i>". A short English sub-heading ending in ":" keeps its colon,
  // so the reader still sets it as a heading.
  const english = String(ch.narrative ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (english.length && english.every((_, i) => get.has(`p${i}`))) {
    out.narrative = english.map((en, i) => {
      const de = get.get(`p${i}`)!.trim();
      return en.length <= 90 && /:$/.test(en) && !/[.!?]\s/.test(en) && !de.endsWith(":") ? `${de}:` : de;
    }).join("\n\n");
  }
  if (Array.isArray(ch.lessons)) out.lessons = ch.lessons.map((l, i) => (get.has(`lesson${i}`) ? afterNumberedLabel(get.get(`lesson${i}`)!) : l));
  if (Array.isArray(ch.reflections)) out.reflections = ch.reflections.map((r, i) => (get.has(`reflection:r${i}`) ? afterNumberedLabel(get.get(`reflection:r${i}`)!) : r));
  if (ch.learning) {
    const l = { ...ch.learning };
    if (l.reflectionQuestions) l.reflectionQuestions = l.reflectionQuestions.map((q) => (get.has(`reflection:${q.id}`) ? { ...q, question: afterNumberedLabel(get.get(`reflection:${q.id}`)!) } : q));
    if (l.check) {
      const label = get.get("check:label");
      l.check = {
        ...l.check, ...(label ? { title: noFinalStop(label) } : {}),
        questions: l.check.questions.map((q) => (get.has(`check:${q.id}`) ? { ...q, question: afterNumberedLabel(get.get(`check:${q.id}`)!) } : q)),
      };
    }
    out.learning = l;
  }
  return { ...out, contentLanguageApplied: true };
}

/** The story's own approved translation in `lang` (content_type kingdom_story): title, subtitle, introduction body. */
export async function approvedStoryTranslation(storyId: string, lang: string): Promise<{ title: string | null; subtitle: string | null; body: string | null } | null> {
  if (!LANG_RE.test(lang) || lang === "en") return null;
  const { data } = await db.from("p2p_content_translations").select("title,subtitle,body")
    .eq("content_type", "kingdom_story").eq("language_code", lang).eq("status", "approved").eq("content_id", storyId).maybeSingle();
  return (data as { title: string | null; subtitle: string | null; body: string | null } | null) ?? null;
}

/** The story's title in this language (from a translated chapter's "story" part), if any. */
export function translatedStoryTitle(byChapter: Map<string, Part[]>): string | null {
  for (const parts of byChapter.values()) {
    const s = parts.find((p) => p.key === "story")?.text;
    if (s) return noFinalStop(s.trim());
  }
  return null;
}
