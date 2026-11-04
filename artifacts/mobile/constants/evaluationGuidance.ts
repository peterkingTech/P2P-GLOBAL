// The spiritual purpose of peer evaluation: service, humility, truthfulness,
// encouragement and love — never guilt or pressure. Scripture quoted from the
// World English Bible (public domain).

export const SERVICE_SCRIPTURES = [
  { ref: "1 Peter 4:10", text: "As each has received a gift, employ it in serving one another, as good managers of the grace of God in its various forms." },
  { ref: "Galatians 6:2", text: "Bear one another's burdens, and so fulfill the law of Christ." },
  { ref: "Colossians 3:23–24", text: "And whatever you do, work heartily, as for the Lord, and not for men, knowing that from the Lord you will receive the reward of the inheritance; for you serve the Lord Christ." },
  { ref: "Matthew 20:26–28", text: "Whoever desires to become great among you shall be your servant… even as the Son of Man came not to be served, but to serve, and to give his life as a ransom for many." },
  { ref: "2 Timothy 2:2", text: "The things which you have heard from me among many witnesses, commit the same things to faithful men who will be able to teach others also." },
] as const;

export const ORIENTATION_MESSAGE =
  "You are not merely reviewing an assignment. You are serving another person in their journey of growth. Your responsibility is to help them understand, grow and become better equipped to serve others. Serve faithfully, speak truthfully, encourage patiently and remember that this work is ultimately done unto the Lord.";

export const RESPONSIBILITY_REMINDER =
  "Your role is to serve another person through honest, respectful and encouraging feedback. Complete your responsibility faithfully and within the agreed time.";

/** What every evaluator is prepared for (the orientation). */
export const ORIENTATION_SECTIONS: { title: string; points: string[] }[] = [
  { title: "Why we evaluate", points: [
    "Peer evaluation helps another person understand and apply God's Word.",
    "Evaluate with humility and fairness — encourage growth, never show superiority.",
  ] },
  { title: "How to give feedback", points: [
    "Be clear, respectful and constructive. Start with what was understood well.",
    "Use the lesson, its stated objectives and Scripture — not your own preferences.",
    "Not every difference is an error. Distinguish a clear misunderstanding, an unsupported conclusion, an incomplete explanation and a reasonable difference of interpretation that Scripture allows.",
    "Always include a word of encouragement.",
  ] },
  { title: "Privacy and respect", points: [
    "You see only what was submitted for this evaluation — never journals, reflections or notes.",
    "Keep what you read private and use it only to help this person.",
    "Talk respectfully in the evaluation discussion.",
  ] },
  { title: "Time and reassignment", points: [
    "You have at most 48 hours after you accept. There are no extensions.",
    "P2P Global invites, assigns and reassigns automatically. You can't choose or transfer an evaluation to anyone else.",
    "If something stops you, use “Report inability to complete” — P2P Global arranges someone else, and the learner's work stays safe.",
    "You can pause new invitations at any time in your availability.",
  ] },
];

/** For the workspace: telling a misunderstanding from a reasonable difference. */
export const FAIRNESS_GUIDE =
  "Judge against the lesson, its stated objectives and Scripture. A reasonable difference of interpretation that Scripture allows is not a wrong answer — name it kindly, and keep “needs clarification” for real gaps.";
