// One-time bulk migration: convert existing normalized lesson content
// (p2p_lesson_sections, p2p_scriptures, p2p_reflection_questions,
// p2p_assignments + p2p_assignment_questions) into p2p_lesson_blocks rows
// for the new Notion-style block editor.
//
// Idempotent: any lesson that already has rows in p2p_lesson_blocks is
// skipped entirely, so re-running this script after a partial run (or
// after new lessons are added the old way) is safe. Originals are never
// deleted — this only adds rows to the new table.
//
// Usage:
//   pnpm exec tsx src/scripts/migrateCurriculumToBlocks.ts --dry-run   (report only, no writes)
//   pnpm exec tsx src/scripts/migrateCurriculumToBlocks.ts --limit=5   (first N un-migrated lessons only)
//   pnpm exec tsx src/scripts/migrateCurriculumToBlocks.ts             (all un-migrated lessons)

// Node 20 has no native WebSocket; supabase-js's realtime client requires
// one to exist at construction time even though this script never uses
// realtime. Resolve "ws" from the monorepo root since it isn't hoisted
// into artifacts/api-server's own node_modules.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire(import.meta.url);
const pnpmDir = path.resolve(import.meta.dirname, "../../../../node_modules/.pnpm");
const wsDirName = fs.readdirSync(pnpmDir).find((d) => d.startsWith("ws@"));
if (!wsDirName) throw new Error(`Could not find a "ws" package under ${pnpmDir} (needed as a WebSocket polyfill for supabase-js under Node 20).`);
const wsPath = require.resolve("ws", { paths: [path.join(pnpmDir, wsDirName, "node_modules/ws")] });
(globalThis as any).WebSocket = (globalThis as any).WebSocket ?? require(wsPath);

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required to run this script.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : undefined;

type LessonRow = { id: string; title: string };
type SectionRow = { id: string; lesson_id: string; section_order: number; section_type: string; title: string | null; content: string };
type ScriptureRow = { id: string; lesson_id: string; reference: string; verse: string; display_order: number };
type QuestionRow = { id: string; lesson_id: string; question: string; display_order: number };
type AssignmentRow = { id: string; lesson_id: string; title: string; instructions: string; due_after_days: number | null };
type AssignmentQuestionRow = { id: string; assignment_id: string; question: string; display_order: number };

// section_type -> block_type. "teaching" (the vast majority) is the main
// body text; the rarer types map to blocks that carry the same intent.
const SECTION_TYPE_TO_BLOCK: Record<string, string> = {
  teaching: "paragraph",
  application: "key_point",
  definition: "glossary_term",
  note: "callout",
  illustration: "quote",
};

type NewBlock = {
  lesson_id: string;
  block_type: string;
  content: Record<string, unknown>;
  order_index: number;
  is_required: boolean;
  is_submittable: boolean;
};

function sectionToBlock(s: SectionRow, order: number): NewBlock {
  const blockType = SECTION_TYPE_TO_BLOCK[s.section_type] ?? "paragraph";
  let content: Record<string, unknown>;
  switch (blockType) {
    case "glossary_term":
      content = { term: s.title ?? "Definition", definition: s.content };
      break;
    case "quote":
      content = { text: s.content, attribution: s.title ?? "" };
      break;
    default:
      content = { text: s.content };
  }
  return { lesson_id: s.lesson_id, block_type: blockType, content, order_index: order, is_required: false, is_submittable: false };
}

// Every lesson has at most one scripture row (confirmed live). It doubles
// as the lesson's memory verse, satisfying the publish-requirement trigger
// added in migration 039.
function scriptureToBlock(sc: ScriptureRow, order: number): NewBlock {
  return {
    lesson_id: sc.lesson_id,
    block_type: "memory_verse",
    content: { reference: sc.reference, text: sc.verse, translation: "" },
    order_index: order,
    is_required: true,
    is_submittable: false,
  };
}

function questionToBlock(q: QuestionRow, order: number): NewBlock {
  return {
    lesson_id: q.lesson_id,
    block_type: "reflection_question",
    content: { question: q.question },
    order_index: order,
    is_required: true,
    is_submittable: true,
  };
}

