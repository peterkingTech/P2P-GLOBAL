// Kingdom Wins — REAL-CONTENT-ONLY POLICY.
//
// Never add an entry here that isn't a real, consented, reviewed testimony
// from an actual P2P community member. No fabricated names, no invented
// circumstances presented as real, no stock-photo "portraits" implied to
// be real users.
//
// The one entry below is explicitly typed and labeled as an example — it
// exists to show the guided five-step shape a real Kingdom Win follows
// (Before / The Journey / What God Did / Today / Encouragement), not to
// stand in for real content.

export type KingdomWin = {
  id: string;
  isExample: true; // every entry today is an example; flip only for real, consented content
  quote: string;
  guidedSteps: string[];
};

export const KINGDOM_WINS: KingdomWin[] = [
  {
    id: "example-01",
    isExample: true,
    quote: "I stopped waiting to be qualified.",
    guidedSteps: ["Before", "The Journey", "What God Did", "Today", "Encouragement"],
  },
];

export const KINGDOM_WINS_EMPTY_STATE =
  "Real community stories will appear here as they become available — shared with consent, reviewed, never for personal recognition.";
