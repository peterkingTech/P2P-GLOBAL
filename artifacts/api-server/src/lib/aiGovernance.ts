// P2P AI GOVERNANCE — ONE framework for every AI feature in P2P Global (owner brief 2026-11-19, §11–§19).
// Every call to an AI provider goes through this module: `governedSystemPrompt` (the shared principles and
// boundaries, plus the task's own instructions), `assertTaskAllowed` (only approved organisational tasks; never
// conversations), `scriptureForAI` (a Bible translation's licence decides whether its TEXT may be sent — otherwise
// only references are sent) and `reviewOutput` (what comes back is checked before anyone sees it).
//
// Human accountability: these rules are maintained by authorised P2P administrators and qualified Christian
// reviewers through reviewed code changes (docs/ai-governance.md). Nothing here can be changed by an AI, by a
// participant or at runtime; there is no endpoint that edits it. Version below changes with every reviewed edit.
import type { TranslationRow } from "./bibleLicence";
import { providerOf } from "./bibleLicence";

export const GOVERNANCE_VERSION = "2026-11-19.1";

// ── A. Biblical principles ────────────────────────────────────────────────────────────────────────────────────
export const PRINCIPLES = ["Truthfulness", "Humility", "Love", "Wisdom", "Faithfulness to Scripture", "Justice", "Integrity", "Peace", "Servanthood", "Accountability"] as const;

// ── B. Behavioural boundaries (the shared instructions every AI task receives first) ──────────────────────────
const FRAMEWORK = `You are a supporting tool inside P2P Global, a peer-to-peer Christian discipleship application.
You serve within these principles: ${PRINCIPLES.join(", ")}.

Scripture is the primary authority for biblical teaching. Your reasoning is never an authority over Scripture.
You are a supporting technology — not a spiritual authority, teacher, pastor, shepherd, peer guide or evaluator.

You must NEVER:
- claim to be God, Jesus Christ or the Holy Spirit, or speak as if God is speaking through you;
- claim that God told you anything, claim revelation, discernment or a personal relationship with God;
- deliver prophecy, or present any prayer or message as given directly by God; never write "God told me to tell you" or similar;
- invent Scripture, quotations, citations, resources, lesson titles, authors, dates or original-language meanings;
- present your own conclusions as established biblical fact without evidence, or claim exhaustive knowledge;
- make medical, financial, legal or other personal decisions for anyone, or tell anyone to stop medication or treatment;
- pretend to know God's specific will for an individual's personal circumstances;
- use Scripture to justify hatred, harassment, abuse or discrimination against people.

When biblical teaching is asked about: read passages in their literary and historical context, distinguish what the
text says from interpretation and from historical fact, name legitimate differences between Christian traditions,
handle Hebrew, Greek and Aramaic accurately, acknowledge uncertainty, and give references.
On sexuality and related questions: explain the relevant biblical teaching faithfully and clearly, with references and
context, respectfully — distinguish teaching about conduct from judgement of persons; never insult or dehumanise anyone.
On health and personal decisions: point to relevant Scripture, biblical principles, P2P resources and appropriate
professional or human support. Encourage people to seek qualified help and their own church community.
Only use the material you are given. If something is missing, say what is missing — never fill the gap by inventing.`;

/** The system prompt for one AI task: the shared framework first, then the task's own instructions. */
export function governedSystemPrompt(task: AiTask, instructions: string): string {
  assertTaskAllowed(task);
  return `${FRAMEWORK}\n\nGovernance version ${GOVERNANCE_VERSION}. Task: ${TASKS[task].purpose}\n\n${instructions}`;
}

// ── Approved AI tasks (organisational only). Conversations are never an AI task (§12). ────────────────────────
export const TASKS = {
  plan_organiser: { purpose: "organise discovered P2P resources into a learning journey (search, discovery, learning plans, deeper learning)", touchesScripture: "references_only" },
  content_translation: { purpose: "translate P2P-authored learning content between app languages, faithfully and without adding meaning", touchesScripture: "licence_checked" },
  // A PUBLIC Kingdom Win post (never a conversation) translated into English only so moderators can check it
  // against community rules; the translation is for moderation, not shown as a summary or reply.
  wins_moderation_translation: { purpose: "translate a public Kingdom Win post into English so it can be checked against community rules (moderation only)", touchesScripture: "none" },
} as const;
export type AiTask = keyof typeof TASKS;
/** Areas where AI is never used: no summaries, rewrites, interpretations or replies of people's conversations. */
export const NEVER_AI = ["private_chats", "group_chats", "family_conversations", "church_conversations", "community_conversations", "study_together_conversations", "p2p_mail"] as const;
export class AiGovernanceError extends Error { constructor(message: string, public code: string) { super(message); } }
export function assertTaskAllowed(task: string): asserts task is AiTask {
  if (!(task in TASKS)) throw new AiGovernanceError("This AI task isn't approved in P2P's AI governance framework.", "task_not_approved");
}

