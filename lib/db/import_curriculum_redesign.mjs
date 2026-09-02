import fs from "fs";
import { CURRICULUM, MODULES } from "./gospel_curriculum_data.mjs";

const envText = fs.readFileSync("../../artifacts/api-server/.env", "utf8");
function envVar(n) { return envText.match(new RegExp(`^${n}=(.*)$`, "m"))[1].trim(); }
const SUPABASE_URL = envVar("SUPABASE_URL");
const SERVICE_ROLE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const EXISTING_CURRICULUM_ID = "30ff038a-0bde-4a2b-a16e-de986159fdab"; // Foundations of Christianity
const ORIENTATION_MODULE_ID = "5795decd-2e97-4fc6-a221-8c44325197ce"; // Module 0
const IDENTITY_MODULE_ID = "d4c4ee76-7fb2-49ff-982b-35b56acbca8a"; // Module 1

async function findCurriculumByTitle(title) {
  const rows = await rest("GET", `p2p_curriculums?title=eq.${encodeURIComponent(title)}&select=id`);
  return rows[0]?.id ?? null;
}

async function ensureStandaloneCurriculum(title, description, displayOrder) {
  const existing = await findCurriculumByTitle(title);
  if (existing) {
    console.log(`Curriculum "${title}" already exists (${existing}) - reusing.`);
    return existing;
  }
  const [row] = await rest("POST", "p2p_curriculums", {
    title, description, type: "core", status: "published",
    display_order: displayOrder, is_visible: true, color_theme: "#1D9E75",
  });
  console.log(`Created curriculum "${title}" (${row.id}).`);
  return row.id;
}

async function reclassifyModule(moduleId, newCurriculumId, label) {
  const [row] = await rest("PATCH", `p2p_modules?id=eq.${moduleId}`, { curriculum_id: newCurriculumId });
  console.log(`Reclassified module "${label}" (${moduleId}) -> curriculum ${newCurriculumId}. New curriculum_id=${row?.curriculum_id}`);
}

async function importGospelCurriculum() {
  const existingId = await findCurriculumByTitle(CURRICULUM.title);
  if (existingId) {
    console.log(`Curriculum "${CURRICULUM.title}" already exists (${existingId}) - skipping full import (idempotent guard).`);
    return existingId;
  }

  const [currRow] = await rest("POST", "p2p_curriculums", {
    title: CURRICULUM.title, description: CURRICULUM.description,
    type: "core", status: "published", display_order: 2, is_visible: true, color_theme: "#C0392B",
  });
  const curriculumId = currRow.id;
  console.log(`Created curriculum "${CURRICULUM.title}" (${curriculumId}).`);

  for (let mIdx = 0; mIdx < MODULES.length; mIdx++) {
    const mod = MODULES[mIdx];
    const [modRow] = await rest("POST", "p2p_modules", {
      curriculum_id: curriculumId, title: mod.title, description: mod.description,
      order_index: mIdx + 1, status: "published", color_theme: "#C0392B",
    });
    const moduleId = modRow.id;
    console.log(`  Module ${mIdx + 1}: "${mod.title}" (${moduleId})`);

    for (let lIdx = 0; lIdx < mod.lessons.length; lIdx++) {
      const lesson = mod.lessons[lIdx];
      const [lessonRow] = await rest("POST", "p2p_lessons", {
        module_id: moduleId, title: lesson.title, order_index: lIdx + 1,
        status: "published", estimated_minutes: lesson.estimatedMinutes,
      });
      const lessonId = lessonRow.id;
      console.log(`    Lesson ${mIdx + 1}.${lIdx + 1}: "${lesson.title}" (${lessonId})`);

      // Scripture (memory verse)
      await rest("POST", "p2p_scriptures", {
        lesson_id: lessonId, reference: lesson.memoryVerseRef, verse: lesson.memoryVerseText, display_order: 0,
      });

      // Teaching sections, in order, followed by prayer and assignment sections
      let sectionOrder = 0;
      for (const s of lesson.sections) {
        await rest("POST", "p2p_lesson_sections", {
          lesson_id: lessonId, section_order: sectionOrder++, section_type: "teaching", title: s.title, content: s.content,
        });
      }
      await rest("POST", "p2p_lesson_sections", {
        lesson_id: lessonId, section_order: sectionOrder++, section_type: "prayer", title: "Prayer", content: lesson.prayer,
      });
      await rest("POST", "p2p_lesson_sections", {
        lesson_id: lessonId, section_order: sectionOrder++, section_type: "assignment", title: "Assignment", content: lesson.assignment,
      });

      // Reflection questions
      for (let qIdx = 0; qIdx < lesson.reflectionQuestions.length; qIdx++) {
        await rest("POST", "p2p_reflection_questions", {
          lesson_id: lessonId, question: lesson.reflectionQuestions[qIdx], display_order: qIdx,
        });
      }
    }
  }
  return curriculumId;
}

async function main() {
  console.log("=== Step 1: Reclassify Peer-to-Peer Orientation ===");
  const orientationCurriculumId = await ensureStandaloneCurriculum(
    "Peer-to-Peer Orientation",
    "Learn how P2P Global works, how Peer Guides and discipleship relationships function, how Study Together works, and how to begin your journey on the platform.",
    0
  );
  await reclassifyModule(ORIENTATION_MODULE_ID, orientationCurriculumId, "Module 0: Peer-to-Peer Orientation");

  console.log("\n=== Step 2: Reclassify Identity in Christ ===");
  const identityCurriculumId = await ensureStandaloneCurriculum(
    "Identity in Christ",
    "Discover who you are because of your relationship with Christ — regeneration, justification, adoption, grace, faith, and the new creation you now are.",
    1
  );
  await reclassifyModule(IDENTITY_MODULE_ID, identityCurriculumId, "Module 1: Your New Identity in Christ");

  console.log("\n=== Step 3: Import The Gospel & Salvation from the PDF ===");
  const gospelCurriculumId = await importGospelCurriculum();

  console.log("\n=== Step 4: Confirm Foundations of Christianity's remaining modules are untouched ===");
  const remaining = await rest("GET", `p2p_modules?curriculum_id=eq.${EXISTING_CURRICULUM_ID}&select=id,title,order_index&order=order_index`);
  console.log(`Foundations of Christianity now has ${remaining.length} modules remaining:`, remaining.map(m => m.title));

  console.log("\nDone.");
  console.log("orientationCurriculumId:", orientationCurriculumId);
  console.log("identityCurriculumId:", identityCurriculumId);
  console.log("gospelCurriculumId:", gospelCurriculumId);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