function assignmentToBlock(a: AssignmentRow, questions: AssignmentQuestionRow[], order: number): NewBlock {
  return {
    lesson_id: a.lesson_id,
    block_type: "assignment",
    content: {
      title: a.title,
      instructions: a.instructions,
      due_after_days: a.due_after_days,
      questions: questions
        .sort((x, y) => x.display_order - y.display_order)
        .map((q) => ({ question: q.question })),
    },
    order_index: order,
    is_required: true,
    is_submittable: true,
  };
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes will be made.\n" : "LIVE RUN — writing p2p_lesson_blocks rows.\n");

  const { data: alreadyMigratedRows, error: migratedErr } = await supabase
    .from("p2p_lesson_blocks")
    .select("lesson_id");
  if (migratedErr) throw migratedErr;
  const alreadyMigrated = new Set((alreadyMigratedRows ?? []).map((r) => r.lesson_id as string));

  let lessonQuery = supabase.from("p2p_lessons").select("id, title").order("id");
  const { data: allLessons, error: lessonsErr } = await lessonQuery;
  if (lessonsErr) throw lessonsErr;

  const pending = (allLessons ?? []).filter((l) => !alreadyMigrated.has(l.id)) as LessonRow[];
  const targets = LIMIT ? pending.slice(0, LIMIT) : pending;

  console.log(`Total lessons: ${allLessons?.length ?? 0}`);
  console.log(`Already migrated (skipped): ${alreadyMigrated.size}`);
  console.log(`To migrate this run: ${targets.length}\n`);

  let migratedLessons = 0;
  let totalBlocks = 0;

  for (const lesson of targets) {
    const [{ data: sections, error: sErr }, { data: scriptures, error: scErr }, { data: questions, error: qErr }, { data: assignments, error: aErr }] =
      await Promise.all([
        supabase.from("p2p_lesson_sections").select("*").eq("lesson_id", lesson.id).order("section_order"),
        supabase.from("p2p_scriptures").select("*").eq("lesson_id", lesson.id).order("display_order"),
        supabase.from("p2p_reflection_questions").select("*").eq("lesson_id", lesson.id).order("display_order"),
        supabase.from("p2p_assignments").select("*").eq("lesson_id", lesson.id),
      ]);
    if (sErr) throw sErr;
    if (scErr) throw scErr;
    if (qErr) throw qErr;
    if (aErr) throw aErr;

    let assignmentQuestionsByAssignment = new Map<string, AssignmentQuestionRow[]>();
    if (assignments && assignments.length > 0) {
      const assignmentIds = assignments.map((a) => a.id);
      const { data: aqRows, error: aqErr } = await supabase
        .from("p2p_assignment_questions")
        .select("*")
        .in("assignment_id", assignmentIds);
      if (aqErr) throw aqErr;
      for (const row of (aqRows ?? []) as AssignmentQuestionRow[]) {
        const list = assignmentQuestionsByAssignment.get(row.assignment_id) ?? [];
        list.push(row);
        assignmentQuestionsByAssignment.set(row.assignment_id, list);
      }
    }

    const blocks: NewBlock[] = [];
    let order = 0;

    for (const sc of (scriptures ?? []) as ScriptureRow[]) {
      blocks.push(scriptureToBlock(sc, order++));
    }
    for (const s of (sections ?? []) as SectionRow[]) {
      blocks.push(sectionToBlock(s, order++));
    }
    for (const q of (questions ?? []) as QuestionRow[]) {
      blocks.push(questionToBlock(q, order++));
    }
    for (const a of (assignments ?? []) as AssignmentRow[]) {
      blocks.push(assignmentToBlock(a, assignmentQuestionsByAssignment.get(a.id) ?? [], order++));
    }

    if (blocks.length === 0) {
      console.log(`  [skip, no content] "${lesson.title}" (${lesson.id})`);
      continue;
    }

    console.log(`  "${lesson.title}" (${lesson.id}) -> ${blocks.length} block(s)`);

    if (!DRY_RUN) {
      const { error: insertErr } = await supabase.from("p2p_lesson_blocks").insert(blocks);
      if (insertErr) throw insertErr;
    }

    migratedLessons += 1;
    totalBlocks += blocks.length;
  }

  console.log(`\nMigrated ${migratedLessons} lessons, created ${totalBlocks} blocks total.`);
  if (DRY_RUN) console.log("(dry run — nothing was written)");
}

main().catch((e) => {
  console.error("MIGRATION SCRIPT FAILED:", e.message ?? e);
  process.exit(1);
});
