// Pure Scripture reference data, reused wherever a verse needs to be
// displayed as a featured moment (ScriptureDisplay-style panels). Text is
// quoted the same way consistently rather than re-typed per page.

export type ScriptureFeature = { reference: string; text: string; theme: string };

export const SCRIPTURE_FEATURES: ScriptureFeature[] = [
  {
    reference: "2 Timothy 2:2",
    text: "…what you have heard from me… entrust to faithful men, who will be able to teach others also.",
    theme: "Multiplication",
  },
  {
    reference: "Habakkuk 2:14",
    text: "For the earth will be filled with the knowledge of the glory of the Lord, as the waters cover the sea.",
    theme: "Global vision",
  },
];

export const SCRIPTURE_2TIM2 = SCRIPTURE_FEATURES[0];
export const SCRIPTURE_HAB214 = SCRIPTURE_FEATURES[1];
