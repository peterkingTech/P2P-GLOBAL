# P2P AI Governance Framework

Version **2026-11-19.1** (`GOVERNANCE_VERSION` in `artifacts/api-server/src/lib/aiGovernance.ts`).

P2P Global has one AI governance framework. It covers every AI feature. Every call to an AI provider goes through `lib/aiGovernance.ts`:

- `governedSystemPrompt(task, instructions)`: the shared principles and boundaries come first, then the task's own instructions. Calling it also enforces `assertTaskAllowed`.
- `scriptureForAI(...)` and `aiAllowedFor(...)`: a Bible translation's licence decides whether its **text** may be sent. If it may not, only references are sent.
- `assertNoPrivateData(payload)`: private fields (notes, reflections, journals, messages, prayer requests, contact details) can never be sent.
- `reviewOutput(text)`: every AI output is checked before anyone sees it. Any violation discards the whole answer.

AI is a supporting technology. It is never a spiritual authority, teacher, pastor, shepherd, peer guide or evaluator. Scripture is the primary authority for biblical teaching.

## A. Biblical principles

All AI tasks operate within these principles:

- Truthfulness
- Humility
- Love
- Wisdom
- Faithfulness to Scripture
- Justice
- Integrity
- Peace
- Servanthood
- Accountability

## B. Behavioural boundaries

These are enforced in the shared prompt, and also checked in the output where they can be detected.

**AI never:**
- Claims to be God, Jesus Christ or the Holy Spirit, or claims that God speaks through it or told it anything.
- Claims revelation, prophecy, discernment or a personal relationship with God.
- Presents a prayer or message as given by God.
- Invents Scripture, quotations, citations, resources, lesson titles, authors, dates or original-language meanings.
- Presents its own conclusions as established biblical fact without evidence.
- Makes medical, financial, legal or personal decisions, or tells anyone to stop medication or treatment.
- Claims to know God's specific will for a person's circumstances.
- Uses Scripture to justify hatred, harassment, abuse or discrimination.

**Sexuality and related questions:** AI explains biblical teaching faithfully and clearly, with references and context. It is respectful, and it distinguishes teaching about conduct from judgement of persons. It names legitimate differences between traditions where they exist.

**Health and personal decisions:** AI points to relevant Scripture, biblical principles and P2P resources, and to appropriate professional or human support.

## C. Approved AI tasks

AI is used only for these tasks:

| Task | Where | Scripture | Default |
|---|---|---|---|
| `plan_organiser` | `lib/planOrganiserAI.ts` — orders and stages resources the search already found, and names gaps. It cannot add a resource; unknown keys are dropped. | References only | **OFF**. Needs `PLANS_AI_ORGANISER=on` and `ANTHROPIC_API_KEY`, and owner approval because it spends credits. |
| `content_translation` | `lib/translationEngine.ts` — P2P-authored learning content into app languages. | Verse text is never sent; references stay as written. | Existing behaviour |
| `wins_moderation_translation` | `lib/winsTranslation.ts` — a **public** Kingdom Win post into English, for moderators only. | None | Existing behaviour |

**Never AI.** No AI summaries, rewrites, interpretations or replies are generated for:

- private chats and group chats;
- family, church and community conversations;
- Study Together conversations;
- P2P Mail.

AI never inspects conversations to build summaries or behavioural profiles. A test checks that no messaging code calls an AI provider.

## D. Source and licensing restrictions

Permission to *display* a translation is not permission to:

- send its text to an AI provider;
- summarise or analyse it with AI;
- train models on it;
- generate speech from it;
- store audio of it;
- cache it offline.

`aiAllowedFor` allows sending text only for public-domain translations, or when a reviewed licence record sets `permits_ai = true`. Model training is never allowed. P2P Voice (text-to-speech) follows the same idea through `syntheticSpeechAllowed` in `lib/bibleLicence.ts`: public-domain Bible translations only.

## E. Privacy and security

- Provider keys stay on the server.
- Payloads are checked for private fields.
- AI logs record status codes only, never the question or the text.
- Results are cached for 6 hours so the same question doesn't spend credits again.

## F. Human accountability, testing and monitoring

- This framework is maintained by authorised P2P administrators and qualified Christian reviewers. Changes are made through reviewed code changes that bump `GOVERNANCE_VERSION`. There is no endpoint that lets an AI, a participant or anyone at runtime edit these rules, and AI cannot approve changes to its own governance.
- Tests: `artifacts/api-server/tests/learningPlans.test.mjs`. They cover:
  - forbidden outputs (divine identity, "God told me", prophecy, medical directives, personal divine will, dehumanising language);
  - licence checks;
  - private-data blocking;
  - the organiser AI step's validation (fake provider, no credits);
  - the absence of AI in messaging code.
- No "AI-generated" labels are shown in search results or journeys. The sources of resources are always shown with them, as the existing source attribution. The Privacy Policy and Terms must explain AI use, its limitations and data processing. That text is **pending** (see the privacy-policy item in the owner's open list).
