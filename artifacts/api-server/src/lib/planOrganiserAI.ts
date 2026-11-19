// The AI step of the Learning Plan organiser — ORGANISATION ONLY, under P2P's AI governance (lib/aiGovernance).
// Given the participant's question and the REAL resources discovery found (keys, kinds, titles, why — references
// only, never Scripture text, never anything private), the model may only: choose which of those items belong in
// which stage, order them, and name gaps. Its answer is validated: unknown keys are dropped (it can't add a resource),
// stage keys must be P2P's own, every text it writes is reviewed (reviewOutput) and a violation discards the whole
// answer — the rules-based journey (lib/planOrganiser) is then used unchanged.
//
// OFF unless PLANS_AI_ORGANISER=on AND ANTHROPIC_API_KEY is set on the server (owner approval required: it spends
// provider credits). Results are cached per question + candidate set for 6 hours (no repeat spending).
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { assertNoPrivateData, governedSystemPrompt, reviewOutput } from "./aiGovernance";
import { STAGES, STAGE_TITLES, type JourneyItem, type JourneyStage, type OrganisedJourney, type StageKey } from "./planOrganiser";
import { logger } from "./logger";

export const aiOrganiserEnabled = () => process.env.PLANS_AI_ORGANISER === "on" && !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.PLANS_AI_MODEL || "claude-opus-4-8";
type Client = { messages: { create: (body: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[] }> } };
let client: Client | null = null;
export const setOrganiserClientForTests = (c: Client | null) => { client = c; };
const getClient = (): Client => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as Client);
const cache = new Map<string, { at: number; value: AiPlan | null }>();

export interface AiPlan { stages: { key: StageKey; itemKeys: string[] }[]; gaps: string[] }
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["stages", "gaps"],
  properties: {
    stages: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "itemKeys"], properties: { key: { type: "string", enum: [...STAGES] }, itemKeys: { type: "array", items: { type: "string" } } } } },
    gaps: { type: "array", items: { type: "string" } },
  },
};
const INSTRUCTIONS = `You organise a learning journey from resources that P2P has ALREADY found. You receive the participant's subject or question and a list of candidate items (key, category, title, why it was found).
Choose the items that genuinely help with THIS subject, place each in one stage, and order them so learning builds logically.
Stages (use only these keys, leave a stage out if nothing fits): ${STAGES.map((k) => `${k} = ${STAGE_TITLES[k]}`).join("; ")}.
Rules: use ONLY the keys you were given, each at most once; never invent a resource, title, passage or source. Do not merge different concepts that merely share a word (for example "Lord" as YHWH, Adonai, Kyrios, Jesus as Lord, human lords) — keep the ones that fit the question, and keep distinct meanings distinct.
"gaps": short plain sentences naming what is MISSING for a complete understanding (e.g. "No lesson yet on the Holy Spirit's work in the early church"), never claims of fact, never advice about personal decisions.
Return only JSON matching the schema.`;

/** Asks the model to organise; null when off, failed, or the answer didn't pass governance and validation. */
export async function aiOrganise(j: OrganisedJourney): Promise<AiPlan | null> {
  if (!aiOrganiserEnabled() && !client) return null;
  const candidates = [...j.stages.flatMap((s) => s.items), ...j.more].filter((i) => i.origin !== "activity");
  if (candidates.length < 3) return null;
  const payload = { question: j.question, depth: j.depth, items: candidates.slice(0, 80).map((i) => ({ key: i.key, category: i.category, title: i.title, why: i.why })) };
  assertNoPrivateData(payload);
  const ck = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value;
  let value: AiPlan | null = null;
  try {
    const res = await getClient().messages.create({
      model: MODEL(), max_tokens: 2000,
      system: governedSystemPrompt("plan_organiser", INSTRUCTIONS),
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    value = validateAiPlan(JSON.parse(text), new Set(candidates.map((c) => c.key)));
  } catch (e) {
    logger.warn({ code: (e as { status?: number })?.status ?? "error" }, "plan organiser: AI step skipped"); // never the question text
    value = null;
  }
  cache.set(ck, { at: Date.now(), value });
  return value;
}

/** Only P2P's stage keys, only known item keys (each once), only gap text that passes governance review. */
export function validateAiPlan(raw: unknown, known: Set<string>): AiPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { stages?: unknown; gaps?: unknown };
  if (!Array.isArray(o.stages)) return null;
  const used = new Set<string>();
  const stages: AiPlan["stages"] = [];
  for (const s of o.stages as { key?: unknown; itemKeys?: unknown }[]) {
    if (!s || !(STAGES as readonly string[]).includes(String(s.key)) || !Array.isArray(s.itemKeys)) continue;
    const keys = (s.itemKeys as unknown[]).filter((k): k is string => typeof k === "string" && known.has(k) && !used.has(k));
    keys.forEach((k) => used.add(k));
    if (keys.length) stages.push({ key: s.key as StageKey, itemKeys: keys });
  }
  const gaps = (Array.isArray(o.gaps) ? o.gaps : []).filter((g): g is string => typeof g === "string").map((g) => g.trim().slice(0, 240)).filter(Boolean).slice(0, 6);
  for (const g of gaps) if (!reviewOutput(g).ok) return null; // one violation discards the whole answer
  return stages.length ? { stages, gaps } : null;
}

/** The rules-based journey re-arranged by a validated AI plan (items come only from the journey's own pool). */
export function applyAiPlan(j: OrganisedJourney, plan: AiPlan): OrganisedJourney {
  const byKey = new Map<string, JourneyItem>([...j.stages.flatMap((s) => s.items), ...j.more].map((i) => [i.key, i]));
  const stages: JourneyStage[] = plan.stages.map((s) => ({ key: s.key, title: STAGE_TITLES[s.key], items: s.itemKeys.map((k) => ({ ...byKey.get(k)!, stage: s.key })) }));
  const used = new Set(stages.flatMap((s) => s.items.map((i) => i.key)));
  const activity = j.stages.find((s) => s.key === "application");
  if (activity && !stages.some((s) => s.key === "application")) stages.push(activity);
  const more = [...byKey.values()].filter((i) => !used.has(i.key) && i.origin !== "activity");
  const electiveLessons = stages.flatMap((s) => s.items).filter((i) => i.resource.kind === "lesson").map((i) => (i.resource as { id: string }).id);
  return { ...j, stages, more, electiveLessons, gaps: [...j.gaps, ...plan.gaps.map((message) => ({ category: "external" as const, message }))] };
}
