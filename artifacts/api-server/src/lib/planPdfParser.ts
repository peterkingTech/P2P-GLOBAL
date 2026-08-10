import pdfParse from "pdf-parse";

// Parses a P2P Plan PDF into a structured plan object, ready for admin
// preview/confirm-import.
//
// The PDFs are NOT perfectly uniform — this parser was built and iteratively
// hardened against all 144 real plan PDFs in the P2P Plans collection (see
// the one-off bulk-import script that inserted them directly). Two label
// styles exist in the wild:
//   Style A: "Topic:", "Bible Quote:", "Personal Reflection:", "Lesson
//             N.M:" (colon), "Module N:" (mixed case)
//   Style B (mostly Identity & Salvation Plans): no "Topic:" line (title is
//             just a bare line in the front matter, sometimes with the
//             whole front-matter block duplicated), no "Bible Quote:" label
//             (the quote is a bare quoted paragraph right after the lesson
//             heading), "Personal Reflection" / "Lesson N.M Assignment"
//             with no trailing colon, "Lesson N.M —" (dash) instead of ":",
//             "MODULE N:" (all caps).
// A handful of real plans are also not exactly 4 modules / 12 lessons (a
// genuine gap in the source content, not a parsing bug) — this parser
// reports whatever structure genuinely exists rather than fabricating
// missing lessons.

export interface ParsedLesson {
  title: string;
  orderIndex: number;
  memoryVerse: string;
  content: string;
  discussionQuestions: string;
  lifeAssignment: string;
  checkpoint: string;
}

export interface ParsedModule {
  title: string;
  orderIndex: number;
  lessons: ParsedLesson[];
}

export interface ParsedPlan {
  title: string;
  description: string;
  subtitle: string;
  category: string;
  lectureIntro: string;
  modules: ParsedModule[];
}

const CATEGORY_MAP: Record<string, string> = {
  faith: "faith_kingdom",
  ministry: "ministry_leadership",
  "spiritual growth": "spiritual_growth",
  family: "family_relationships",
  identity: "identity_salvation",
  market: "marketplace_purpose",
  prayer: "prayer",
  "holy spirit": "holy_spirit",
  healing: "healing_freedom",
  church: "church_community",
};

const MODULE_HEADING_RE = /^[ \t]*module\s*(\d+)\s*[:\-–—]\s*(.+?)\s*$/gim;
const LESSON_HEADING_RE = /^[ \t]*lesson\s*(\d+)\.(\d+)\s*[:\-–—]\s*(.+?)\s*$/gim;
const STOP_ALT =
  "(?:Plan Description:|Root Scripture:|Lecture\\b|\\d+\\s*Modules?\\s*\\|\\s*\\d+\\s*Lessons?|MODULE\\s*1\\s*[:\\-]|Module\\s*1\\s*[:\\-])";

function clean(s: string | undefined | null): string {
  if (!s) return "";
  let out = s.replace(/�/g, "-");
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/ *\n */g, "\n");
  return out.trim();
}

function flatten(s: string | undefined | null): string {
  return clean(s).replace(/\s+/g, " ").trim();
}

function extractNumberedItems(block: string): string[] {
  const items: string[] = [];
  const re = /^\s*(\d+)\.\s+([\s\S]*?)(?=\n\s*\d+\.\s|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (text) items.push(text);
  }
  if (items.length > 0) return items;

  // Fallback: some source PDFs list these as plain unnumbered lines instead
  // of "1. 2. 3." — split on line breaks and keep lines that look like real
  // sentences, not a stray label fragment.
  for (const rawLine of block.split(/\n{1,2}/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length >= 15 && !/^(lesson|module|personal reflection)\b/i.test(line)) {
      items.push(line);
    }
  }
  return items;
}

function detectCategory(filename: string, text: string): string {
  const haystack = `${filename} ${text.slice(0, 200)}`.toLowerCase();
  for (const [key, slug] of Object.entries(CATEGORY_MAP)) {
    if (haystack.includes(key)) return slug;
  }
  return "";
}