// ── C. Source and licensing restrictions (§17) ────────────────────────────────────────────────────────────────
// Permission to DISPLAY a translation never implies permission to send its text to an AI provider. Only text whose
// licence leaves it unrestricted (public domain) may be sent; everything else is referred to by reference only.
// A translation can be opened to AI processing only by recording that permission explicitly (permits_ai = true on
// its licence record, after a person has reviewed the agreement) — never assumed.
export type AiActivity = "ai_processing" | "ai_summarisation" | "ai_analysis" | "send_to_provider" | "model_training";
export function aiAllowedFor(r: TranslationRow & { permits_ai?: boolean | null }, activity: AiActivity): boolean {
  if (activity === "model_training") return false; // never: P2P does not train models on any text
  if (r.preview) return false;
  if (providerOf(r) === "youversion") return false; // display-only (owner's copyright rule; terms silent on AI)
  if (r.permits_ai === true) return true;
  if (providerOf(r) === "helloao") return r.licence_status === "approved" && /^public domain$/i.test(String(r.licence_name ?? "").trim());
  return /^\s*public domain\b/i.test(r.license_notes ?? "");
}
/** What of a passage may go to an AI provider: its text (licence allows) or only its reference. */
export function scriptureForAI(reference: string, text: string | null, row: (TranslationRow & { permits_ai?: boolean | null }) | null): { reference: string; text: string | null; translation: string | null } {
  if (text && row && aiAllowedFor(row, "send_to_provider")) return { reference, text, translation: row.translation_code };
  return { reference, text: null, translation: null };
}

// ── D. Privacy (§19): what may never be sent ──────────────────────────────────────────────────────────────────
/** Keys that must never appear in anything sent to an AI provider (private notes, reflections, messages…). */
const PRIVATE_KEYS = /\b(note|notes|reflection|reflections|journal|message|messages|prayer_request|email|phone|address|date_of_birth)\b/i;
export function assertNoPrivateData(payload: unknown): void {
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (PRIVATE_KEYS.test(k)) throw new AiGovernanceError(`Private data (${path}${k}) can't be sent to an AI provider.`, "private_data");
      walk(x, `${path}${k}.`);
    }
  };
  walk(payload, "");
}

// ── E/F. Output review (§15, §14, §13) — every AI output is checked before use; a violation discards it. ──────
const FORBIDDEN: { code: string; re: RegExp }[] = [
  { code: "divine_identity", re: /\b(i am|i'm)\s+(god|jesus|jesus christ|christ|the holy spirit|the lord|the messiah)\b/i },
  { code: "divine_message", re: /\bgod (told|showed|revealed to|spoke to|has told) (me|us)\b|\bthe lord (told|showed|revealed to|spoke to) (me|us)\b|\bgod (wants|told) me to tell you\b/i },
  { code: "speaking_for_god", re: /\b(thus says the lord|this is (a|the) (word|message) from (god|the lord)|god is speaking through (me|this)|a prophecy for you|i prophesy|prophetic word for you)\b/i },
  { code: "revelation_claim", re: /\b(i (have )?receive[sd]? (a )?(revelation|vision|word from god)|the spirit (told|showed) me|i (sense|discern) in my spirit)\b/i },
  { code: "god_given_prayer", re: /\b(this prayer (was|is) given (to me )?by god|god gave (me )?this prayer)\b/i },
  { code: "medical_directive", re: /\b(stop|discontinue|quit|don'?t take|do not take|throw away|refuse|give up)( taking| using| your| the| all)* (medication|medicine|meds|pills|treatment|insulin|antidepressants?|chemotherapy|dialysis)\b/i },
  { code: "personal_divine_will", re: /\bgod('s will)? (is telling you|wants you) to (marry|divorce|quit|resign|leave|move|buy|sell|invest)\b/i },
  { code: "dehumanising", re: /\b(subhuman|abomination(s)? (people|persons)|deserve to (die|suffer)|should be (killed|beaten|harassed))\b/i },
];
export interface OutputReview { ok: boolean; violations: string[] }
export function reviewOutput(text: string): OutputReview {
  const violations = FORBIDDEN.filter((f) => f.re.test(text)).map((f) => f.code);
  return { ok: violations.length === 0, violations };
}

/** Plain-language summary for administrators and the documentation (never shown as content). */
export function governanceSummary() {
  return { version: GOVERNANCE_VERSION, principles: [...PRINCIPLES], tasks: Object.entries(TASKS).map(([task, t]) => ({ task, ...t })), neverAi: [...NEVER_AI],
    scripture: "Text is sent to an AI provider only when its licence leaves it unrestricted (public domain) or permits AI processing explicitly; otherwise references only. Never model training.",
    review: FORBIDDEN.map((f) => f.code) };
}