export async function parsePlanPdf(pdfBuffer: Buffer, filename = ""): Promise<ParsedPlan> {
  const parsed = await pdfParse(pdfBuffer);
  const text = (parsed.text ?? "").replace(/�/g, "-");
  if (!text.trim()) {
    throw new Error("Could not extract any text from this PDF — it may be scanned/image-based rather than text-based.");
  }

  const category = detectCategory(filename, text);

  const firstModuleMatch = new RegExp(MODULE_HEADING_RE.source, "im").exec(text);

  // ── Plan Description — first occurrence (some files duplicate the whole
  // front-matter block; only the first is real) ──
  const pdRe = new RegExp(`Plan Description:\\s*([\\s\\S]*?)(?=${STOP_ALT}|$)`, "i");
  const pdMatches: RegExpExecArray[] = [];
  {
    const globalPdRe = new RegExp(`Plan Description:\\s*[\\s\\S]*?(?=${STOP_ALT}|$)`, "gi");
    let m: RegExpExecArray | null;
    while ((m = globalPdRe.exec(text)) !== null) pdMatches.push(m);
  }
  const pdMatch = pdRe.exec(text);
  const description = pdMatch ? clean(pdMatch[1]) : "";

  // ── Root Scripture — bounded by the quote+citation SHAPE itself
  // ("..." — Book Ref), not lazily up to the next label — a lazy
  // label-to-label match would swallow an unlabeled title line sitting
  // between two duplicated front-matter blocks. ──
  const rsRe = /Root Scripture:\s*"([\s\S]*?)"\s*[-–—]*\s*([^\n]*(?:\n\s*\d+:\d+[^\n]*)?)/i;
  const rsMatches: RegExpExecArray[] = [];
  {
    const globalRsRe = /Root Scripture:\s*"([\s\S]*?)"\s*[-–—]*\s*([^\n]*(?:\n\s*\d+:\d+[^\n]*)?)/gi;
    let m: RegExpExecArray | null;
    while ((m = globalRsRe.exec(text)) !== null) rsMatches.push(m);
  }
  const rsMatch = rsRe.exec(text);
  const subtitle = rsMatch ? flatten(`"${rsMatch[1]}" — ${rsMatch[2]}`) : "";

  // ── Lecture intro (optional) ──
  let lectureIntro = "";
  const lecRe = /^[ \t]*lecture[ \t]*$/im;
  const lecMatch = lecRe.exec(text);
  if (lecMatch && firstModuleMatch && lecMatch.index < firstModuleMatch.index) {
    let chunk = text.slice(lecMatch.index + lecMatch[0].length, firstModuleMatch.index);
    chunk = chunk.replace(/\d+\s*Modules?\s*\|\s*\d+\s*Lessons?/g, "");
    lectureIntro = clean(chunk);
  }

  // ── Title ──
  let title = "";
  const topicRe = /Topic:[ \t]*(.+?)[ \t]*\n/i;
  const topicMatch = topicRe.exec(text);
  if (topicMatch && flatten(topicMatch[1])) {
    title = flatten(topicMatch[1]);
  } else {
    const searchEnd = firstModuleMatch ? firstModuleMatch.index : text.length;
    const excluded: Array<[number, number]> = [
      ...pdMatches.map((m): [number, number] => [m.index, m.index + m[0].length]),
      ...rsMatches.map((m): [number, number] => [m.index, m.index + m[0].length]),
    ];
    if (lecMatch) {
      excluded.push([lecMatch.index, firstModuleMatch ? firstModuleMatch.index : text.length]);
    }
    const isExcluded = (pos: number) => excluded.some(([s, e]) => s <= pos && pos < e);

    const lineRe = /[^\n]+/g;
    let lm: RegExpExecArray | null;
    const head = text.slice(0, searchEnd);
    while ((lm = lineRe.exec(head)) !== null) {
      const line = lm[0].trim();
      if (!line || isExcluded(lm.index)) continue;
      if (/^(lecture\b|\d+\s*modules?\s*\|)/i.test(line)) continue;
      if (/plans?\s*[-–—]\s*topic\s*\d+\s*$/i.test(line)) continue;
      title = flatten(line);
      break;
    }
    if (!title) {
      // Nothing usable anywhere in the body — fall back to the filename,
      // stripped of the common category/prefix boilerplate.
      const base = filename.replace(/\.pdf$/i, "");
      const stripped = base.replace(/^(?:P2P\s*(?:Plans?|-)?\s*)?.*?[-–—]\s*/, "");
      title = flatten(stripped) || "Untitled Plan";
    }
  }

  // ── Modules + Lessons (lesson headings are the most reliable anchor —
  // module headings can false-positive-match inside body prose that
  // happens to start a wrapped line with "Module N") ──
  const lessonMatches: RegExpExecArray[] = [];
  {
    const globalLessonRe = new RegExp(LESSON_HEADING_RE.source, "gim");
    let m: RegExpExecArray | null;
    while ((m = globalLessonRe.exec(text)) !== null) lessonMatches.push(m);
  }
  if (lessonMatches.length === 0) {
    throw new Error("Could not find any 'Lesson N.M' headings in this PDF — it doesn't look like a P2P Plan format.");
  }

  const moduleNumbers: number[] = [];
  for (const lm of lessonMatches) {
    const n = parseInt(lm[1], 10);
    if (!moduleNumbers.includes(n)) moduleNumbers.push(n);
  }

  const allModuleMatches: RegExpExecArray[] = [];
  {
    const globalModRe = new RegExp(MODULE_HEADING_RE.source, "gim");
    let m: RegExpExecArray | null;
    while ((m = globalModRe.exec(text)) !== null) allModuleMatches.push(m);
  }

  const modules: ParsedModule[] = moduleNumbers.map((modNum, modIdx) => {
    const modLessons = lessonMatches.filter((lm) => parseInt(lm[1], 10) === modNum);
    const firstLessonStart = modLessons[0].index;
    const candidates = allModuleMatches.filter(
      (mm) => parseInt(mm[1], 10) === modNum && mm.index < firstLessonStart
    );
    const modTitle = candidates.length ? flatten(candidates[candidates.length - 1][2]) : "";
    if (!modTitle) {
      throw new Error(`Could not find Module ${modNum} title in PDF`);
    }

    const lessons: ParsedLesson[] = modLessons.map((lm, j) => {
      const lTitle = flatten(lm[3]);
      if (!lTitle) {
        throw new Error(`Could not find Lesson ${modNum}.${lm[2]} title in PDF`);
      }
      const lstart = lm.index + lm[0].length;
      const globalIdx = lessonMatches.indexOf(lm);
      const lend =
        j + 1 < modLessons.length
          ? modLessons[j + 1].index
          : globalIdx + 1 < lessonMatches.length
          ? lessonMatches[globalIdx + 1].index
          : text.length;
      const ltext = text.slice(lstart, lend);

      // Bible quote — labeled style, else bare quoted paragraph near the
      // top of the lesson block (bounded to a leading window so we don't
      // accidentally match an unrelated quoted phrase deep in the body).
      let memoryVerse = "";
      let afterQuote = ltext;
      const bq = /Bible Quote:\s*"([\s\S]*?)"\s*[-–—]*\s*([^\n]*(?:\n\s*\d+:\d+[^\n]*)?)/i.exec(ltext);
      if (bq) {
        memoryVerse = flatten(`"${bq[1]}" — ${flatten(bq[2])}`);
        afterQuote = ltext.slice(bq.index + bq[0].length);
      } else {
        const window = ltext.slice(0, 400);
        const bareQ = /"([\s\S]*?)"\s*[-–—]*\s*([^\n]*(?:\n\s*\d+:\d+[^\n]*)?)/.exec(window);
        if (bareQ) {
          memoryVerse = flatten(`"${bareQ[1]}" — ${flatten(bareQ[2])}`);
          afterQuote = ltext.slice(bareQ.index + bareQ[0].length);
        }
      }

      const prRe = new RegExp("Personal Reflection:?\\s*([\\s\\S]*?)(?=Lesson\\s*\\d+\\.\\d+\\s*Assignment:?|$)", "i");
      const prMatch = prRe.exec(afterQuote);
      const reflections = prMatch ? extractNumberedItems(prMatch[1]) : [];

      const asnRe = /Lesson\s*\d+\.\d+\s*Assignment:?\s*([\s\S]*)/i;
      const asnMatch = asnRe.exec(afterQuote);
      const assignmentBlock = asnMatch ? asnMatch[1] : "";
      // A "Checkpoint:" line, if present, sits inside (or after) the
      // assignment block in the source PDFs — split it out so it doesn't
      // get swept into the assignment items.
      const checkpointRe = /Checkpoint:\s*([\s\S]*)/i;
      const checkpointMatch = checkpointRe.exec(assignmentBlock);
      const checkpoint = checkpointMatch ? flatten(checkpointMatch[1]) : "";
      const assignmentOnly = checkpointMatch ? assignmentBlock.slice(0, checkpointMatch.index) : assignmentBlock;
      const assignmentItems = extractNumberedItems(assignmentOnly);

      const body = prMatch ? afterQuote.slice(0, prMatch.index) : afterQuote;

      return {
        title: lTitle,
        orderIndex: j + 1,
        memoryVerse,
        content: clean(body),
        discussionQuestions: reflections.join("\n"),
        lifeAssignment: assignmentItems.join("\n"),
        checkpoint,
      };
    });

    return { title: modTitle, orderIndex: modIdx + 1, lessons };
  });

  return { title, description, subtitle, category, lectureIntro, modules };
}