export interface LessonSection {
  id: string;
  title: string;
  content: string;
}

export interface CurriculumLesson {
  id: string;
  moduleId: string;
  num: number;
  title: string;
  memoryVerse?: { text: string; ref: string };
  estimatedMinutes: number;
  sections: LessonSection[];
  reflectionQuestions: string[];
  prayer: string;
  assignment?: string;
}

export interface CurriculumModule {
  id: string;
  num: number;
  title: string;
  description: string;
  lessons: CurriculumLesson[];
}

export const CURRICULUM: CurriculumModule[] = [
  // ─────────────────────────────────────────
  // MODULE 0: PEER-TO-PEER ORIENTATION
  // ─────────────────────────────────────────
  {
    id: "m00",
    num: 0,
    title: "Peer-to-Peer Orientation",
    description: "Learn how this discipleship network works and your role within it.",
    lessons: [
      {
        id: "m00l01",
        moduleId: "m00",
        num: 1,
        title: "What Is This Network?",
        memoryVerse: {
          text: "And the things you have heard me say in the presence of many witnesses entrust to reliable people who will also be qualified to teach others.",
          ref: "2 Timothy 2:2",
        },
        estimatedMinutes: 15,
        sections: [
          {
            id: "core-principle",
            title: "The Core Principle",
            content:
              "This is a discipleship movement built on a simple conviction: the moment you learn something true, you become qualified to share it. You do not need a degree, a pulpit, or permission. You need Christ, His Word, and a willing heart.\n\nEvery believer is simultaneously a student and a teacher. You learn from someone one step ahead, and you teach someone one step behind. This is how the early church multiplied — not through institutions but through relationships.",
          },
          {
            id: "biblical-foundation",
            title: "Biblical Foundation",
            content:
              "The apostle Paul modeled this beautifully in 2 Timothy 2:2. He taught Timothy, who would teach reliable people, who would teach others still. Four generations of multiplication in one verse. This is not a modern idea — it is the ancient pattern of the Kingdom.\n\nJesus himself did not write a book. He invested in twelve. Those twelve turned the world upside down. This network follows the same pattern: ordinary people, walking together, passing on what they have received.",
          },
          {
            id: "the-journey",
            title: "Your Journey",
            content:
              "This journey walks through 13 modules and over 85 lessons, from your new identity in Christ to living with eternity in view. Each lesson includes Scripture, reflection, and a checkpoint to mark your progress.\n\nNo one is behind. Whether you are a new believer taking your first steps or a mature Christian seeking a discipleship framework, this tool meets you where you are. No stage is too early. No background is too distant. We are simply walking together, unlocking truth as we go.",
          },
          {
            id: "global-vision",
            title: "The Global Vision",
            content:
              "\"For the earth will be filled with the knowledge of the glory of the Lord as the waters cover the sea.\" — Habakkuk 2:14\n\nJust as we have been mandated by Christ, we fill every mountain of influence with the Word of the Lord — family, education, government, sports, economy, arts, media, and beyond. His glory does not stay within the walls. It flows through willing hearts, through yours and mine, multiplied across every nation and generation.",
          },
        ],
        reflectionQuestions: [
          "What draws you to a peer-to-peer model of discipleship rather than a traditional classroom or church program?",
          "Who in your life is one step ahead of you spiritually? Who is one step behind? How could you engage both?",
          "What fears or hesitations do you have about both learning from and teaching others?",
        ],
        prayer:
          "Lord, I receive this call to walk alongside others. Give me a humble heart to learn and a willing heart to share what I receive. Let your knowledge fill the earth through ordinary people like me.",
        assignment:
          "Write down the name of one person you could invite to walk through this curriculum with you. Pray for them by name every day this week before your next session.",
      },
      {
        id: "m00l02",
        moduleId: "m00",
        num: 2,
        title: "How the Network Works",
        memoryVerse: {
          text: "From him the whole body, joined and held together by every supporting ligament, grows and builds itself up in love, as each part does its work.",
          ref: "Ephesians 4:16",
        },
        estimatedMinutes: 12,
        sections: [
          {
            id: "four-stages",
            title: "The Four Stages",
            content:
              "The network has four clear stages. As a New Learner, you are a student — receive from your peer guide and ask questions freely. As a Mid-Journey learner, you become both student and teacher — learning new lessons while teaching previous ones. When you complete a module, you become a Peer Guide — leading someone else through the same material. When you complete the full journey, you are a Network Leader — training peer guides and launching new groups.",
          },
          {
            id: "session-structure",
            title: "Session Structure",
            content:
              "Every lesson follows the same seven-step structure: (1) Open in Prayer — ask the Holy Spirit to teach both of you. (2) Memory Verse — read it together and try to say it from memory. (3) Read the Lesson — read together or take turns. (4) Discussion Questions — work through them honestly, both sharing. (5) Life Assignment — read and commit together. (6) Checkpoint — can you explain the main idea in your own words? (7) Close in Prayer — pray for each other's specific need.\n\nTiming is decided by the peers. There is no set length — your relationship determines the pace.",
          },
          {
            id: "multiplication",
            title: "The Power of Multiplication",
            content:
              "When one person disciples another, the impact doubles. When those two each disciple someone, it quadruples. This is not arithmetic — it is multiplication. By the time six generations of disciples exist, thousands can be reached from one faithful learner.\n\nThis is the genius of the peer-to-peer model: it does not depend on a few gifted leaders. It depends on every member doing their part. When each part functions as God designed, the body grows and builds itself up in love (Ephesians 4:16).",
          },
        ],
        reflectionQuestions: [
          "Which of the four stages describes where you are right now in your spiritual journey?",
          "What would it look like for you to personally multiply — to guide someone else through what you are learning?",
        ],
        prayer:
          "Father, help me see myself as both a student and a teacher. May I never hoard what I receive but pass it forward generously to others who need what you have given me.",
        assignment:
          "Map out your own discipleship tree on paper. Who discipled you? Who discipled them? Who could you disciple? Bring this map to your next session.",
      },
      {
        id: "m00l03",
        moduleId: "m00",
        num: 3,
        title: "The Peer Guide Role",
        memoryVerse: {
          text: "Be imitators of me, as I am of Christ.",
          ref: "1 Corinthians 11:1",
        },
        estimatedMinutes: 12,
        sections: [
          {
            id: "what-a-guide-is",
            title: "What a Peer Guide Is",
            content:
              "A Peer Guide is NOT a pastor, expert, or authority figure. A Peer Guide is simply someone who has completed the lesson and is willing to walk through it with another person. Your job is to ask the discussion questions — not to lecture. Share your honest experience — not a polished performance. Pray at the start and end of every session. Follow up between sessions with a simple check-in message.",
          },
          {
            id: "what-a-guide-is-not",
            title: "What a Peer Guide Is Not",
            content:
              "A Peer Guide does not need to have all the answers. When stuck, you say, \"I don't know — let's find out together.\" This is not weakness; it is wisdom and honesty.\n\nA Peer Guide does not need to perform. The pressure of appearing expert is off. You are a fellow traveler who walked this path a little earlier. Your authenticity — including your struggles and doubts — is your greatest asset.",
          },
          {
            id: "guide-practices",
            title: "Practical Guide Practices",
            content:
              "Show up consistently. Reliability is discipleship. A canceled session is a message — intentional or not — about what you value.\n\nListen more than you speak. The learner's questions reveal where the Holy Spirit is working. Follow the questions more than the outline.\n\nCelebrate progress. Finishing a lesson or memorizing a verse deserves acknowledgment. Small wins sustained over time produce transformed lives.",
          },
        ],
        reflectionQuestions: [
          "What qualities in a peer guide would most help you as a learner? How can you offer those same qualities to someone else?",
          "Is there a difference between being qualified and feeling qualified to guide someone? How does this lesson address that difference?",
        ],
        prayer:
          "Lord, make me a faithful guide — honest about what I know, humble about what I don't, and consistent enough to show those I walk with that they matter.",
        assignment:
          "Before your next session, reach out to your guide or your learner with a simple encouragement message. It doesn't need to be long. Just show that you're thinking of them.",
      },
      {
        id: "m00l04",
        moduleId: "m00",
        num: 4,
        title: "How to Handle Questions You Cannot Answer",
        memoryVerse: {
          text: "The heart of the discerning acquires knowledge, for the ears of the wise seek it out.",
          ref: "Proverbs 18:15",
        },
        estimatedMinutes: 10,
        sections: [
          {
            id: "honest-responses",
            title: "Three Honest Responses",
            content:
              "When you don't know the answer to a question, three responses are always appropriate: \"That's a great question. Let me find out and come back to you.\" Or: \"Let's look at it together — what does the passage actually say?\" Or: \"I don't know, but let's ask someone who does.\"\n\nThese responses are not failures. They are models of intellectual humility that your learner will internalize. You are teaching them HOW to think about hard questions — not just giving them answers.",
          },
          {
            id: "what-never-to-do",
            title: "What You Must Never Do",
            content:
              "Never guess or make up an answer to a theological question. A wrong answer given confidently does more damage than an honest \"I don't know.\" The learner may carry that wrong answer for years.\n\nNever avoid the question and change the subject. This teaches that certain questions are off limits — which is the opposite of the open inquiry the Kingdom invites.\n\nNever pretend the question is wrong or irrelevant. Questions are the engine of growth. Honor every one.",
          },
          {
            id: "creating-safe-space",
            title: "Creating a Safe Space for Questions",
            content:
              "The best peer sessions are the ones where the learner feels safe to ask anything. This safety is not created by having all the answers — it is created by the way you receive questions.\n\nWhen you respond with curiosity rather than defensiveness, you model what it means to pursue truth. Your learner learns that Christianity is not fragile — it can withstand honest wrestling.",
          },
        ],
        reflectionQuestions: [
          "What kinds of questions make you most uncomfortable? Why do you think that is?",
          "How can your honest \"I don't know\" actually increase your learner's trust in you rather than decrease it?",
        ],
        prayer:
          "Father, give me the humility to admit what I don't know and the curiosity to find out. Make me a safe person for hard questions.",
        assignment:
          "This week, if you encounter a question you can't answer, write it down and research it using at least two Scripture passages and one commentary or trusted resource. Bring your findings to your next session.",
      },
      {
        id: "m00l05",
        moduleId: "m00",
        num: 5,
        title: "What to Do When Someone Drops Out",
        memoryVerse: {
          text: "Suppose one of you has a hundred sheep and loses one of them. Doesn't he leave the ninety-nine in the open country and go after the lost sheep until he finds it?",
          ref: "Luke 15:4",
        },
        estimatedMinutes: 10,
        sections: [
          {
            id: "the-pursuit",
            title: "The Posture of Pursuit",
            content:
              "When a learner drops out, follow up personally within 48 hours — with no guilt, just care. Ask one question: \"What got in the way?\" Offer to restart, shorten sessions, or change the meeting time or format.\n\nA dropped-out learner is not a failure. They are a person who needs pursuit, not pressure. The shepherd who has 100 sheep and loses one does not comfort himself with 99 — he goes after the one.",
          },
          {
            id: "common-reasons",
            title: "Common Reasons for Dropping Out",
            content:
              "Life overwhelms. Work, family, illness, and circumstances are real. Do not spiritualize struggles that are practical. Sometimes what a learner needs is not deeper theology but a rescheduled time.\n\nSometimes the issue is shame — a learner feels they are too far behind or too broken to continue. Your warmth and lack of judgment are the exact remedy for shame-driven dropout.\n\nSometimes the issue is spiritual resistance. New growth brings opposition. Pray for your learner whether or not they return.",
          },
          {
            id: "no-shame",
            title: "No Shame in Returning",
            content:
              "Make returning easy. A learner who paused should never feel they need to explain themselves or earn their way back. The door is always open, the progress is always there, and you are always glad they came back.\n\nModel the Father's posture in Luke 15 — the father did not interrogate the returning son before embracing him. He ran toward him while he was still a long way off.",
          },
        ],
        reflectionQuestions: [
          "Have you ever dropped out of something that was good for you? What did you need in that moment from the person leading you?",
          "How does the parable of the lost sheep change how you view a dropped-out learner?",
        ],
        prayer:
          "Lord, give me the shepherd's heart — willing to leave my comfort to pursue the one who wandered. Let them feel wanted, not shamed.",
        assignment:
          "Think of someone who has stepped back from church, study, or community. Reach out to them this week with no agenda except to express care.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 1: YOUR NEW IDENTITY IN CHRIST
  // ─────────────────────────────────────────
  {
    id: "m01",
    num: 1,
    title: "Your New Identity in Christ",
    description: "Understand what happened at the moment of salvation and who you now are in Christ.",
    lessons: [
      {
        id: "m01l01",
        moduleId: "m01",
        num: 1,
        title: "Regeneration (Being Born Again)",
        memoryVerse: {
          text: "Very truly I tell you, no one can see the kingdom of God unless they are born again.",
          ref: "John 3:3",
        },
        estimatedMinutes: 18,
        sections: [
          {
            id: "what-is-regeneration",
            title: "What Is Regeneration?",
            content:
              "Regeneration is the instantaneous work of the Holy Spirit in which He imparts a new nature — a transition from spiritual death to spiritual life. (Ephesians 2:1, 5; Colossians 2:13)\n\nThis is necessary because physical life does not guarantee spiritual life. A person can be biologically alive while being spiritually dead — separated from God, unable to understand His ways or respond to His call. Regeneration is God's answer to this problem.",
          },
          {
            id: "who-needs-it",
            title: "Who Needs It and Why",
            content:
              "Every human being is born into spiritual death — this is the consequence of the fall described in Genesis 3. We are not primarily sinners because we sin; we sin because we are by nature separated from the life of God. Regeneration does not improve the old nature — it creates a new one.\n\nRegenerations occurs in every person who genuinely repents of sin and places faith in Jesus Christ. It is not a gradual process but an instantaneous transformation — a passing from death to life.",
          },
          {
            id: "evidence",
            title: "Evidence of Regeneration",
            content:
              "How do you know regeneration has occurred? The New Testament describes clear signs:\n\n• New desires for God and truth — the things of God become compelling, not merely obligatory.\n• Conviction of sin — a sensitivity to wrongdoing that was not present before.\n• Love for other believers — a genuine affection for the family of God.\n• Understanding of spiritual truths — Scripture begins to make sense in a new way.\n• A new inner witness — the Holy Spirit confirming your relationship with God (Romans 8:16).\n\nThese are not prerequisites for salvation — they are the fruit of it.",
          },
          {
            id: "the-distinction",
            title: "Born Once vs. Born Twice",
            content:
              "Martin Luther said that a person is born twice or dies twice. The first birth is physical. The second birth is spiritual — the new birth Jesus described to Nicodemus in John 3. The person born only once will die twice: first physically, then eternally. The person born twice will die only once physically, and then live forever with God.\n\nThis is the stakes of the new birth. It is not a metaphor for self-improvement. It is the difference between eternal life and eternal separation from God.",
          },
        ],
        reflectionQuestions: [
          "How do you know you have been born again? What evidence do you see in your own life?",
          "How does understanding regeneration as God's work — not yours — change how you relate to your own spiritual growth?",
          "How would you explain the new birth to someone who had never heard of it?",
        ],
        prayer:
          "Thank you, Lord, that you did not leave me in spiritual death. You breathed new life into me. Let the evidence of that new birth grow more visible every day.",
        assignment:
          "Read John 3:1-21 slowly. Write down every contrast Jesus draws between the old life and the new. Bring your list to your next session.",
      },
      {
        id: "m01l02",
        moduleId: "m01",
        num: 2,
        title: "Justification",
        memoryVerse: {
          text: "Therefore, since we have been justified through faith, we have peace with God through our Lord Jesus Christ.",
          ref: "Romans 5:1",
        },
        estimatedMinutes: 18,
        sections: [
          {
            id: "what-is-justification",
            title: "What Is Justification?",
            content:
              "Justification is the instantaneous and legal act of God whereby He declares the ungodly sinner righteous in His sight. It is the divine reversal of verdict — from \"guilty\" to \"not guilty\" and indeed \"righteous.\"\n\nWithout justification, no human can stand before God's judgment. God's standard is perfect righteousness, and justification solves that legal problem once and for all.",
          },
          {
            id: "how-it-works",
            title: "How It Works: Imputation",
            content:
              "Justification works through a double imputation. God imputes (credits) the righteousness of Christ to the believer's account, and He imputes the believer's sin to Christ's account (2 Corinthians 5:21). This is the great exchange: our sin goes to the cross; Christ's righteousness comes to us.\n\nThis is received by grace — not by our works (Ephesians 2:8-9). You cannot earn it, maintain it by performance, or lose it by failure. It is a gift of God declared in a moment and permanent forever.",
          },
          {
            id: "results",
            title: "What Justification Produces",
            content:
              "The results of justification are extraordinary:\n\n• Peace with God (Romans 5:1) — the war is over. The enmity between God and the sinner is resolved.\n• Access to grace (Romans 5:2) — we can approach God boldly as a child approaches a loving Father.\n• Hope of glory (Romans 5:2) — our eternal security is guaranteed.\n• No condemnation (Romans 8:1) — every charge against us is permanently dropped.\n\nYou are not on probation. You are declared righteous.",
          },
          {
            id: "not-merely-forgiveness",
            title: "More Than Forgiveness",
            content:
              "Many believers understand forgiveness but do not yet grasp justification. Forgiveness removes guilt. Justification goes further — it declares you positively righteous in God's eyes.\n\nImagine a criminal who is forgiven but has no record of good deeds. Now imagine that criminal acquitted AND given a full record of perfect obedience. The first is forgiveness. The second is justification. God does not merely wipe your record clean — He gives you Christ's record.",
          },
        ],
        reflectionQuestions: [
          "Have you ever lived as if you are still on trial before God — trying to earn His approval through performance? How does justification address this?",
          "What does it mean to have Christ's righteousness credited to your account? How should this change how you feel about yourself before God?",
          "Why is it important that justification is a legal declaration and not merely a feeling?",
        ],
        prayer:
          "Father, I receive the verdict You declared over me in Christ — not guilty, but righteous. Help me live from that truth rather than constantly trying to earn what you have freely given.",
        assignment:
          "Read Romans 4 this week. List every way Paul describes faith being credited as righteousness. Note what Abraham did and did not do to receive this standing.",
      },
      {
        id: "m01l03",
        moduleId: "m01",
        num: 3,
        title: "Adoption",
        memoryVerse: {
          text: "The Spirit you received brought about your adoption to sonship. And by him we cry, Abba, Father.",
          ref: "Romans 8:15",
        },
        estimatedMinutes: 16,
        sections: [
          {
            id: "what-is-adoption",
            title: "What Is Adoption?",
            content:
              "Adoption is the act whereby God places the justified believer into His family as a son or daughter. While justification solves the legal problem of sin, adoption solves the relational problem of alienation.\n\nAdoption is permanent and irreversible because God does not disown His own children. Your standing as a child of God does not depend on your performance — it depends on His word.",
          },
          {
            id: "privileges",
            title: "The Privileges of Adoption",
            content:
              "Adoption confers extraordinary rights and privileges:\n\n• The right to call God \"Abba\" — the intimate word for \"Daddy\" (Romans 8:15; Galatians 4:6)\n• The privilege of intimate access to the Father's presence at any time\n• The assurance of the Father's discipline (Hebrews 12:5-11) — only legitimate children are disciplined; correction is a sign of sonship\n• The inheritance rights of co-heirs with Christ (Romans 8:17)\n• The family likeness being formed in us (1 John 3:1-3)",
          },
          {
            id: "the-problem-it-solves",
            title: "The Relational Problem It Solves",
            content:
              "Before salvation, humans exist in a state of spiritual orphanhood — separated from the Father, without family, without inheritance, without access. Justification clears the legal record, but adoption brings the orphan home.\n\nThe story of the prodigal son in Luke 15 is a portrait of adoption. The son returned expecting to be a hired servant — that is justification thinking. But the father ran to embrace him, clothed him in the robe, put a ring on his finger, and threw a party. That is the lavishness of adoption.",
          },
          {
            id: "orphan-vs-son",
            title: "Orphan Spirit vs. Sonship",
            content:
              "Many believers are justified but functionally live as spiritual orphans — striving, performing, and fearing rejection from God. They know they are saved but not that they are beloved.\n\nSonship means you approach God as a beloved child, not as a servant earning favor. Your prayer changes. Your worship changes. Your willingness to confess and return changes when you know the Father runs toward you.",
          },
        ],
        reflectionQuestions: [
          "Do you relate to God more as a servant earning approval or as a child who is already loved? Be honest.",
          "What difference does it make that God calls you \"son\" or \"daughter\" — not just \"forgiven\"?",
          "How does knowing that God's discipline is a sign of sonship (not rejection) change how you interpret hard seasons?",
        ],
        prayer:
          "Abba, Father — I receive that name. I am your child, not a servant. Heal any orphan thinking in me and let me live from the security of being fully loved and permanently welcomed.",
        assignment:
          "Read Luke 15:11-32 slowly. From the younger son's journey — leaving, suffering, returning, being received — identify every element that mirrors your own spiritual story.",
      },
      {
        id: "m01l04",
        moduleId: "m01",
        num: 4,
        title: "Grace & Faith",
        memoryVerse: {
          text: "For it is by grace you have been saved, through faith — and this is not from yourselves, it is the gift of God — not by works, so that no one can boast.",
          ref: "Ephesians 2:8-9",
        },
        estimatedMinutes: 16,
        sections: [
          {
            id: "what-is-grace",
            title: "What Is Grace?",
            content:
              "Grace is God's unmerited favor — His generosity toward those who deserve the opposite. The Greek word is charis, meaning gift freely given. It is not grace if it is earned. It is not grace if it must be maintained by performance.\n\nGrace is the foundation upon which every aspect of salvation rests. Regeneration is by grace. Justification is by grace. Adoption is by grace. Sanctification is by grace. Glorification is by grace. Every step of the Christian life is a grace-step.",
          },
          {
            id: "what-is-faith",
            title: "What Is Faith?",
            content:
              "Faith is not a feeling, not wishful thinking, and not willpower. Biblical faith has three elements:\n\n1. Knowledge (notitia) — knowing the facts about Christ: that He died for sins and rose again.\n2. Assent (assensus) — agreeing that these facts are true, not merely possible.\n3. Trust (fiducia) — personally resting on Christ and His work, not on yourself.\n\nThe third element is what distinguishes saving faith from intellectual acknowledgment. Even the demons know and assent that Jesus is Lord (James 2:19) — but they do not trust Him.",
          },
          {
            id: "grace-through-faith",
            title: "Grace Through Faith",
            content:
              "The relationship between grace and faith in salvation is critical to understand. We are saved by grace — grace is the source and cause. We are saved through faith — faith is the channel or instrument, not the cause.\n\nFaith is the hand that receives the gift of grace. The gift is the valuable thing; the hand merely receives it. This is why even faith itself is described as \"not from yourselves\" — it is the gift of God (Ephesians 2:8). God initiates, provides, and enables the very faith by which we receive Him.",
          },
          {
            id: "not-by-works",
            title: "Why Not By Works",
            content:
              "God designed salvation to exclude boasting (Ephesians 2:9). If any part of salvation depended on our effort, we could share the credit with God — which is exactly the problem. Human pride wants to contribute to its own salvation.\n\nThe grace-faith model leaves no room for pride. You brought nothing to your salvation except the sin that made it necessary. This is not humiliating — it is liberating. You do not have to maintain salvation through performance. What was freely given is freely sustained.",
          },
        ],
        reflectionQuestions: [
          "Where in your life do you catch yourself trying to earn God's favor rather than receive His grace?",
          "Do you have knowledge and assent about Christ, or do you also have personal trust — resting your weight on Him?",
          "How does knowing that even your faith is a gift from God change how you relate to those who don't yet believe?",
        ],
        prayer:
          "Lord, I receive your grace — not because I deserve it but because you give it freely. Help me stop striving and start resting in what has already been done.",
        assignment:
          "Study Ephesians 2:1-10 this week. Write out the contrast between what we were (verses 1-3) and what we now are (verses 4-10). Notice how many times \"God\" is the active agent.",
      },
      {
        id: "m01l05",
        moduleId: "m01",
        num: 5,
        title: "New Creation & Fourfold Change",
        memoryVerse: {
          text: "Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!",
          ref: "2 Corinthians 5:17",
        },
        estimatedMinutes: 16,
        sections: [
          {
            id: "new-creation",
            title: "You Are a New Creation",
            content:
              "The phrase \"new creation\" in 2 Corinthians 5:17 is cosmic language. Paul uses the same Greek word (kainos) used in Revelation 21 for the new heavens and new earth. When you came to Christ, something was not renovated — something new was created.\n\nThe old has gone. Not suppressed, not reformed — gone. The new has come. Not merely added — but constituted your new reality. This is your identity. Not what you were. What you are.",
          },
          {
            id: "fourfold-change",
            title: "The Fourfold Change",
            content:
              "At salvation, four profound changes occur simultaneously:\n\n1. Positional Change — you are moved from the kingdom of darkness to the Kingdom of God's beloved Son (Colossians 1:13). Your standing before God is new.\n\n2. Relational Change — you are no longer an enemy of God but a child (John 1:12). Your relationship with God is transformed.\n\n3. Spiritual Change — the Holy Spirit now dwells within you (1 Corinthians 6:19-20). Your spiritual capacity is entirely new.\n\n4. Directional Change — you are no longer headed toward death but toward life (John 5:24). Your eternal destination is reversed.",
          },
          {
            id: "living-from-identity",
            title: "Living From Your New Identity",
            content:
              "Many believers know they are saved but still live from their old identity — the way they thought about themselves before Christ. They struggle to receive love, to believe they are righteous, to expect God's presence.\n\nThe command of the New Testament is to reckon yourself dead to sin and alive to God (Romans 6:11). \"Reckon\" means to account something as true regardless of how it feels. Your feelings may lag behind your identity — reckon anyway.",
          },
          {
            id: "old-and-new",
            title: "Old Habits vs. New Nature",
            content:
              "The new creation still lives in a body with old habits, patterns, and memories. These are not the old self — they are residue. The battle of the Christian life is not to become what you are not; it is to live as what you already are.\n\nYou are not fighting to become a new creation. You are already a new creation learning to walk like one. The war is between your new nature and old patterns — but the outcome is settled. The new creation is who you are; the old patterns are what you are leaving behind.",
          },
        ],
        reflectionQuestions: [
          "What parts of your \"old\" identity still feel more real to you than your identity in Christ? Why?",
          "Which of the four changes (positional, relational, spiritual, directional) is hardest for you to believe is true of you?",
          "What would it look like to \"reckon\" yourself a new creation in a practical situation you face this week?",
        ],
        prayer:
          "Lord, I am a new creation. I choose to agree with what you say about me rather than what my past or feelings say. Renew my mind to think from my new identity outward.",
        assignment:
          "Write a one-paragraph description of who you are in Christ — using only Scripture. Do not write what you hope to become. Write who you already are. Read it aloud every morning this week.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 2: KNOWING GOD
  // ─────────────────────────────────────────
  {
    id: "m02",
    num: 2,
    title: "Knowing God",
    description: "Explore the nature, character, and attributes of God — Father, Son, and Holy Spirit.",
    lessons: [
      {
        id: "m02l01",
        moduleId: "m02",
        num: 1,
        title: "Theology Proper: Who Is God?",
        memoryVerse: { text: "God is spirit, and his worshipers must worship in the Spirit and in truth.", ref: "John 4:24" },
        estimatedMinutes: 15,
        sections: [
          { id: "definition", title: "Defining God", content: "Theology Proper is the study of God Himself — not merely His works, but His essential being and nature. Before we can know what God does, we must understand who God is.\n\nThe Bible presents God as the uncreated Creator — the one Being who has always existed, who depends on nothing outside Himself for existence, and who is the source and sustainer of all that exists. He is not the greatest being among beings — He is in a category by Himself." },
          { id: "essential-nature", title: "God's Essential Nature", content: "God is spirit (John 4:24) — He is not material, not confined to physical existence, not located in one place. He is invisible to the natural eye, but fully real and present.\n\nGod is personal — He thinks, speaks, loves, and relates. He is not a force or an energy. He is a Person who knows your name, your thoughts, and the number of hairs on your head.\n\nGod is one — there is no other god beside Him (Isaiah 45:5). All other so-called gods are either human constructions or spiritual imposters." },
          { id: "self-existence", title: "The Self-Existing God", content: "When Moses asked God for His name, God replied \"I AM WHO I AM\" (Exodus 3:14). This name communicates self-existence — God's existence is self-grounded, not derived from anything else.\n\nThis is sometimes called the \"aseity\" of God. It means God has no needs, no dependencies, no vulnerabilities. He did not create humanity because He was lonely. He created out of overflowing love and for His glory." },
        ],
        reflectionQuestions: [
          "How does understanding that God is self-existent change how you think about your relationship with Him?",
          "What false ideas about God did you bring into your faith, and how has the truth of Scripture corrected them?",
        ],
        prayer: "Lord, I want to know you as you truly are — not as I imagine you. Open my heart and mind to see you clearly through your Word.",
        assignment: "Read Isaiah 40:12-31 slowly. List every description of God's nature in the passage. Which attribute most astonishes you?",
      },
      {
        id: "m02l02",
        moduleId: "m02",
        num: 2,
        title: "The Trinity",
        memoryVerse: { text: "May the grace of the Lord Jesus Christ, and the love of God, and the fellowship of the Holy Spirit be with you all.", ref: "2 Corinthians 13:14" },
        estimatedMinutes: 20,
        sections: [
          { id: "definition", title: "What Is the Trinity?", content: "The doctrine of the Trinity holds that there is one God who eternally exists as three distinct Persons — Father, Son, and Holy Spirit. These three are fully and equally God, yet they are not three gods but one God.\n\nThis is a mystery that cannot be fully comprehended, but it can be clearly taught from Scripture and is essential to Christian faith. No other religion holds this view of God." },
          { id: "biblical-evidence", title: "Biblical Evidence", content: "The Trinity is taught throughout both Testaments. At Jesus' baptism, all three persons are present simultaneously: the Father speaks from heaven, the Son is baptized in the Jordan, and the Spirit descends as a dove (Matthew 3:16-17).\n\nThe Great Commission commands baptism \"in the name [singular] of the Father and of the Son and of the Holy Spirit\" (Matthew 28:19) — three persons, one name. The Aaronic blessing in Numbers 6 contains a triple invocation. The New Testament letters constantly invoke all three persons together (2 Corinthians 13:14)." },
          { id: "distinctions", title: "Three Persons, One Essence", content: "The three Persons are distinct — the Father is not the Son, the Son is not the Spirit, the Spirit is not the Father. Each has distinct roles, speaks to the others, and relates to the others. But they share one divine essence — they are not three separate gods.\n\nWithin the Trinity there is both equality of essence and functional order. The Son submits to the Father in His incarnation (John 14:28) — not because He is less divine, but because roles exist within perfect equality." },
          { id: "why-it-matters", title: "Why the Trinity Matters", content: "The Trinity means that God is inherently relational — love existed within God before creation. He did not create humanity to have something to love. Love was always His nature, expressed within the eternal community of Father, Son, and Spirit.\n\nThis also means you were made for relationship — in the image of a relational God. The longing for deep connection you feel is not weakness; it is image-bearing." },
        ],
        reflectionQuestions: [
          "Why do you think the Trinity is difficult to understand — and why is that difficulty appropriate?",
          "How does understanding God as inherently relational (Trinity) change your understanding of love, community, and church?",
        ],
        prayer: "Father, Son, and Holy Spirit — I worship you, one God in three Persons. I may not fully understand you, but I fully trust you.",
        assignment: "Identify three moments in the Gospels where all three Persons of the Trinity appear. Describe what each Person is doing in each moment.",
      },
      {
        id: "m02l03",
        moduleId: "m02",
        num: 3,
        title: "Attributes of God: Nature (Part 1)",
        memoryVerse: { text: "Before the mountains were born or you brought forth the whole world, from everlasting to everlasting you are God.", ref: "Psalm 90:2" },
        estimatedMinutes: 18,
        sections: [
          { id: "spirituality", title: "Spirituality & Life", content: "God is spirit (John 4:24) — He is not material and not confined by physical reality. He is also the living God — He is not merely a concept but actively present and personally engaged with His creation (Deuteronomy 5:26).\n\nLife flows from God. He breathed life into Adam (Genesis 2:7). He is the fountain of life (Psalm 36:9). Apart from Him, nothing lives. This is why knowing Him is eternal life (John 17:3)." },
          { id: "infinity-eternity", title: "Infinity & Eternity", content: "God is infinite — unlimited by time, space, or any creaturely boundary. Eternity is not endless time — it is the absence of time. God exists outside the timeline He created.\n\nThis means God's love for you is not a decision He made in time — it is an eternal reality that preceded your existence. Before the foundation of the world, He chose you in Christ (Ephesians 1:4)." },
          { id: "omni", title: "Omnipresence, Omniscience, Omnipotence", content: "God is omnipresent — present everywhere simultaneously (Psalm 139:7-12). There is no place you can go where God is not fully present.\n\nGod is omniscient — He knows all things, including all possibilities, all futures, all thoughts. He knows your heart more completely than you know it (Psalm 139:1-4). He is never surprised.\n\nGod is omnipotent — all-powerful. Nothing is impossible with God (Luke 1:37), though He chooses not to do what violates His nature (He cannot lie, cannot sin)." },
        ],
        reflectionQuestions: [
          "How does God's omnipresence comfort you in loneliness? How does it challenge you in secret sin?",
          "What is one situation in your life where you need to trust God's omnipotence — His ability to do what seems impossible?",
        ],
        prayer: "Lord, you are beyond my comprehension, yet you are near. Teach me to trust what I cannot measure.",
        assignment: "Read Psalm 139 slowly. Write down every attribute of God described in the psalm. Which one do you most need to meditate on this week?",
      },
      {
        id: "m02l04",
        moduleId: "m02",
        num: 4,
        title: "Attributes of God: Character (Part 2)",
        memoryVerse: { text: "The Lord, the Lord, the compassionate and gracious God, slow to anger, abounding in love and faithfulness.", ref: "Exodus 34:6" },
        estimatedMinutes: 18,
        sections: [
          { id: "holiness", title: "Holiness & Righteousness", content: "Holiness is the attribute that Isaiah's seraphim declared three times: \"Holy, holy, holy is the Lord Almighty\" (Isaiah 6:3). It means God is entirely separate from all that is impure, sinful, and common. He is morally perfect — incapable of evil.\n\nRighteousness flows from holiness — God always acts in perfect accord with His moral nature. He never acts unjustly, never ignores wrong, never fails to uphold what is right." },
          { id: "truth-goodness", title: "Truth & Goodness", content: "God is truth — He cannot lie (Titus 1:2; Numbers 23:19). Every promise He has made He will keep. Every word He has spoken is reliable. This is the foundation of our trust in Scripture.\n\nGod is good — His essential nature is beneficent, generous, and oriented toward the flourishing of His creatures. \"The Lord is good to all; he has compassion on all he has made\" (Psalm 145:9). This goodness is not naive — He is also just." },
          { id: "love-mercy-grace", title: "Love, Mercy, Grace & Patience", content: "Love is not merely what God does — it is who He is (1 John 4:8). His love is not contingent on our lovableness. It is an attribute of His eternal nature.\n\nMercy is God not giving us what we deserve. Grace is God giving us what we do not deserve. Patience is God delaying judgment to allow repentance (2 Peter 3:9).\n\nThese attributes are not in tension with His holiness — they are expressed through the cross, where justice and mercy met in the sacrifice of Christ." },
        ],
        reflectionQuestions: [
          "Which of God's moral attributes have you found hardest to believe in your own experience? Why?",
          "How does the cross demonstrate multiple attributes of God simultaneously?",
        ],
        prayer: "Lord, you are holy and you are love. You are just and you are merciful. I worship you for the fullness of who you are.",
        assignment: "Choose one attribute of God from this lesson. Find five verses in Scripture that illustrate it. Write a brief reflection on how that attribute has been real in your life.",
      },
      {
        id: "m02l05",
        moduleId: "m02",
        num: 5,
        title: "God the Father",
        memoryVerse: { text: "See what great love the Father has lavished on us, that we should be called children of God! And that is what we are!", ref: "1 John 3:1" },
        estimatedMinutes: 15,
        sections: [
          { id: "fatherhood", title: "The Fatherhood of God", content: "God is Father in three distinct senses: eternally as the Father of the Son within the Trinity; universally as the Creator of all humanity (Malachi 2:10); and redemptively as the Father of all who are born again through faith in Christ.\n\nThe New Testament emphasizes the redemptive fatherhood — the intimate, personal relationship available to those who believe. This is the Abba relationship — not a formal title but the cry of a child who is fully at home." },
          { id: "father-provision", title: "The Father Provides", content: "Jesus taught His disciples that the Father knows what you need before you ask Him (Matthew 6:8). The Sermon on the Mount repeatedly points to God's fatherly care — how much more will He give good things to those who ask (Matthew 7:11).\n\nThe Father is not reluctant to give. He is the One who delights to give good gifts. The widow and the unjust judge story (Luke 18) is not saying God is like the unjust judge — it is saying that if even an unjust judge responds to persistence, how much more will a good Father?" },
          { id: "father-discipline", title: "The Father Disciplines", content: "Fatherhood in Scripture includes correction. \"The Lord disciplines the one he loves, as a father the son he delights in\" (Proverbs 3:12; Hebrews 12:6). Hard seasons are not signs of the Father's rejection — they are signs of His engagement.\n\nThe Father does not discipline to punish — Christ took the punishment. He disciplines to form — to shape the character of His children for their good and His glory." },
        ],
        reflectionQuestions: [
          "What image of \"father\" did you inherit from your earthly father? How has God been redefining that image?",
          "Do you find it easy or difficult to receive the Father's provision and care without striving? Why?",
        ],
        prayer: "Abba, Father — I am yours. Let the reality of your fatherhood go deeper than my understanding. I want to know you as my Father, not just my God.",
        assignment: "Read Matthew 6:25-34. List every way Jesus describes the Father's care. Which one do you need to receive most personally?",
      },
      {
        id: "m02l06",
        moduleId: "m02",
        num: 6,
        title: "God the Son (Christology)",
        memoryVerse: { text: "For in Christ all the fullness of the Deity lives in bodily form.", ref: "Colossians 2:9" },
        estimatedMinutes: 20,
        sections: [
          { id: "pre-existence", title: "The Pre-Existence of Christ", content: "Jesus Christ did not begin at Bethlehem. He existed before all creation (John 1:1-2; 8:58). He is the eternal Son of God — the second Person of the Trinity — who took on human flesh at the incarnation.\n\nIn John 8:58, Jesus said \"Before Abraham was, I am\" — using the divine name (I AM) from Exodus 3. The Jewish leaders immediately tried to stone Him for blasphemy because they understood exactly what He was claiming." },
          { id: "incarnation", title: "The Incarnation", content: "The incarnation is the eternal Son of God taking on full human nature — body, soul, and spirit — without giving up His divine nature. He became what He was not (human) without ceasing to be what He always was (divine).\n\nPhilippians 2:6-8 describes this: He \"emptied Himself\" — not of His deity, but of the independent exercise of His divine prerogatives. He lived His earthly life in full dependence on the Father and the Spirit, the way we are called to live." },
          { id: "two-natures", title: "Fully God, Fully Human", content: "The Council of Chalcedon (AD 451) articulated what Scripture teaches: Jesus Christ is one Person with two natures — fully divine and fully human — without confusion, change, division, or separation.\n\nHe was born of a virgin (Luke 1:35). He grew in wisdom and stature (Luke 2:52). He was tempted in all points as we are, yet without sin (Hebrews 4:15). He suffered, wept, bled, and died. He also calmed storms, raised the dead, and claimed to forgive sins — which only God can do." },
          { id: "work-of-christ", title: "The Work of Christ", content: "Christ came to accomplish what we could not: perfect obedience to God in our place (His active righteousness, credited to us) and to bear the full penalty of sin in our place (His passive righteousness, death for us).\n\nHis resurrection demonstrates that His sacrifice was accepted, that death has been conquered, and that new creation has begun. His ascension places Him at the right hand of the Father as our eternal High Priest — interceding for us always (Hebrews 7:25)." },
        ],
        reflectionQuestions: [
          "Why does it matter that Jesus was fully human and not merely appearing to be human?",
          "How does knowing Jesus sympathizes with your weakness (having been fully human) change how you bring your struggles to Him?",
        ],
        prayer: "Lord Jesus, you are fully God and you became fully human for me. I am in awe of your condescension. Let me never take your incarnation for granted.",
        assignment: "Read Philippians 2:5-11. Identify the downward journey of Christ (what He gave up) and the upward exaltation (what He received). How does this shape your attitude toward humility?",
      },
      {
        id: "m02l07",
        moduleId: "m02",
        num: 7,
        title: "God the Holy Spirit (Pneumatology)",
        memoryVerse: { text: "And I will ask the Father, and he will give you another advocate to help you and be with you forever — the Spirit of truth.", ref: "John 14:16-17" },
        estimatedMinutes: 18,
        sections: [
          { id: "personhood", title: "The Personhood of the Spirit", content: "The Holy Spirit is not a force, an energy, or an influence. He is a Person — the third Person of the Trinity — who thinks, speaks, grieves, and loves.\n\nHe teaches (John 14:26), guides (John 16:13), intercedes (Romans 8:26), convicts (John 16:8), and distributes gifts as He wills (1 Corinthians 12:11). All of these are personal actions that a force or energy cannot perform." },
          { id: "deity", title: "The Deity of the Spirit", content: "The Holy Spirit is fully God. Ananias and Sapphira \"lied to the Holy Spirit\" — and Peter says they \"lied to God\" (Acts 5:3-4). The Spirit is omniscient (1 Corinthians 2:10-11), omnipresent (Psalm 139:7), omnipotent (Romans 8:11), and eternal (Hebrews 9:14).\n\nHe is the Spirit of God and the Spirit of Christ (Romans 8:9) — not a lesser being but the full presence of God dwelling within believers." },
          { id: "indwelling", title: "The Spirit Within You", content: "At the moment of salvation, the Holy Spirit takes up permanent residence within every believer (1 Corinthians 6:19-20; Romans 8:9). You are now the temple of the Holy Spirit.\n\nThis is the New Covenant reality — God does not dwell above you in a temple made of stone; He dwells within you. He seals you (Ephesians 1:13), assures you (Romans 8:16), empowers you (Acts 1:8), and transforms you into the image of Christ (2 Corinthians 3:18)." },
        ],
        reflectionQuestions: [
          "How does treating the Holy Spirit as a Person rather than a force change how you relate to Him?",
          "In what areas of your life do you most need the Spirit's help and guidance right now?",
        ],
        prayer: "Holy Spirit, you are welcome here — in my heart, in my decisions, in my relationships. Lead me into all truth and bear your fruit in my life.",
        assignment: "List five things the Holy Spirit does in the life of a believer from the Book of Romans, chapters 8. Reflect on which of these are most active in your life.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 3: THE LORDSHIP OF JESUS CHRIST
  // ─────────────────────────────────────────
  {
    id: "m03",
    num: 3,
    title: "The Lordship of Jesus Christ",
    description: "What it means to submit every area of life to the authority of Jesus as Lord.",
    lessons: [
      {
        id: "m03l01", moduleId: "m03", num: 1,
        title: "Lordship: Definition & Necessity",
        memoryVerse: { text: "Therefore God exalted him to the highest place and gave him the name that is above every name, that at the name of Jesus every knee should bow.", ref: "Philippians 2:9-10" },
        estimatedMinutes: 15,
        sections: [
          { id: "definition", title: "What Is Lordship?", content: "Lordship means supreme authority. To call Jesus \"Lord\" is to acknowledge that He has the right to govern every area of life — not just Sunday mornings, not just private devotions, but every decision, relationship, ambition, and resource.\n\nThe New Testament word for Lord is Kyrios — the same word used in the Greek Old Testament for Yahweh. When early Christians said \"Jesus is Lord,\" they were making a politically dangerous and theologically absolute claim." },
          { id: "necessity", title: "Why Lordship Is Necessary", content: "Salvation is not merely asking Jesus into your heart as a helper while you remain in charge. It is transferring the throne of your life to Him. Repentance means turning from self-rule to His rule.\n\nA Jesus who is Savior but not Lord is not the Jesus of the New Testament. He does not offer partial sovereignty. \"No one can serve two masters\" (Matthew 6:24). The question is not whether you have a lord — it is who your lord is." },
          { id: "progressive", title: "Lordship Is Progressive", content: "While the decision of lordship is made at salvation, the practice of lordship is a lifelong journey. Areas of life are surrendered one by one as the Spirit brings them into light.\n\nDo not be discouraged by areas not yet surrendered — be faithful in surrendering what He is showing you now. The goal is not perfect performance but progressive submission — a life increasingly oriented toward His will." },
        ],
        reflectionQuestions: [
          "What areas of your life are you most resistant to surrendering to Jesus as Lord? Why those areas specifically?",
          "What is the difference between having Jesus as your Savior and having Him as your Lord?",
        ],
        prayer: "Jesus, you are Lord — not just of the world, but of my life. I surrender what I have held back. Rule in every corner.",
        assignment: "Identify one area of your life where you have been 'managing' Jesus rather than submitting to Him. Write a specific, practical step of surrender for this week.",
      },
      {
        id: "m03l02", moduleId: "m03", num: 2,
        title: "Discipleship",
        memoryVerse: { text: "Whoever wants to be my disciple must deny themselves and take up their cross daily and follow me.", ref: "Luke 9:23" },
        estimatedMinutes: 16,
        sections: [
          { id: "what-disciple", title: "What Is a Disciple?", content: "A disciple (mathetes in Greek) is a learner-follower. In the ancient world, a disciple did not merely attend the rabbi's lectures — he followed the rabbi everywhere, observed his life, adopted his values, and aimed to become like him.\n\nJesus' disciples left their nets (Mark 1:18), their tax tables (Mark 2:14), and their families (Luke 5:11) to follow Him. Discipleship was total — not a hobby added to life, but a reorientation of life itself." },
          { id: "daily-cross", title: "Daily Cross-Carrying", content: "Jesus specified \"daily\" (Luke 9:23). Not once at conversion. Not occasionally when convenient. Daily. The cross is not a metaphor for inconvenience — it is an instrument of execution. To take up the cross is to die to the agenda of self and live for the agenda of Christ.\n\nThis happens not in dramatic moments alone but in ordinary daily choices: who you serve, how you speak, where you spend your time, what you love." },
          { id: "cost-and-reward", title: "Cost and Reward", content: "Jesus was remarkably honest about the cost of discipleship (Luke 14:25-33). He told would-be followers to count the cost before committing. He did not offer a comfortable life — He offered a meaningful one.\n\nBut the reward is extraordinary: finding your life by losing it (Matthew 16:25), inheriting eternal life (Mark 10:29-30), and knowing the joy of walking with Christ through every season." },
        ],
        reflectionQuestions: [
          "What has discipleship cost you personally in the last year?",
          "What does 'taking up your cross daily' look like in your specific, everyday life?",
        ],
        prayer: "Jesus, I choose to follow you today — not just in belief but in action. Let my life bear the marks of someone who walked with you.",
        assignment: "For seven days, begin each morning by asking: 'What does taking up my cross look like today?' Record your answers and bring them to your next session.",
      },
      {
        id: "m03l03", moduleId: "m03", num: 3,
        title: "The Kingdom of God",
        memoryVerse: { text: "Seek first his kingdom and his righteousness, and all these things will be given to you as well.", ref: "Matthew 6:33" },
        estimatedMinutes: 16,
        sections: [
          { id: "what-is-kingdom", title: "What Is the Kingdom of God?", content: "The Kingdom of God is the reign of God — wherever His will is done, His authority is acknowledged, and His purposes prevail. It is not primarily a place but a reality — God's sovereign rule breaking into the world through His people.\n\nJesus announced that the Kingdom had \"come near\" in His person (Mark 1:15). His miracles were not merely displays of power — they were signs that the Kingdom had arrived: the blind see, the lame walk, the dead are raised, and the poor hear good news (Matthew 11:4-5)." },
          { id: "now-and-not-yet", title: "Now and Not Yet", content: "The Kingdom is already here in part — the Spirit has been poured out, the Church is advancing, and lives are being transformed. But the Kingdom is not yet fully here — sin, suffering, injustice, and death remain.\n\nWe live in the overlap of the ages — the old age of sin and death is passing, and the new age of the Kingdom has broken in through Christ's resurrection. We participate now in what will be fully realized at His return." },
          { id: "kingdom-citizens", title: "Citizens of the Kingdom", content: "Kingdom citizens carry an alternative value system. In the Kingdom, the first are last, the servant is greatest, the poor in spirit are blessed, and the peacemakers are called children of God.\n\nThis means the Church does not merely save individuals — it embodies an alternative society where Kingdom values are lived. Your life in community with other believers is a demonstration of the Kingdom to the world watching." },
        ],
        reflectionQuestions: [
          "Where do you see the Kingdom of God breaking in around you — where is God's will being done?",
          "What Kingdom values do you find hardest to live by in your culture?",
        ],
        prayer: "Your Kingdom come, your will be done — in my life as in heaven. Let me be a sign of your Kingdom to everyone around me.",
        assignment: "Read the Beatitudes (Matthew 5:3-12) slowly. Choose one and write about what it would look like to embody that beatitude in your context this week.",
      },
      {
        id: "m03l04", moduleId: "m03", num: 4,
        title: "The Exaltation of Christ",
        memoryVerse: { text: "He is the head of the body, the church; he is the beginning and the firstborn from among the dead, so that in everything he might have the supremacy.", ref: "Colossians 1:18" },
        estimatedMinutes: 14,
        sections: [
          { id: "resurrection", title: "The Resurrection", content: "The resurrection of Jesus Christ is the hinge of history. If it did not happen, Christianity collapses (1 Corinthians 15:14). If it did happen, nothing in the universe is the same.\n\nChrist's resurrection is not resuscitation — not a return to mortal life. It is transformation into glorified, indestructible life. He is the firstborn from the dead (Colossians 1:18) — the first of a new humanity that death cannot hold." },
          { id: "ascension", title: "The Ascension", content: "After forty days, Jesus ascended to the right hand of the Father (Acts 1:9; Psalm 110:1). This is not a departure but a promotion. He ascended to rule. He is now the enthroned King of Kings, exercising universal authority.\n\nHis ascension enables the Spirit to be given to all believers (John 16:7). He is not absent — He is present by His Spirit everywhere His people are gathered." },
          { id: "intercession", title: "Our Interceding High Priest", content: "At the Father's right hand, Jesus serves as our High Priest — always alive to intercede for us (Hebrews 7:25). When you struggle, when you fail, when you are accused — Jesus is not watching in disappointment. He is interceding.\n\nThis is your greatest security: your standing before God is maintained not by your performance but by the ongoing intercession of the exalted Christ who is both your Savior and your Advocate." },
        ],
        reflectionQuestions: [
          "How does knowing Christ is currently enthroned and ruling change how you pray?",
          "What difference does it make to know that Jesus is always interceding for you?",
        ],
        prayer: "Exalted Lord, you are on the throne. Your rule is certain, your intercession is constant. I rest in your supremacy.",
        assignment: "Study Hebrews 4:14-16. Write about what it means to approach the throne of grace boldly, knowing Christ is your High Priest who sympathizes with your weakness.",
      },
      {
        id: "m03l05", moduleId: "m03", num: 5,
        title: "The Cost of Following Jesus",
        memoryVerse: { text: "Whoever does not carry their cross and follow me cannot be my disciple.", ref: "Luke 14:27" },
        estimatedMinutes: 15,
        sections: [
          { id: "honest-cost", title: "The Honest Cost", content: "Jesus never used marketing language. He told would-be followers to count the cost (Luke 14:28). The cost is real: relationships may break, ambitions may be redirected, comfort may be sacrificed, and in some parts of the world, your life may be at risk.\n\nTo pretend that following Jesus costs nothing is to recruit people into something they were never told they were joining. Jesus honored His followers by being honest with them." },
          { id: "paradox", title: "The Gospel Paradox", content: "The paradox of the gospel is this: the cost that feels like loss is actually the path to the fullest kind of life. You lose your life and find it. You surrender your agenda and receive a better one.\n\nJesus doesn't diminish you — He clarifies you. He strips away what was never truly yours, and what remains is imperishable. Every disciple who has walked this path reports the same: the cost was real and the reward exceeded all expectation." },
          { id: "community", title: "You Don't Walk Alone", content: "The cost of discipleship is borne together. Jesus did not send disciples out alone. He sent them in pairs (Mark 6:7). The early church sold possessions and gave to anyone in need (Acts 2:44-45) — they bore each other's costs.\n\nThe burden that would crush an individual can be carried by a community. This is why the peer-to-peer model matters — you have someone walking beside you through the cost." },
        ],
        reflectionQuestions: [
          "What has discipleship personally cost you? What did you receive in return that you did not expect?",
          "Is there an area where you have been counting the cost but have not yet made the decision to surrender it?",
        ],
        prayer: "Lord, I don't want a comfortable gospel. I want the real thing — the narrow road that leads to life. Strengthen me to walk it, and give me companions for the journey.",
        assignment: "Write out your testimony of what following Jesus has cost you and what you have received. Be specific and honest. You will share this with your peer guide.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 4: THE HOLY SPIRIT AND YOU
  // ─────────────────────────────────────────
  {
    id: "m04",
    num: 4,
    title: "The Holy Spirit and You",
    description: "Know the Holy Spirit personally — His baptism, filling, fruit, and gifts in your life.",
    lessons: [
      {
        id: "m04l01", moduleId: "m04", num: 1,
        title: "Pneumatology: Doctrine of the Holy Spirit",
        memoryVerse: { text: "But you will receive power when the Holy Spirit comes on you; and you will be my witnesses.", ref: "Acts 1:8" },
        estimatedMinutes: 14,
        sections: [
          { id: "who-is-hs", title: "Who Is the Holy Spirit?", content: "Pneumatology is the study of the Holy Spirit (pneuma = spirit in Greek). The Holy Spirit is the third Person of the Trinity — fully God, fully personal, and fully present in the life of every believer.\n\nHe is called the Paraclete (John 14:16) — meaning Helper, Advocate, Comforter, and Counselor. He is sent by the Father and the Son to be with believers forever, performing in them what neither can do for themselves." },
          { id: "ot-hs", title: "The Spirit in the Old Testament", content: "The Holy Spirit was active in the Old Testament — hovering over creation (Genesis 1:2), empowering judges, prophets, and kings for specific tasks. But His presence was selective and sometimes temporary.\n\nThe prophets foresaw a new covenant in which the Spirit would be poured out on all believers (Joel 2:28-29; Ezekiel 36:27). This is what Pentecost fulfilled — not something entirely new, but the fullness of what had always been promised." },
          { id: "nt-hs", title: "The Spirit in the New Covenant", content: "Under the New Covenant, every believer receives the Spirit at salvation (Romans 8:9; 1 Corinthians 12:13). This is not an elite experience for spiritual giants — it is the birthright of every child of God.\n\nThe Spirit is not a reward for obedience — He is the source of it. He enables the very life He calls us to live." },
        ],
        reflectionQuestions: [
          "Did you know the Holy Spirit personally dwells within you? How does knowing this change your self-understanding?",
          "What questions do you have about the Holy Spirit that you want to explore in this module?",
        ],
        prayer: "Holy Spirit, I welcome your presence. You are not a guest in my life — you live here. Teach me to cooperate with you rather than resist you.",
        assignment: "Read John 14:15-26 and 16:5-16. List every promise Jesus made about the Holy Spirit. Which promise most encourages you?",
      },
      {
        id: "m04l02", moduleId: "m04", num: 2,
        title: "Personhood of the Holy Spirit",
        memoryVerse: { text: "And do not grieve the Holy Spirit of God, with whom you were sealed for the day of redemption.", ref: "Ephesians 4:30" },
        estimatedMinutes: 14,
        sections: [
          { id: "personal", title: "He Is a Person", content: "The Holy Spirit is not an \"it.\" The New Testament consistently uses personal pronouns for Him. Jesus called Him \"another Advocate\" (John 14:16) — the same category as Jesus Himself, who is clearly a Person.\n\nHe has intellect — He searches the deep things of God (1 Corinthians 2:10). He has will — He distributes gifts as He determines (1 Corinthians 12:11). He has emotion — He can be grieved (Ephesians 4:30). These are the marks of personhood." },
          { id: "can-be-grieved", title: "He Can Be Grieved", content: "Ephesians 4:30 is one of the most profound verses in Scripture. It says the Holy Spirit — God Himself dwelling within you — can be grieved by your sin. He is not indifferent to your choices.\n\nThis is not condemnation — it is intimacy. Only those who love can grieve. The fact that He grieves shows how deeply He is involved in your life and how much He cares about your holiness." },
          { id: "can-be-quenched", title: "He Can Be Quenched", content: "Paul warns, \"Do not quench the Spirit\" (1 Thessalonians 5:19). To quench a flame is to put it out by covering it or depriving it of oxygen. We quench the Spirit by resisting His promptings, dismissing His convictions, or substituting our own plans for His.\n\nThe opposite of quenching is yielding — presenting yourself to the Spirit for His use, remaining sensitive to His voice, and acting on His promptings even when they are uncomfortable." },
        ],
        reflectionQuestions: [
          "Have you ever sensed the Holy Spirit prompting you? Did you respond or resist? What happened?",
          "What habits or patterns in your life might be grieving or quenching the Spirit?",
        ],
        prayer: "Holy Spirit, I don't want to grieve you or quench you. Reveal where I am resisting you and give me grace to yield.",
        assignment: "For three days, pause before making any significant decision and ask the Holy Spirit for guidance. Record what you notice.",
      },
      {
        id: "m04l03", moduleId: "m04", num: 3,
        title: "Deity of the Holy Spirit",
        memoryVerse: { text: "Don't you know that you yourselves are God's temple and that God's Spirit dwells in your midst?", ref: "1 Corinthians 3:16" },
        estimatedMinutes: 13,
        sections: [
          { id: "fully-god", title: "Fully God", content: "The Holy Spirit is not a lesser being, an angel, or an emanation of God. He is fully God — sharing the same divine essence as the Father and the Son.\n\nIn Acts 5:3-4, Peter equates lying to the Holy Spirit with lying to God. This identification is deliberate. The Spirit possesses the attributes of deity: omniscience (1 Corinthians 2:10-11), omnipresence (Psalm 139:7), omnipotence (Romans 8:11), and eternal existence (Hebrews 9:14)." },
          { id: "temple", title: "Your Body Is God's Temple", content: "Because the Spirit is fully God, Paul's statement that your body is His temple carries enormous weight (1 Corinthians 6:19-20). Not a temple of a spirit being — the temple of God.\n\nThis is the most dramatic statement in Scripture about human dignity. You — with all your flaws, struggles, and inconsistencies — are the dwelling place of the Most High God. This is not a metaphor. It is a literal, present spiritual reality." },
          { id: "implications", title: "What This Means for You", content: "Because God's Spirit lives in you, you have access to divine wisdom, divine power, divine comfort, and divine guidance at every moment. You are never alone. You are never resourceless. You never face a situation without heaven's presence within you.\n\nThis should change how you approach every day, every conversation, and every challenge. You carry the presence of God wherever you go." },
        ],
        reflectionQuestions: [
          "How does knowing your body is the temple of the Holy Spirit affect how you treat your body?",
          "What resources do you have access to because God's Spirit lives within you?",
        ],
        prayer: "Holy Spirit of God, you live in me. Help me treat myself with the reverence due to your dwelling place and live worthy of your presence.",
        assignment: "Research the Old Testament description of God's glory filling the tabernacle (Exodus 40:34-38). Then read 1 Corinthians 6:19-20. Write about the connection between these two texts.",
      },
      {
        id: "m04l04", moduleId: "m04", num: 4,
        title: "Baptism of the Spirit",
        memoryVerse: { text: "For we were all baptized by one Spirit so as to form one body — whether Jews or Gentiles, slave or free — and we were all given the one Spirit to drink.", ref: "1 Corinthians 12:13" },
        estimatedMinutes: 16,
        sections: [
          { id: "what-is-it", title: "What Is Spirit Baptism?", content: "Spirit baptism is the act by which the Holy Spirit unites every believer to Christ and to the body of Christ at the moment of salvation (1 Corinthians 12:13). It is not a second experience after salvation — it is part of salvation itself.\n\nJohn the Baptist promised that Jesus would baptize with the Holy Spirit (Matthew 3:11). This was fulfilled at Pentecost (Acts 2) and is applied to every believer at the moment they are born again." },
          { id: "all-believers", title: "It Happens to All Believers", content: "Note the completeness of 1 Corinthians 12:13: \"we were all baptized.\" Not the spiritual elite, not those with certain experiences, not those who spoke in tongues. All. Every person who belongs to Christ has been baptized by one Spirit into one body.\n\nThis is the common ground of all believers — we have all been united to Christ by the Spirit, regardless of our denominational tradition, spiritual experience, or maturity level." },
          { id: "fruit-of-baptism", title: "What Spirit Baptism Produces", content: "Spirit baptism produces unity — one body, one Spirit. It is the theological foundation for Christian unity. Before denominations, before traditions, before theological differences — there is the one Spirit who has united every believer to Christ.\n\nIt also inaugurates your access to all the Spirit's resources: His gifts, His fruit, His guidance, His power, and His intercession all become yours through the Spirit who has baptized you into Christ." },
        ],
        reflectionQuestions: [
          "How does knowing that every believer has been baptized by one Spirit change how you relate to other Christians?",
          "What questions or experiences do you have related to the Holy Spirit that this lesson addresses?",
        ],
        prayer: "Lord, I thank you that I am one body with every believer through your Spirit. Break down any wall that divides me from my brothers and sisters.",
        assignment: "Read 1 Corinthians 12:12-26 about the body and its members. Identify one part of the body (a believer with a different gift) that you need and one that needs you.",
      },
      {
        id: "m04l05", moduleId: "m04", num: 5,
        title: "Filling of the Spirit",
        memoryVerse: { text: "Be filled with the Spirit, speaking to one another with psalms, hymns, and songs from the Spirit.", ref: "Ephesians 5:18-19" },
        estimatedMinutes: 15,
        sections: [
          { id: "filling-vs-baptism", title: "Filling vs. Baptism", content: "Spirit baptism is a one-time event at salvation. Spirit filling is ongoing and repeatable. The command in Ephesians 5:18 is in the present tense, implying continuous action: \"Keep on being filled with the Spirit.\"\n\nYou can be filled, emptied through sin or neglect, and filled again. The Acts church experienced multiple fillings (Acts 2:4; 4:31). The filling is not about receiving more of the Spirit — the Spirit is already fully present. It is about the Spirit having more of you." },
          { id: "how-to-be-filled", title: "How to Be Filled", content: "The filling of the Spirit is not worked up emotionally or achieved by spiritual discipline alone. It comes through surrender and faith.\n\nPractically: confess and repent of known sin (which grieves and quenches the Spirit), yield every area of your life to His control, ask specifically to be filled (Luke 11:13), and then live by faith that He is filling you — not waiting for a feeling as confirmation." },
          { id: "evidence", title: "Evidence of Filling", content: "Ephesians 5:18-21 describes the evidence of Spirit-filling: speaking to one another in psalms and spiritual songs, giving thanks always for everything, and submitting to one another in love.\n\nNote that the evidence is largely relational and communal — not individualistic or spectacular. A Spirit-filled person is marked by gratitude, worship, and humility in relationships." },
        ],
        reflectionQuestions: [
          "Is there an area of your life you have not yet yielded to the Spirit's control? What would it take to release it?",
          "What does the Spirit-filled life look like practically in your daily interactions?",
        ],
        prayer: "Holy Spirit, fill me — every room, every corner, every area I have kept for myself. I yield control. You lead.",
        assignment: "Every morning this week, begin with this prayer: 'Holy Spirit, I yield myself to you today. Fill me and lead me.' Record how the day unfolds.",
      },
      {
        id: "m04l06", moduleId: "m04", num: 6,
        title: "The Spirit-Filled Life",
        memoryVerse: { text: "So I say, walk by the Spirit, and you will not gratify the desires of the flesh.", ref: "Galatians 5:16" },
        estimatedMinutes: 15,
        sections: [
          { id: "walking", title: "Walking By the Spirit", content: "\"Walk\" in Greek (peripateō) means to conduct one's life, to order one's behavior. Walking by the Spirit is not an occasional spiritual burst — it is a continuous way of living, step by step, in dependence on and cooperation with the Spirit.\n\nGalatians 5:16 makes a sweeping promise: if you walk by the Spirit, you will NOT gratify the desires of the flesh. Not maybe. Not usually. The Spirit-empowered walk is the most effective strategy against sin ever devised — because it is not a strategy, it is a relationship." },
          { id: "spirit-flesh", title: "Spirit vs. Flesh", content: "Paul describes two ways of living in Galatians 5 and Romans 8: according to the flesh and according to the Spirit. \"Flesh\" (sarx) is not the body — it is the self-directed life, the life oriented around one's own desires and away from God.\n\nThe flesh and the Spirit are in opposition (Galatians 5:17). They cannot coexist as lords. But the war is not even — the Spirit who lives in you is greater than the flesh you inherited from Adam (Romans 8:37)." },
          { id: "mind-set", title: "The Mind Set on the Spirit", content: "Romans 8:5-6 describes two mindsets: the mind set on the flesh and the mind set on the Spirit. The mind set on the Spirit is life and peace — not as a future reward but as a present reality.\n\nYour thought life is the battlefield. What you dwell on, what you meditate on, what you rehearse in your mind — these set the direction of your whole life. The Spirit-filled mind dwells on what is true, noble, right, pure, lovely, and admirable (Philippians 4:8)." },
        ],
        reflectionQuestions: [
          "What does 'walking by the Spirit' look like in your Monday morning rather than your Sunday morning?",
          "Where in your life is the mind set on the flesh rather than the Spirit? What would it take to shift it?",
        ],
        prayer: "Lord, I choose to walk by your Spirit today. When the flesh pulls, remind me of your power within me. Let every step be ordered by you.",
        assignment: "Read Romans 8:1-17 and Galatians 5:16-26. Make a two-column list: life according to the flesh vs. life according to the Spirit. Honestly evaluate which column better describes your current life.",
      },
      {
        id: "m04l07", moduleId: "m04", num: 7,
        title: "Fruit of the Spirit: Overview",
        memoryVerse: { text: "But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control.", ref: "Galatians 5:22-23" },
        estimatedMinutes: 14,
        sections: [
          { id: "fruit-not-fruits", title: "Fruit (Singular) Not Fruits", content: "Paul describes \"the fruit of the Spirit\" in the singular — not nine separate fruits to collect, but one multi-faceted fruit that grows as a whole. Just as an apple is one fruit with many qualities (color, taste, texture), the Spirit's fruit is one integrated expression of the Spirit's character.\n\nYou cannot pick and choose which aspects to develop. Love without self-control is sentimentality. Joy without peace is ecstasy without depth. The fruit grows together — as the Spirit works and you cooperate." },
          { id: "grown-not-manufactured", title: "Grown, Not Manufactured", content: "Fruit is grown, not manufactured. No tree strains to produce apples. The fruit is the natural result of the tree's nature, nourishment, and connection to the root.\n\nThe fruit of the Spirit is not the result of trying harder. It is the natural overflow of a life connected to the Vine (John 15:4-5). Abiding is the key. Discipline serves abiding — prayer, Scripture, community — but the fruit itself comes from union with Christ by His Spirit." },
          { id: "character-of-christ", title: "The Character of Christ", content: "These nine qualities are not a generic list of virtues. They are a portrait of Jesus Christ. He embodied love perfectly, demonstrated joy in all circumstances, carried peace that surpassed understanding, showed infinite patience, acted with consistent kindness, was absolutely good, proved faithful unto death, was gentle with the broken, and exercised perfect self-control.\n\nThe Spirit is forming Christ's character in you (Galatians 4:19). The fruit is not a self-improvement program — it is Christ being reproduced in His body." },
        ],
        reflectionQuestions: [
          "Which of the nine qualities of the fruit is most present in your life? Which is most absent?",
          "What does the metaphor of fruit help you understand about spiritual growth that a task list cannot?",
        ],
        prayer: "Spirit of God, produce your fruit in me. Not through straining but through abiding. I choose to stay connected to the Vine.",
        assignment: "For each of the nine qualities, identify one person in your life who most needs you to express that quality toward them. Choose one to act on this week.",
      },
      {
        id: "m04l08", moduleId: "m04", num: 8,
        title: "Fruit of the Spirit: Love, Joy, Peace, Patience, Kindness",
        memoryVerse: { text: "We love because he first loved us.", ref: "1 John 4:19" },
        estimatedMinutes: 18,
        sections: [
          { id: "love", title: "Love (Agape)", content: "Agape love is not an emotion — it is a decision and a direction. It is love that seeks the highest good of another regardless of feeling, convenience, or reciprocation. God IS agape (1 John 4:8) — so this fruit is the most fundamental expression of His character.\n\nAgape loves the unlovely, the enemy, the person who has hurt you. It is not natural — it is supernatural. Only the Spirit can produce it, because only God is its source." },
          { id: "joy", title: "Joy (Chara)", content: "Chara is the deep, settled gladness that comes from knowing God and being known by Him — independent of circumstances. Jesus had joy in the face of the cross (Hebrews 12:2). Paul wrote about joy from prison (Philippians 4:4).\n\nJoy is not happiness. Happiness depends on happenings. Joy depends on God. It can coexist with grief (2 Corinthians 6:10), hardship, and tears. It is the undercurrent, not the surface." },
          { id: "peace", title: "Peace (Eirene)", content: "Shalom — the Hebrew root — means completeness, wholeness, the absence of discord. The Spirit's peace is not merely the absence of conflict but the presence of wholeness.\n\nPhilippians 4:7 describes a peace that \"transcends all understanding\" — it doesn't make sense given the circumstances, but it guards the heart and mind. This is the peace Jesus promised: not as the world gives (John 14:27)." },
          { id: "patience-kindness", title: "Patience & Kindness", content: "Patience (makrothumia) is long-tempered — it is the ability to bear with people and circumstances over a long time without giving way to anger or despair. It is mercy extended across time.\n\nKindness (chrestotes) is practical goodness — expressed in concrete actions toward others. Jesus was moved with compassion and then acted. Kindness is compassion made tangible. It looks for opportunities to benefit others at cost to itself." },
        ],
        reflectionQuestions: [
          "Where in your relationships do you most need supernatural agape love — love that goes beyond feeling?",
          "When circumstances are difficult, what is the source of your joy? Is it circumstantial or Spirit-rooted?",
        ],
        prayer: "Lord, let your love, joy, peace, patience, and kindness become visible through me to everyone I encounter today.",
        assignment: "Choose one of the five qualities studied today. Identify a specific person and a specific way to express that quality toward them this week. Do it.",
      },
      {
        id: "m04l09", moduleId: "m04", num: 9,
        title: "Fruit of the Spirit: Goodness, Faithfulness, Gentleness, Self-Control",
        memoryVerse: { text: "Against such things there is no law.", ref: "Galatians 5:23" },
        estimatedMinutes: 16,
        sections: [
          { id: "goodness", title: "Goodness (Agathosune)", content: "Goodness is moral excellence expressed in active beneficence — not merely the absence of evil but the active doing of good. It includes the quality of righteous boldness — Jesus' cleansing of the temple was an act of goodness.\n\nGoodness may not always be gentle. It confronts injustice, speaks truth, and refuses to accommodate sin — always from a motive of genuine care for others' flourishing." },
          { id: "faithfulness", title: "Faithfulness (Pistis)", content: "Faithfulness means reliability — doing what you said you would do, being present when you promised to be present, following through consistently over time.\n\nIn a world of constant distraction and broken commitments, faithfulness is radical. It says: I will be here tomorrow. I will finish what I started. My word means something. This is the character of God toward us — His faithfulness endures forever (Lamentations 3:23) — reproduced in us by His Spirit." },
          { id: "gentleness-selfcontrol", title: "Gentleness & Self-Control", content: "Gentleness (prautes) is not weakness — Jesus described Himself as gentle and humble in heart (Matthew 11:29). Gentleness is strength under control — knowing your power but choosing to exercise it with care. It is the surgeon's precision with the scalpel, not the slash of a sword.\n\nSelf-control (enkrateia) is mastery over one's own impulses, desires, and appetites. Not suppression — transformation. The Spirit produces in us a freedom from the tyranny of our own passions, enabling us to act from conviction rather than compulsion." },
        ],
        reflectionQuestions: [
          "Faithfulness is expressed in small, daily commitments. What daily commitment are you most struggling to maintain?",
          "Where do you most need the Spirit to produce self-control in your life?",
        ],
        prayer: "Lord, make me good, faithful, gentle, and self-controlled — not through willpower but through your Spirit's work in me.",
        assignment: "Evaluate your faithfulness in one specific commitment this week. Did you do what you said you would? If not, what prevented you? What is one step toward greater faithfulness?",
      },
      {
        id: "m04l10", moduleId: "m04", num: 10,
        title: "Gifts of the Spirit: Overview",
        memoryVerse: { text: "Now to each one the manifestation of the Spirit is given for the common good.", ref: "1 Corinthians 12:7" },
        estimatedMinutes: 16,
        sections: [
          { id: "what-are-gifts", title: "What Are Spiritual Gifts?", content: "Spiritual gifts are supernatural abilities given by the Holy Spirit to believers for the building up of the body of Christ (1 Corinthians 12:7; Ephesians 4:12). They are not natural talents — though talents can be sanctified and used — but special equipment from the Spirit.\n\nEvery believer has at least one gift (1 Peter 4:10). Not some. Not the spiritually elite. Every member of the body has been equipped by the Spirit to contribute to the body's health and mission." },
          { id: "purpose", title: "Purpose of Gifts", content: "Gifts are given for the common good — not for personal status or individual fulfillment. Their purpose is to build up the body (Ephesians 4:12), to express love (1 Corinthians 13), and to extend the Kingdom (Ephesians 4:13).\n\nA gift exercised without love is just noise (1 Corinthians 13:1). The most spectacular gift, used for personal glory, is a misuse of the Spirit's provision." },
          { id: "lists", title: "The Lists of Gifts", content: "The New Testament gives several lists of gifts across different passages (Romans 12:6-8; 1 Corinthians 12:8-10; Ephesians 4:11; 1 Peter 4:10-11). These lists are not exhaustive — they are illustrative. Together they paint a picture of the Spirit's diverse provision for a diverse body.\n\nThe gifts include: prophecy, serving, teaching, encouragement, giving, leadership, mercy, apostleship, evangelism, pastoring, wisdom, knowledge, faith, healing, miracles, tongues, and interpretation." },
        ],
        reflectionQuestions: [
          "Do you know what your spiritual gifts are? If not, what might they be based on what you enjoy and where others have affirmed you?",
          "How are you currently using your gifts for the common good?",
        ],
        prayer: "Lord, show me the gifts you have placed in me and give me the courage and wisdom to use them to build up your body.",
        assignment: "Ask three people who know you well: 'What do you see as my spiritual gift?' Compare their answers with your own sense. Bring the findings to your next session.",
      },
      {
        id: "m04l11", moduleId: "m04", num: 11,
        title: "Gifts of the Spirit: Detailed",
        memoryVerse: { text: "Each of you should use whatever gift you have received to serve others, as faithful stewards of God's grace in its various forms.", ref: "1 Peter 4:10" },
        estimatedMinutes: 18,
        sections: [
          { id: "word-gifts", title: "Word Gifts", content: "Prophecy is supernaturally inspired communication that speaks to people for their strengthening, encouragement, and comfort (1 Corinthians 14:3). Teaching is the Spirit-anointed ability to explain and apply Scripture for transformation.\n\nTongues and interpretation allow communication across spiritual and possibly linguistic boundaries. Words of knowledge and wisdom provide supernatural insight for specific situations. These gifts serve the body when exercised in love and order." },
          { id: "serving-gifts", title: "Serving Gifts", content: "Helps and service (Romans 12:7; 1 Corinthians 12:28) is the Spirit-empowered ability to support and assist others, freeing them for ministry. Mercy is the supernatural capacity to feel with and minister to those in pain. Giving is the anointed ability to steward material resources generously for Kingdom purposes.\n\nThese gifts often go unnoticed — but they are indispensable. Without them, the body cannot function." },
          { id: "leadership-gifts", title: "Leadership & Faith", content: "Leadership (Romans 12:8) and administration (1 Corinthians 12:28) enable Spirit-led direction and organization of the body's ministry. Faith is not saving faith (all believers have that) but a supernatural measure of trust in God that inspires others and releases Kingdom activity.\n\nHealing and miracles are signs and wonders that authenticate the Gospel message and demonstrate the power of the Kingdom breaking in." },
        ],
        reflectionQuestions: [
          "Which of the gifts categories do you most naturally operate in? Word, serving, or leadership?",
          "Is there a gift you have never considered that someone else has identified in you?",
        ],
        prayer: "Holy Spirit, activate the gifts you have placed in me. Let me be a faithful steward of what you have given — for the body, not for myself.",
        assignment: "Choose one specific opportunity this week to use your spiritual gift for someone in your community. Report what happened at your next session.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 5: THE BIBLE — GOD'S WORD TO YOU
  // ─────────────────────────────────────────
  {
    id: "m05",
    num: 5,
    title: "The Bible — God's Word to You",
    description: "Understand what Scripture is, where it comes from, and how to read it faithfully.",
    lessons: [
      {
        id: "m05l01", moduleId: "m05", num: 1,
        title: "Bibliology: Doctrine of Scripture",
        memoryVerse: { text: "All Scripture is God-breathed and is useful for teaching, rebuking, correcting and training in righteousness.", ref: "2 Timothy 3:16" },
        estimatedMinutes: 15,
        sections: [
          { id: "definition", title: "What Is Bibliology?", content: "Bibliology is the study of the Bible itself — what it is, where it comes from, and why we trust it. Before we can study what the Bible says, we must understand what the Bible is.\n\nThe Bible is a collection of 66 books written by approximately 40 human authors over 1,500 years, in three languages (Hebrew, Aramaic, Greek), on three continents — yet displaying a unified story from creation to new creation, centered on Jesus Christ." },
          { id: "divine-human", title: "Divinely Human, Humanly Divine", content: "Scripture is simultaneously fully divine and fully human in its authorship — just as Jesus is both fully God and fully human. God used real human personalities, experiences, vocabularies, and styles to communicate exactly what He intended.\n\nThe human authors were not robots or dictating machines. Peter writes differently from Paul. Luke's Greek is elegant; Amos's imagery is pastoral. Yet what they wrote is what God intended, because the Spirit superintended the entire process." },
          { id: "trust", title: "Why We Trust It", content: "We trust the Bible because of its internal claims (2 Timothy 3:16; 2 Peter 1:21), its fulfilled prophecy (hundreds of specific predictions fulfilled in history), its historical reliability confirmed by archaeology, its survival through persecution, and above all — the testimony of Jesus Himself, who quoted Scripture as the final authority.\n\nIf Jesus trusted it, we can trust it." },
        ],
        reflectionQuestions: [
          "What doubts about the Bible's authority have you encountered or held? How does this lesson address them?",
          "How does knowing the Bible has both human and divine authorship help you read it?",
        ],
        prayer: "Lord, give me a deep trust in your Word. When doubts arise, anchor me in its truth.",
        assignment: "Read 2 Timothy 3:14-17 and 2 Peter 1:19-21. Write down the claims each passage makes about Scripture. Which claim most strengthens your confidence?",
      },
      {
        id: "m05l02", moduleId: "m05", num: 2,
        title: "Revelation: General and Special",
        memoryVerse: { text: "The heavens declare the glory of God; the skies proclaim the work of his hands.", ref: "Psalm 19:1" },
        estimatedMinutes: 14,
        sections: [
          { id: "general", title: "General Revelation", content: "General revelation is God's self-disclosure through creation, conscience, and human reason — available to all people everywhere. The created world speaks of God's power and divine nature (Romans 1:20). The human conscience witnesses to a moral law (Romans 2:14-15).\n\nGeneral revelation is sufficient to make humanity accountable before God but insufficient to bring saving knowledge. It tells us that God exists and that we are accountable — but not how to be reconciled to Him." },
          { id: "special", title: "Special Revelation", content: "Special revelation is God's self-disclosure through specific words, acts, and ultimately through His Son. The Old Testament prophets received specific revelation. The New Testament apostles received and recorded the revelation of Christ.\n\nSpecial revelation is necessary because general revelation does not tell us about redemption, about Christ, about grace, or about how we may know God personally. It takes the word of God, not merely the works of God, to bring us to salvation." },
          { id: "culmination", title: "Christ: The Final Word", content: "\"In the past God spoke to our ancestors through the prophets... but in these last days he has spoken to us by his Son\" (Hebrews 1:1-2). Jesus is the ultimate special revelation — the Word made flesh (John 1:14). He is the clearest, fullest, most personal expression of who God is and what God says.\n\nAll of Scripture points to Him. All special revelation finds its fulfillment in His person and work. The Bible is the written testimony to the living Word." },
        ],
        reflectionQuestions: [
          "Where have you encountered God through general revelation — in nature, in conscience, in human beauty?",
          "Why isn't general revelation enough? What does special revelation give us that creation cannot?",
        ],
        prayer: "Lord, I thank you for speaking — in creation, in Scripture, and ultimately in your Son. Let me hear your voice in all three.",
        assignment: "Spend 20 minutes in nature this week with no phone. Simply observe and ask: What is God revealing about Himself here? Write your reflections.",
      },
      {
        id: "m05l03", moduleId: "m05", num: 3,
        title: "Inspiration of Scripture",
        memoryVerse: { text: "For prophecy never had its origin in the human will, but prophets, though human, spoke from God as they were carried along by the Holy Spirit.", ref: "2 Peter 1:21" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is Inspiration?", content: "Biblical inspiration refers to the supernatural process by which God superintended the human authors of Scripture so that what they wrote was exactly what He intended — His very words in the words of men.\n\nThe Greek word in 2 Timothy 3:16 is theopneustos — God-breathed. This is not God breathing INTO Scripture (as if into something already written) but God breathing OUT Scripture — it comes from Him." },
          { id: "verbal-plenary", title: "Verbal Plenary Inspiration", content: "Verbal means every word (not just ideas or concepts). Plenary means the full extent — all of Scripture, not just the spiritually important parts. This is the view the Bible claims for itself and that Jesus affirmed.\n\nJesus said: \"Truly I tell you, until heaven and earth disappear, not the smallest letter, not the least stroke of a pen, will by any means disappear from the Law\" (Matthew 5:18). He treated every word as significant." },
          { id: "how-it-works", title: "How It Worked", content: "God used multiple modes of inspiration: direct dictation in some cases (the Ten Commandments), historical research (Luke 1:1-4), poetry and song (Psalms), visions and dreams (Daniel), letters written to specific churches (Paul's epistles).\n\nIn each case, the human author's personality, style, and situation were fully engaged. Yet God's supervision ensured that the final product was exactly His intended word. This is the mystery — fully human, fully divine." },
        ],
        reflectionQuestions: [
          "Does verbal plenary inspiration mean the Bible was dictated like a secretary taking notes? Why or why not?",
          "If every word of Scripture is God-breathed, how should that change how slowly and carefully you read it?",
        ],
        prayer: "Lord, as I read your Word, remind me that I am reading your very breath. Give me the reverence and attentiveness these words deserve.",
        assignment: "Choose one passage you have read many times. Read it again word by word — pausing at each significant word. Notice things you have never noticed before.",
      },
      {
        id: "m05l04", moduleId: "m05", num: 4,
        title: "Inerrancy of Scripture",
        memoryVerse: { text: "Your word is truth.", ref: "John 17:17" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is Inerrancy?", content: "Inerrancy is the doctrine that the Bible, in its original manuscripts, is without error in all that it affirms — historical, theological, ethical, and when it touches on science or geography.\n\nThis does not mean the Bible is exhaustive on every topic, or that it uses modern scientific language, or that translations are perfect. It means that what the original text was designed to teach and assert is accurate and true." },
          { id: "why-it-matters", title: "Why Inerrancy Matters", content: "If the Bible contains errors, which parts do we trust? The moment we make human reason the judge of which parts of Scripture are reliable, we have placed ourselves above the text — which is precisely what the Serpent invited Eve to do (Genesis 3:1).\n\nJesus treated the Old Testament as fully reliable (Matthew 5:17-18; John 10:35). If our Lord trusted it, and He is Lord, we must also trust it." },
          { id: "apparent-contradictions", title: "Apparent Contradictions", content: "There are apparent difficulties in Scripture — passages that seem to conflict with each other or with historical records. Inerrancy does not mean these difficulties don't exist; it means they have solutions we may not yet have found.\n\nMost alleged contradictions dissolve under careful study: different perspectives on the same event, different authors emphasizing different aspects, or apparent differences that reflect cultural contexts we don't fully understand." },
        ],
        reflectionQuestions: [
          "Have you encountered a passage that seemed contradictory or troubling? How did you handle it?",
          "What would change about your use of Scripture if you were not sure which parts were true?",
        ],
        prayer: "Lord, I trust your Word even where I don't fully understand it. Give me patience to wrestle with difficulty and humility to receive truth.",
        assignment: "Research one commonly cited 'contradiction' in Scripture. Use at least two scholarly resources. Write a brief explanation of how it can be resolved.",
      },
      {
        id: "m05l05", moduleId: "m05", num: 5,
        title: "Authority & Sufficiency of Scripture",
        memoryVerse: { text: "Heaven and earth will pass away, but my words will never pass away.", ref: "Matthew 24:35" },
        estimatedMinutes: 15,
        sections: [
          { id: "authority", title: "The Authority of Scripture", content: "Authority means the right to be believed and obeyed. Scripture's authority derives from its divine origin — it is God's word, and God's word carries God's authority.\n\nThis means the Bible stands over the Church — not under it. The Church does not determine what Scripture means; Scripture governs the Church. Tradition, experience, and reason are valuable but must be tested by and submitted to Scripture." },
          { id: "sufficiency", title: "The Sufficiency of Scripture", content: "Sufficiency means the Bible contains everything necessary for salvation and godliness. We do not need new revelation beyond what has been given. We do not need extra-biblical sources to know God, understand salvation, or live a holy life (2 Timothy 3:16-17).\n\nThis does not mean the Bible answers every question. It means the Bible provides sufficient guidance for living and for knowing God. The questions it does not address directly are to be navigated by wisdom derived from the principles it does address." },
          { id: "sola-scriptura", title: "Scripture Alone", content: "The Reformation principle of Sola Scriptura (Scripture alone) does not mean the Bible is the only authority Christians recognize — it means Scripture is the supreme and final authority by which all others are measured.\n\nExperience is real and important. Tradition has wisdom. Reason is a gift. But none of them stand over Scripture. When experience contradicts Scripture, we interpret the experience. When tradition departs from Scripture, we reform the tradition." },
        ],
        reflectionQuestions: [
          "Is there an area of your life where you have allowed tradition, experience, or culture to override what Scripture teaches?",
          "What does it mean practically to treat the Bible as sufficient — as containing what you need?",
        ],
        prayer: "Lord, let your Word be the final word in my life — over my feelings, my culture, my traditions. Help me to build my life on its foundation.",
        assignment: "Identify one area of your life (finances, relationships, ambitions) and find what Scripture directly and indirectly says about it. How does the teaching apply?",
      },
      {
        id: "m05l06", moduleId: "m05", num: 6,
        title: "Illumination & Scripture Terminology",
        memoryVerse: { text: "The unfolding of your words gives light; it gives understanding to the simple.", ref: "Psalm 119:130" },
        estimatedMinutes: 14,
        sections: [
          { id: "illumination", title: "What Is Illumination?", content: "Illumination is the work of the Holy Spirit enabling believers to understand, receive, and apply the truth of Scripture. It is distinct from inspiration (which happened once, in the writing) — illumination happens every time a believer opens the Word with faith.\n\n\"The person without the Spirit does not accept the things that come from the Spirit of God\" (1 Corinthians 2:14). The natural mind cannot grasp spiritual truth without the Spirit's illumination." },
          { id: "terms", title: "Key Scripture Terminology", content: "Canon: the collection of books recognized as authoritative Scripture (66 books in the Protestant Bible). Manuscript: an ancient handwritten copy of Scripture. Textual criticism: the scholarly discipline of comparing manuscripts to reconstruct the original text.\n\nOld Testament: the 39 books of the Hebrew Bible, completed approximately 400 BC. New Testament: the 27 books written by apostles or their associates, completed by approximately AD 100." },
          { id: "genres", title: "Literary Genres in Scripture", content: "The Bible contains multiple literary genres, and each is read differently: Law (legal instruction), History (narrative accounts), Poetry (Psalms, Proverbs), Prophecy (predictive and proclamatory), Apocalyptic (symbolic visions), Gospel (narrative biography of Jesus), Epistle (letters to churches and individuals).\n\nReading a poem as if it were a legal text, or a prophecy as if it were a historical narrative, leads to misinterpretation. Genre awareness is essential to faithful reading." },
        ],
        reflectionQuestions: [
          "Before you read Scripture, do you ask the Holy Spirit to illuminate it? How does that practice affect your reading?",
          "Have you ever misread a biblical text because you did not understand its genre? What happened?",
        ],
        prayer: "Holy Spirit, open my eyes to see wonderful things in your law (Psalm 119:18). I cannot understand spiritual truth without you. Illuminate every passage I read.",
        assignment: "Read one psalm, one proverb, and one epistle passage this week. Note how you read each differently because of its genre.",
      },
      {
        id: "m05l07", moduleId: "m05", num: 7,
        title: "Translation, Interpretation & Application",
        memoryVerse: { text: "Do your best to present yourself to God as one approved, a worker who does not need to be ashamed and who correctly handles the word of truth.", ref: "2 Timothy 2:15" },
        estimatedMinutes: 16,
        sections: [
          { id: "translation", title: "Bible Translations", content: "The Old Testament was written primarily in Hebrew and the New Testament in Greek. No one reads the original manuscripts — we all read translations. Translations exist on a spectrum from word-for-word (formal equivalence: ESV, NASB, KJV) to thought-for-thought (dynamic equivalence: NIV, NLT, GNT).\n\nNo translation is perfect. Using multiple translations for study enriches understanding. A word-for-word translation for study; a thought-for-thought translation for reading are common recommendations." },
          { id: "interpretation", title: "Interpretation (Hermeneutics)", content: "Hermeneutics is the science of interpretation. The goal is to find the original, intended meaning of the text — what the author meant to communicate to the original audience.\n\nThe golden rule of interpretation: when the plain sense makes sense, seek no other sense. Most passages mean what they appear to mean. Context (the surrounding passage, the book, the whole Bible) is everything." },
          { id: "application", title: "Application (Exegesis to Life)", content: "After interpreting what a text meant to its original audience (exegesis), the bridge to application asks: what abiding principle is at work here, and how does it apply to my life and situation today?\n\nApplication without interpretation is dangerous (taking a text out of context to support a pre-decided conclusion). Interpretation without application is academic (knowing what the text means without letting it change your life). Both are necessary." },
        ],
        reflectionQuestions: [
          "What translation do you primarily use? Have you ever compared translations on a challenging passage?",
          "Can you think of a time when a Scripture was applied without proper interpretation — and what harm or distortion resulted?",
        ],
        prayer: "Lord, make me a faithful handler of your Word — not twisting it to say what I want, but humbly receiving what you mean.",
        assignment: "Take one passage (e.g., Jeremiah 29:11). Using three different translations, read the context (Jeremiah 28-29), identify the original audience and situation, then write how the principle applies to your life today.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 6: PRAYER — TALKING WITH GOD
  // ─────────────────────────────────────────
  {
    id: "m06",
    num: 6,
    title: "Prayer — Talking With God",
    description: "Develop a vibrant, real prayer life through understanding and practice.",
    lessons: [
      {
        id: "m06l01", moduleId: "m06", num: 1,
        title: "Prayer Definition & ACTS Overview",
        memoryVerse: { text: "Pray in the Spirit on all occasions with all kinds of prayers and requests.", ref: "Ephesians 6:18" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is Prayer?", content: "Prayer (proseuche in Greek) is direct communication with God — the Creator of the universe personally hearing and responding to His children. It is not a technique, a ritual, or a religious duty — it is a relationship expressed in conversation.\n\nPrayer is not merely asking for things. It is a full-spectrum relationship with God that includes praise, confession, gratitude, intercession, and listening. The model Jesus gave His disciples — the Lord's Prayer — covers all these dimensions." },
          { id: "acts", title: "The ACTS Framework", content: "The ACTS acronym provides a helpful structure for balanced prayer:\n\nA — Adoration: Praising God for who He is, not what He has done\nC — Confession: Acknowledging specific sins and receiving forgiveness\nT — Thanksgiving: Expressing gratitude for what God has done\nS — Supplication: Making requests for yourself and others\n\nThis is not a formula but a compass — it ensures prayer doesn't become only a wish list but a full conversation." },
          { id: "why-pray", title: "Why Do We Pray?", content: "If God is sovereign and knows everything, why pray? Because prayer is not about changing God's mind — it is about aligning our hearts with His will and participating in what He is doing.\n\nJames 4:2 says: \"you do not have because you do not ask.\" God has chosen to work through the prayers of His people. The prayer doesn't override His sovereignty — it participates in it. Prayer is how God involves His people in the advancement of His Kingdom." },
        ],
        reflectionQuestions: [
          "What does your current prayer life mostly consist of — adoration, confession, thanksgiving, or supplication?",
          "Is prayer a conversation or a monologue for you? What would it take to make it more of a dialogue?",
        ],
        prayer: "Lord, teach me to pray. Not just to recite words, but to truly meet with you — to speak and to listen. Deepen my prayer life.",
        assignment: "Use the ACTS framework for prayer every morning this week. Spend at least 2-3 minutes in each category. Note how it changes the character of your prayer.",
      },
      {
        id: "m06l02", moduleId: "m06", num: 2,
        title: "Adoration",
        memoryVerse: { text: "Exalt the Lord our God and worship at his footstool; he is holy.", ref: "Psalm 99:5" },
        estimatedMinutes: 13,
        sections: [
          { id: "what-is-adoration", title: "What Is Adoration?", content: "Adoration is praising God for who He is — His character, His nature, His attributes — completely apart from what He has done for you. It is the highest and least self-centered form of prayer.\n\nMost of us begin prayer with requests. Adoration begins with God. It reorients the soul before a word of petition is spoken. When we truly contemplate who He is, our requests come into proper perspective." },
          { id: "practices", title: "How to Practice Adoration", content: "Use the names of God as prompts: Yahweh Jireh (The LORD My Provider), Yahweh Rapha (The LORD My Healer), El Shaddai (God Almighty), Elohim (Creator God). Each name reveals an aspect of His character worth dwelling on.\n\nUse Scripture to prompt adoration: read a psalm of praise back to God. Psalm 145 is entirely adoration — a description of God's greatness that becomes worship when prayed aloud." },
          { id: "transformation", title: "How Adoration Transforms You", content: "Genuine adoration of God has a transforming effect on the one who prays. When you behold God's greatness, your problems grow smaller without shrinking. When you contemplate His love, fear is displaced. When you praise His faithfulness, anxiety loses its grip.\n\nPaul commands us to fix our minds on what is true, noble, and right (Philippians 4:8) — adoration trains the mind to do exactly this. It is worship as cognitive renewal." },
        ],
        reflectionQuestions: [
          "When you pray, how much time do you spend in pure adoration compared to making requests?",
          "What attribute of God most moves you to worship right now?",
        ],
        prayer: "I worship you, Lord — not for what you give but for who you are. You are holy, loving, faithful, powerful, and good. I magnify your name.",
        assignment: "This week, begin every prayer time with five minutes of pure adoration before making any request. Use one psalm as a guide each day.",
      },
      {
        id: "m06l03", moduleId: "m06", num: 3,
        title: "Confession",
        memoryVerse: { text: "If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.", ref: "1 John 1:9" },
        estimatedMinutes: 13,
        sections: [
          { id: "what-is-confession", title: "What Is Confession?", content: "Confession (homologeo in Greek) means to say the same thing — to agree with God about your sin. It is not groveling, not self-punishment, and not performance. It is honest agreement with the verdict God has already pronounced.\n\nConfession does not restore God's love — you never lose that. It restores the experience of fellowship and the flow of grace that is hindered by unacknowledged sin (Psalm 66:18)." },
          { id: "specific-vs-general", title: "Specific vs. General Confession", content: "\"Forgive me for my sins\" is a general confession. \"Forgive me for snapping in anger at my wife this morning when she didn't meet my expectation\" is specific confession.\n\nSpecific confession requires honesty, self-examination, and courage. But it is far more effective than general confession for two reasons: it prevents self-deception about the nature and extent of your sin, and it opens the door to specific repentance and specific change." },
          { id: "after-confession", title: "What Happens After Confession", content: "After genuine confession, 1 John 1:9 promises two things: forgiveness (the guilt is removed) and cleansing (the defilement is purified). Both are immediate and complete.\n\nDo not confess and then continue to carry guilt. That is not faith — it is unbelief masquerading as humility. Receive what God has promised. The cross paid for the sin you just confessed. To remain in guilt is to act as if the cross was insufficient." },
        ],
        reflectionQuestions: [
          "Is there anything you have been avoiding confessing to God? What makes it difficult to bring it to Him?",
          "How do you feel after genuine confession? Has confession ever brought you a sense of freedom and renewed fellowship?",
        ],
        prayer: "Lord, I confess [name specific sin]. Thank you that your blood covers this. I receive your forgiveness and your cleansing, and I choose to walk differently.",
        assignment: "Spend 10 minutes this week in quiet self-examination. Ask the Spirit to reveal anything in your heart that needs to be confessed. Confess it specifically and receive 1 John 1:9 by faith.",
      },
      {
        id: "m06l04", moduleId: "m06", num: 4,
        title: "Thanksgiving",
        memoryVerse: { text: "Give thanks in all circumstances; for this is God's will for you in Christ Jesus.", ref: "1 Thessalonians 5:18" },
        estimatedMinutes: 12,
        sections: [
          { id: "distinction", title: "Thanksgiving vs. Adoration", content: "Adoration praises God for who He is. Thanksgiving thanks God for what He has done. Both are essential. Thanksgiving keeps us from taking God's gifts for granted and cultivates the awareness that every good thing flows from His generosity.\n\nThe ten lepers healed by Jesus (Luke 17:11-19) — only one returned to give thanks. Jesus noticed. Gratitude is not optional — it is the appropriate response to grace received." },
          { id: "all-circumstances", title: "Thanksgiving in All Circumstances", content: "1 Thessalonians 5:18 commands thanksgiving \"in all circumstances\" — not for all circumstances. God is not asking us to be thankful that suffering exists, but to find reasons for gratitude even within suffering.\n\nPaul and Silas sang hymns at midnight in a Philippian prison (Acts 16:25). This is not denial — it is defiant gratitude, the conviction that God is good and at work even when circumstances seem to say otherwise." },
          { id: "gratitude-practice", title: "Building a Gratitude Practice", content: "Gratitude is a discipline before it becomes a disposition. It must be practiced until it becomes natural.\n\nThe practice: make a daily list of specific things you are grateful for. Not abstract (\"I'm thankful for family\") but concrete (\"I'm thankful that my daughter called me today\"). Specificity fuels genuine gratitude. Over time, a gratitude practice rewires how you see the world — you begin to see grace everywhere." },
        ],
        reflectionQuestions: [
          "What is something you have been taking for granted that deserves your genuine thanks?",
          "How does gratitude change the way you experience difficult circumstances?",
        ],
        prayer: "Lord, I thank you for [name three specific things]. Open my eyes to see your gifts everywhere — in the ordinary and the extraordinary.",
        assignment: "Keep a gratitude journal for seven days. Write three specific things each day that you are thankful for. At the end of the week, read the list aloud to God.",
      },
      {
        id: "m06l05", moduleId: "m06", num: 5,
        title: "Supplication, Intercession & The Lord's Prayer",
        memoryVerse: { text: "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.", ref: "Philippians 4:6" },
        estimatedMinutes: 16,
        sections: [
          { id: "supplication", title: "Supplication: Asking for Yourself", content: "Supplication is asking God for what you need. Jesus invited bold, persistent asking: \"Ask and it will be given to you; seek and you will find; knock and the door will be opened\" (Matthew 7:7). The verbs in Greek are present continuous — keep asking, keep seeking, keep knocking.\n\nBring everything to God — your physical needs, your emotional struggles, your relationships, your fears. Nothing is too small for the Father who counts the hairs on your head." },
          { id: "intercession", title: "Intercession: Standing in the Gap", content: "Intercession is praying for others. It is standing between God and a person or situation, pleading for God's mercy, provision, and intervention. Abraham interceded for Sodom (Genesis 18). Moses interceded for Israel (Exodus 32). Jesus always lives to intercede for us (Hebrews 7:25).\n\nThe intercessor stands in the gap — in the space between what is and what should be — and prays until the gap is closed. This is one of the most significant things a disciple can do for another person." },
          { id: "lords-prayer", title: "The Lord's Prayer as Template", content: "The Lord's Prayer (Matthew 6:9-13) is not a formula to recite but a template to structure our praying:\n\n\"Our Father in heaven\" — come to God as Father, with confidence.\n\"Hallowed be your name\" — begin with adoration.\n\"Your kingdom come, your will be done\" — align with His agenda.\n\"Give us today our daily bread\" — present your practical needs.\n\"Forgive us our debts as we forgive\" — confession and relational restoration.\n\"Lead us not into temptation\" — spiritual protection.\n\"Yours is the kingdom\" — end in praise." },
        ],
        reflectionQuestions: [
          "What is one situation you have been anxious about that you have not yet brought to God in prayer?",
          "Who is one person you should be regularly interceding for? What would you pray for them?",
        ],
        prayer: "Our Father in heaven, hallowed be your name. I bring you my needs and the needs of those I love. Your kingdom come in every situation I lay before you.",
        assignment: "Using the Lord's Prayer as a template, write out a full prayer that follows each element. Pray it daily for one week.",
      },
      {
        id: "m06l06", moduleId: "m06", num: 6,
        title: "Prayer Postures & Unanswered Prayer",
        memoryVerse: { text: "When you pray, go into your room, close the door and pray to your Father, who is unseen.", ref: "Matthew 6:6" },
        estimatedMinutes: 14,
        sections: [
          { id: "postures", title: "Prayer Postures", content: "The Bible describes many postures for prayer: kneeling (Ephesians 3:14), standing (Mark 11:25), falling face down (Matthew 26:39), raising hands (1 Timothy 2:8), and eyes open or closed. No posture is uniquely required — the posture should express the heart.\n\nKneeling expresses humility. Standing expresses confidence before God. Falling prostrate expresses awe and surrender. Raising hands expresses openness and surrender. Engage your body in prayer — it matters." },
          { id: "unanswered", title: "When Prayer Seems Unanswered", content: "Unanswered prayer is one of the greatest challenges to faith. God's responses are: Yes (request granted), No (request denied for good reason), Wait (not yet, but the answer is coming), and Something better.\n\nJames 4:3 gives one reason prayers are not answered: wrong motives — asking for what will serve selfish pleasure rather than Kingdom purposes. The solution is aligning our requests with God's will (1 John 5:14-15)." },
          { id: "perseverance", title: "Praying with Perseverance", content: "Jesus told the parable of the persistent widow (Luke 18:1-8) specifically \"to show them that they should always pray and not give up.\" Perseverance in prayer is not twisting God's arm — it is evidence that we truly believe He hears and answers.\n\nPaul asked God three times to remove his thorn in the flesh (2 Corinthians 12:7-9). God said no — and Paul came to understand that the no was itself a grace that drove him to greater dependence on Christ." },
        ],
        reflectionQuestions: [
          "Is there a prayer you have been praying for a long time without a clear answer? How do you maintain faith in that waiting?",
          "Are there any requests you pray that you suspect are motivated more by selfish desire than Kingdom purpose?",
        ],
        prayer: "Lord, I trust your answers — yes, no, and wait. Help me to pray aligned with your will and to persevere when the answer is delayed.",
        assignment: "Make a list of three prayers you have been praying. For each, honestly evaluate: Is this a Kingdom request or a personal comfort request? Is my motive pure?",
      },
      {
        id: "m06l07", moduleId: "m06", num: 7,
        title: "Prayer as Relationship & Developing a Prayer Life",
        memoryVerse: { text: "Devote yourselves to prayer, being watchful and thankful.", ref: "Colossians 4:2" },
        estimatedMinutes: 15,
        sections: [
          { id: "relationship", title: "Prayer Is a Relationship", content: "The greatest shift in prayer happens when you stop thinking of it as a religious duty and start experiencing it as a relationship. You don't pray to a theological concept — you talk to a Person who loves you, listens to you, and responds.\n\nBrother Lawrence, the 17th-century monk, described \"practicing the presence of God\" — a continuous awareness of God's presence and an ongoing conversation throughout the day, not just in designated prayer times. This is the ideal." },
          { id: "building-life", title: "Building a Prayer Life", content: "A prayer life is built like any other significant habit — intentionally, consistently, starting small.\n\nStart with a fixed time: same place, same time every day. Five minutes of real prayer beats an hour of distracted obligation. Use a journal to capture what you pray and what you sense God saying. Vary your methods: sometimes walk and pray, sometimes kneel, sometimes sing.\n\nProtect your prayer time fiercely. The enemy's most effective strategy is to crowd it out with busyness." },
          { id: "corporate-prayer", title: "Corporate Prayer", content: "Individual prayer is essential. Corporate prayer — praying with others — is also essential and has a different power. Jesus promised that where two or three gather in His name, He is present (Matthew 18:20). The early church was a praying community (Acts 1:14; 2:42; 4:24-31).\n\nThe peer-to-peer model includes prayer at the start and end of every session. These moments of shared prayer are not ritual — they are the engine that drives everything else." },
        ],
        reflectionQuestions: [
          "What is the most significant barrier to a consistent prayer life for you personally?",
          "What would it look like to \"practice the presence of God\" in your daily life — not just in dedicated prayer times?",
        ],
        prayer: "Lord, I want to talk with you — not just to you. Build in me a prayer life that transforms how I see every moment of every day.",
        assignment: "Design your personal prayer rule: specific time, specific place, specific structure. Practice it every day for two weeks. Report to your peer guide at each session.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 7: THE CHURCH — YOUR NEW FAMILY
  // ─────────────────────────────────────────
  {
    id: "m07",
    num: 7,
    title: "The Church — Your New Family",
    description: "Discover what the Church is, how it functions, and your role within it.",
    lessons: [
      {
        id: "m07l01", moduleId: "m07", num: 1, title: "Ecclesiology: Doctrine of the Church",
        memoryVerse: { text: "And I tell you that you are Peter, and on this rock I will build my church, and the gates of Hades will not overcome it.", ref: "Matthew 16:18" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is the Church?", content: "Ecclesiology is the study of the Church (ekklesia = called-out assembly). The Church is not a building, a denomination, or an event on Sunday morning. It is the community of all who have been regenerated by the Spirit, united to Christ, and to each other.\n\nJesus said He would BUILD His Church. It is His — not ours. He is the builder, the head, and the one who sustains it. The gates of hell will not overcome it — because He is its foundation." },
          { id: "origin", title: "The Church's Origin", content: "The Church was born at Pentecost (Acts 2) when the Spirit was poured out on the assembled disciples. But it was planned before the foundation of the world (Ephesians 1:4) and foreshadowed in the Old Testament community of Israel.\n\nIt was the mystery hidden for ages and now revealed: that Jews and Gentiles together, in one body, would be the community of the King (Ephesians 3:6)." },
          { id: "purpose", title: "The Church's Purpose", content: "The Church exists for three primary purposes:\n\n1. Worship — glorifying God (Revelation 4-5; Hebrews 13:15)\n2. Edification — building up believers in love (Ephesians 4:16)\n3. Mission — extending the Kingdom to the nations (Matthew 28:18-20)\n\nA church that only worships without building up its members is incomplete. A church that only focuses inward without mission has lost its reason to exist." },
        ],
        reflectionQuestions: [
          "How do you understand 'church' differently now than you did before becoming a believer?",
          "Which of the three purposes of the Church (worship, edification, mission) is most alive in your current church community?",
        ],
        prayer: "Lord, build your Church through me. Let me be a member of your body who builds up rather than tears down.",
        assignment: "Interview two people from your church community: one who has been a member for 10+ years and one who is relatively new. Ask both: 'What is the Church to you?' Compare their answers.",
      },
      {
        id: "m07l02", moduleId: "m07", num: 2, title: "The Universal Church",
        memoryVerse: { text: "There is one body and one Spirit, just as you were called to one hope when you were called; one Lord, one faith, one baptism.", ref: "Ephesians 4:4-5" },
        estimatedMinutes: 13,
        sections: [
          { id: "what-is-it", title: "What Is the Universal Church?", content: "The Universal (Catholic, meaning 'whole') Church is the totality of all true believers across all time, all nations, and all denominations. It is the Body of Christ in its fullness — invisible to human eyes but fully visible to God.\n\nIt includes believers now in heaven, believers throughout history, and believers alive today across every tradition that holds to the Gospel of Christ." },
          { id: "unity", title: "One Body, One Spirit", content: "Ephesians 4:4-7 lists seven \"ones\" that constitute the unity of the universal Church: one body, one Spirit, one hope, one Lord, one faith, one baptism, one God and Father of all.\n\nThis is the non-negotiable unity — not organizational uniformity, not identical practices, but shared identity in Christ. Denominational differences are real; this deeper unity is more real." },
          { id: "diversity", title: "Unity in Diversity", content: "The Universal Church spans every culture, language, and ethnicity — it is the most diverse community in history. Revelation 7:9 gives us a glimpse: \"a great multitude that no one could count, from every nation, tribe, people and language, standing before the throne.\"\n\nThis diversity is not a problem to overcome — it is the beauty of the Kingdom on display. The peer-to-peer network participates in this global reality: you are connected to brothers and sisters in every corner of the earth." },
        ],
        reflectionQuestions: [
          "How does knowing you are part of the Universal Church — a global family spanning history — change how you see yourself?",
          "How should the unity of the Universal Church affect how we treat believers from different denominations?",
        ],
        prayer: "Lord, I thank you for the global family you have placed me in. Help me honor the unity we share in Christ across every barrier.",
        assignment: "This week, reach out to someone from a different cultural background or denomination than your own and share what you are learning in this curriculum. Notice what you have in common.",
      },
      {
        id: "m07l03", moduleId: "m07", num: 3, title: "The Local Church",
        memoryVerse: { text: "Let us not give up meeting together, as some are in the habit of doing, but encouraging one another — and all the more as you see the Day approaching.", ref: "Hebrews 10:25" },
        estimatedMinutes: 14,
        sections: [
          { id: "necessity", title: "Why the Local Church Matters", content: "The universal Church is real but abstract. The local church is where the abstract becomes concrete — where you know people's names, carry each other's burdens, observe the Lord's Supper together, and practice the one-anothers of Scripture.\n\nThe New Testament knows nothing of the \"solo Christian\" — a believer who follows Christ but is not meaningfully committed to a local body. Every letter of Paul is addressed to a local church or its members. The Christian life was designed for community." },
          { id: "commitment", title: "Committed, Not Just Connected", content: "Many believers are \"connected\" to a church — they attend when convenient, give occasionally, and leave when offended. Commitment is different: it means staying, serving, contributing, and being accountable even when it is costly.\n\nCommitted community is where the real work of sanctification happens. The annoying people in your church are often God's primary instruments for forming patience, forgiveness, and love in you. You cannot grow into the fullness of Christ in isolation." },
          { id: "marks", title: "Marks of a Healthy Local Church", content: "The Reformation identified two marks of a true church: the Word rightly preached and the sacraments rightly administered. Some add a third: church discipline rightly practiced.\n\nA healthy local church will be marked by faithful Bible teaching, genuine community, active mission, meaningful worship, care for the vulnerable, and the practice of accountability." },
        ],
        reflectionQuestions: [
          "Are you connected to a local church or genuinely committed to one? What is the difference in your case?",
          "What would it take for you to become more deeply committed to your local church community?",
        ],
        prayer: "Lord, root me in a local community. Help me to give more than I receive, to stay when it's hard, and to love the people you have placed me with.",
        assignment: "Identify one way you are currently contributing to your local church and one way you could contribute more. Share this with your peer guide.",
      },
      {
        id: "m07l04", moduleId: "m07", num: 4, title: "Church Membership",
        memoryVerse: { text: "Now you are the body of Christ, and each one of you is a part of it.", ref: "1 Corinthians 12:27" },
        estimatedMinutes: 13,
        sections: [
          { id: "what-is-it", title: "What Is Church Membership?", content: "Church membership is the formal commitment of a believer to a specific local congregation — and the congregation's commitment to that believer. It is the covenant that makes community possible.\n\nThe New Testament does not use the word 'membership' directly, but the practices it describes assume it: church discipline (Matthew 18:15-20), accountability (Hebrews 13:17), and mutual care all require an identified community of committed people." },
          { id: "mutual-accountability", title: "Membership and Accountability", content: "Membership means submitting to the community's pastoral care and accountability. It is the context in which Matthew 18 discipline becomes possible. You cannot remove someone from a community they are not formally part of.\n\nThis accountability is not oppressive — it is the loving structure that enables deep community. Friends who hold you accountable are a gift. A community with no structure cannot offer real accountability." },
          { id: "rights-and-responsibilities", title: "Rights and Responsibilities", content: "Church membership carries both rights and responsibilities. Rights: pastoral care, the Lord's Supper, the community's prayers, and a voice in significant decisions. Responsibilities: regular attendance, financial contribution, service, and submission to leadership.\n\nMembership is not a VIP club — it is a covenant of mutual care and commitment, modeled on the covenant love of God for His people." },
        ],
        reflectionQuestions: [
          "Are you a member of a local church? If not, what has prevented you from formalizing that commitment?",
          "What does it mean to you personally that the church is committed to you, not just that you are committed to it?",
        ],
        prayer: "Lord, give me the courage to commit. Help me stop being a consumer of church and start being a contributor — fully in, fully committed.",
        assignment: "If you are not currently a church member, research the membership process at a local church you trust. Take one concrete step toward formalizing your commitment.",
      },
      {
        id: "m07l05", moduleId: "m07", num: 5, title: "Church Leadership: Elders, Pastors & Overseers",
        memoryVerse: { text: "Have confidence in your leaders and submit to their authority, because they keep watch over you as those who must give an account.", ref: "Hebrews 13:17" },
        estimatedMinutes: 14,
        sections: [
          { id: "three-terms", title: "Three Terms, One Office", content: "The New Testament uses three terms for the same leadership role: elder (presbuteros — signifying maturity and dignity), overseer/bishop (episkopos — signifying function, oversight and care), and pastor/shepherd (poimen — signifying the pastoral relationship). These are not three separate offices but three facets of the same office.\n\nElders lead the local church — they govern, teach, and shepherd the congregation under the authority of Christ." },
          { id: "qualifications", title: "Qualifications", content: "1 Timothy 3:1-7 and Titus 1:5-9 list the qualifications for elders. Notably, most qualifications are character qualities, not skills: above reproach, faithful to his spouse, temperate, self-controlled, respectable, hospitable, not given to drunkenness, not violent, not quarrelsome, not a lover of money, managing his own family well, not a recent convert, having a good reputation with outsiders.\n\nThe elder must also be able to teach (didaktikos) — able to handle and explain Scripture." },
          { id: "submission", title: "Submitting to Leadership", content: "Hebrews 13:17 calls believers to submit to their leaders and give them confidence. This is not blind obedience — leaders who require compliance with sin must be resisted. But within the bounds of Scripture, godly leadership deserves respect and genuine submission.\n\nLeaders will give an account for how they shepherded their flock. This sobers the leader and should evoke the congregation's support, prayer, and cooperation." },
        ],
        reflectionQuestions: [
          "How do you currently relate to your church's leadership — with trust and prayer, or with skepticism and criticism?",
          "What would change in your church if every member actively supported and prayed for the leaders?",
        ],
        prayer: "Lord, give me a heart to support and pray for my church leaders. They carry a heavy responsibility. Strengthen them and help me be a blessing, not a burden.",
        assignment: "Write a brief note of genuine encouragement to a pastor or church leader this week. Be specific about how their ministry has impacted you.",
      },
      {
        id: "m07l06", moduleId: "m07", num: 6, title: "Church Leadership: Deacons",
        memoryVerse: { text: "Those who have served well gain an excellent standing and great assurance in their faith in Christ Jesus.", ref: "1 Timothy 3:13" },
        estimatedMinutes: 12,
        sections: [
          { id: "what-are-deacons", title: "What Are Deacons?", content: "Deacons (diakonos = servant) are those appointed to serve the practical and mercy needs of the congregation, freeing the elders to concentrate on prayer and the ministry of the Word (Acts 6:1-7).\n\nThe first deacons were chosen in Acts 6 to address inequity in the distribution of food. Their role was practical — yet they were required to be people of high character: full of the Spirit and wisdom (Acts 6:3)." },
          { id: "qualifications", title: "Qualifications for Deacons", content: "1 Timothy 3:8-13 lists the qualifications for deacons: worthy of respect, sincere, not indulging in excessive drinking, not pursuing dishonest gain, holding to the deep truths of the faith with a clear conscience, tested and found blameless, faithful to their spouse, managing children and household well.\n\nNota bene: verse 11 includes women — either wives of deacons or women deacons — who must meet the same character standards." },
          { id: "honor-of-service", title: "The Honor of Service", content: "In the Roman world, service was for slaves. In the Kingdom, service is the path to honor. Jesus himself took the form of a servant (Philippians 2:7) and washed His disciples' feet (John 13).\n\n1 Timothy 3:13 says those who serve well gain excellent standing. This is the Kingdom inversion: the servant is the greatest (Mark 10:43-44). The most powerful person in any community is often not the one at the front but the one serving faithfully at the back." },
        ],
        reflectionQuestions: [
          "Where do you serve in your church or community? Is your service motivated by duty or love?",
          "What would it mean for you personally to embrace the identity of 'servant' as a high calling rather than a low one?",
        ],
        prayer: "Lord Jesus, you washed feet. Humble me to serve where no one will notice, and let me find my honor in serving rather than being served.",
        assignment: "Identify one practical need in your church or community that you could meet this week. Do it without being asked and without announcing it.",
      },
      {
        id: "m07l07", moduleId: "m07", num: 7, title: "Spiritual Gifts in the Church & Church Discipline",
        memoryVerse: { text: "If your brother or sister sins, go and point out their fault, just between the two of you.", ref: "Matthew 18:15" },
        estimatedMinutes: 15,
        sections: [
          { id: "gifts-in-church", title: "Gifts Serving the Body", content: "Spiritual gifts are given not for private enjoyment but for the building up of the body (1 Corinthians 12:7; Ephesians 4:12). Every member of the body has been equipped to contribute. When gifts are not used, the whole body suffers.\n\nThe goal is that the body grows into the fullness of Christ (Ephesians 4:13) — a standard that cannot be reached if only a few people are using their gifts while others passively attend." },
          { id: "discipline", title: "Church Discipline", content: "Church discipline is the process by which a community lovingly confronts sin in a member's life, with the goal of restoration. It is not punishment — it is surgery to preserve the health of the body and the soul of the individual.\n\nJesus outlined the process in Matthew 18:15-20: first go privately, then with two or three witnesses, then before the church, then as a final step treat them as an outsider. Each step offers an opportunity for repentance before escalating." },
          { id: "purpose-of-discipline", title: "The Goal: Restoration", content: "The goal of discipline is never exclusion — it is restoration. Paul's instruction in 2 Corinthians 2:6-8 is that after the Corinthian man repented of his sin, the church should \"reaffirm your love for him\" — fully restore him.\n\nA church that never exercises discipline will eventually have no moral witness. A church that exercises discipline without love and without the goal of restoration is abusive. The balance is discipline in the context of covenant community and genuine love." },
        ],
        reflectionQuestions: [
          "Have you ever had someone lovingly confront a sin in your life? How did you respond? How do you feel about it now?",
          "What would need to change for your church community to practice loving accountability more naturally?",
        ],
        prayer: "Lord, give me the humility to receive correction and the courage to offer it in love. Let our community be marked by both truth and grace.",
        assignment: "Read Matthew 18:15-20 carefully. Consider: is there a relational conflict in your life that needs the Matthew 18 process? What is the first step you need to take?",
      },
      {
        id: "m07l08", moduleId: "m07", num: 8, title: "What the Church Is and Is Not",
        memoryVerse: { text: "You are a chosen people, a royal priesthood, a holy nation, God's special possession, that you may declare the praises of him who called you out of darkness into his wonderful light.", ref: "1 Peter 2:9" },
        estimatedMinutes: 14,
        sections: [
          { id: "is", title: "What the Church Is", content: "The Church is the Body of Christ — His hands, feet, and voice in the world (1 Corinthians 12). It is the family of God — where the deepest bonds of covenant relationship are formed. It is a royal priesthood — every member empowered to approach God and represent Him to the world (1 Peter 2:9). It is the pillar and foundation of truth (1 Timothy 3:15) — the community entrusted with the Gospel." },
          { id: "is-not", title: "What the Church Is Not", content: "The Church is not a building. It is not a social club where like-minded people gather for mutual enjoyment. It is not a service provider where consumers come to have their spiritual needs met. It is not a political party or a national identity.\n\nWhen the Church mistakes itself for any of these, it loses its identity and its power. The Church is a counter-cultural community — an alternative society that demonstrates the Kingdom of God to the world." },
          { id: "community-mission", title: "Church as Community and Mission", content: "The Church exists in two directions: inward (community — loving one another, building one another up) and outward (mission — making disciples of all nations).\n\nA church turned only inward becomes a holy huddle — warm and comfortable but not multiplying. A church turned only outward without internal community produces burned-out missionaries. Both directions are essential, and they reinforce each other: the deeper the community, the more compelling the witness." },
        ],
        reflectionQuestions: [
          "Which wrong understanding of church have you carried — consumer, social club, national identity? How has it affected your engagement?",
          "How does your current church balance community (inward) and mission (outward)?",
        ],
        prayer: "Lord, help me to be the Church — not just attend it. Let me be a living stone in your holy temple, built for your glory and for the world's good.",
        assignment: "Reflect on 1 Peter 2:4-12. Write about what 'being the church' means in your neighborhood, workplace, or family — practically and specifically.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 8: WATER BAPTISM AND THE LORD'S SUPPER
  // ─────────────────────────────────────────
  {
    id: "m08",
    num: 8,
    title: "Water Baptism and the Lord's Supper",
    description: "Understand the two ordinances of the Church and their deep spiritual significance.",
    lessons: [
      {
        id: "m08l01", moduleId: "m08", num: 1, title: "Ordinance Definition",
        memoryVerse: { text: "Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit.", ref: "Matthew 28:19" },
        estimatedMinutes: 12,
        sections: [
          { id: "what-is-ordinance", title: "What Is an Ordinance?", content: "An ordinance (sometimes called a sacrament) is a physical act commanded by Christ that visibly portrays a spiritual reality and is practiced by the Church until His return.\n\nProtestants generally recognize two ordinances: Water Baptism and the Lord's Supper. Catholics and Orthodox traditions recognize seven sacraments. The key difference is whether these acts convey grace (sacramental view) or symbolize grace already received (ordinance view)." },
          { id: "why-physical", title: "Why Physical Acts?", content: "God uses physical, tangible elements to communicate spiritual realities — because we are embodied creatures. Water, bread, and wine are not arbitrary. They engage our senses and make abstract truth concrete.\n\nThe ordinances are like visible words — they preach the Gospel in action. Baptism proclaims death and resurrection. The Lord's Supper proclaims the body broken and the blood poured out. Both are Gospel proclamations in physical form." },
          { id: "commanded", title: "They Are Commanded", content: "Jesus commanded both: baptism in Matthew 28:19 and the Lord's Supper in Luke 22:19 (\"Do this in remembrance of me\"). They are not optional extras for the particularly devout — they are the regular practice of every disciple and every community.\n\nTo neglect the ordinances is to neglect the visible word of the Gospel that Christ has given His church." },
        ],
        reflectionQuestions: [
          "Have you been baptized? Have you participated in the Lord's Supper? How have these ordinances been meaningful (or not) to you?",
          "Why do you think God chose physical elements to communicate spiritual realities?",
        ],
        prayer: "Lord, help me not to treat the ordinances casually. They are your visible word. Give me reverence and understanding as I participate in them.",
        assignment: "Before your next session, look up the history and meaning of the two ordinances in your tradition. What does your church believe about them?",
      },
      {
        id: "m08l02", moduleId: "m08", num: 2, title: "Water Baptism: Definition & Importance",
        memoryVerse: { text: "We were therefore buried with him through baptism into death in order that, just as Christ was raised from the dead through the glory of the Father, we too may live a new life.", ref: "Romans 6:4" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is Baptism?", content: "Water baptism is the outward sign of an inward spiritual reality — the death of the old self and the resurrection of the new creation in Christ. The Greek word baptizo means to immerse or submerge.\n\nBaptism is the public declaration that a person has repented of sin, believed in Jesus Christ, and been united to His death, burial, and resurrection. It is the entry point into the visible community of the Church." },
          { id: "importance", title: "Why Is Baptism Important?", content: "Jesus commanded it (Matthew 28:19). He submitted to it Himself (Matthew 3:13-17). Every believer in the New Testament was baptized — it was not considered optional. The early church baptized on the day of faith (Acts 2:41; 8:36-38; 10:47-48).\n\nBaptism is important not because it saves (it does not — salvation is by grace through faith alone) but because it obeys, confesses, and marks publicly what has happened inwardly." },
          { id: "timing", title: "When Should You Be Baptized?", content: "The New Testament pattern is baptism following faith — \"those who accepted his message were baptized\" (Acts 2:41). There is no gap of years between belief and baptism in the New Testament.\n\nIf you have repented and believed in Christ but have not yet been baptized, this lesson is an invitation to take that step. Obedience to Christ's command is part of the discipleship journey." },
        ],
        reflectionQuestions: [
          "If you have been baptized, what did that experience mean to you? How has your understanding of it deepened?",
          "If you have not been baptized as a believer, what has prevented you? Is now the time to take that step?",
        ],
        prayer: "Lord, I embrace the full obedience of discipleship — including baptism. Whether I have been baptized or am preparing to be, help me understand the depth of what it means.",
        assignment: "Read Acts 2:36-41 and Acts 8:26-40 (Philip and the Ethiopian). What immediately preceded baptism in each case? What does this tell you about the relationship between faith and baptism?",
      },
      {
        id: "m08l03", moduleId: "m08", num: 3, title: "Mode of Baptism: Immersion",
        memoryVerse: { text: "As soon as Jesus was baptized, he went up out of the water.", ref: "Matthew 3:16" },
        estimatedMinutes: 12,
        sections: [
          { id: "why-immersion", title: "Why Immersion?", content: "The Greek word baptizo means to immerse, dip, or plunge — not to sprinkle or pour. The picture Paul draws in Romans 6:4 of being \"buried\" and \"raised\" makes sense only with full immersion: going under the water (burial) and coming out (resurrection).\n\nJesus' baptism involved coming up \"out of the water\" (Matthew 3:16), suggesting He was in the water. John chose Aenon near Salim because \"there was plenty of water there\" (John 3:23) — unnecessary if sprinkling were the mode." },
          { id: "modes", title: "A Word on Different Modes", content: "Many sincere Christians practice sprinkling or pouring, particularly in traditions that practice infant baptism. This is a real difference among believers, and it has been debated for centuries.\n\nRegardless of mode or timing, the critical questions are: Has the person come to genuine faith in Christ? Is the baptism understood as a public identification with Christ's death and resurrection? The ordinance is about Christ, not about the amount of water." },
          { id: "symbolism", title: "The Power of the Symbol", content: "The symbolism of immersion is extraordinarily rich. Going under: death, burial, the old creation passing away. Coming up: resurrection, new creation, new life. Being fully surrounded by water: completely identified with Christ, washed by His blood.\n\nWhen you see a baptism, you are watching a personal drama of the Gospel — a reenactment of the death and resurrection of Christ applied to one person's life." },
        ],
        reflectionQuestions: [
          "How does understanding the symbolism of immersion deepen your appreciation for what baptism communicates?",
          "How should we treat believers from traditions that practice a different mode of baptism?",
        ],
        prayer: "Lord, let the truths symbolized in baptism be real in my daily life — dying to self and living to you.",
        assignment: "Attend a baptism service if possible. Observe carefully. Write about what you observe and what it communicates about the Gospel.",
      },
      {
        id: "m08l04", moduleId: "m08", num: 4, title: "Meaning of Baptism: Identification",
        memoryVerse: { text: "Or don't you know that all of us who were baptized into Christ Jesus were baptized into his death?", ref: "Romans 6:3" },
        estimatedMinutes: 13,
        sections: [
          { id: "identification", title: "Baptism as Identification", content: "The primary meaning of baptism is identification — with Christ's death, burial, and resurrection (Romans 6:3-5), and with His community. To be baptized \"into Christ Jesus\" means to be publicly declared as belonging to Him.\n\nIn the Roman world, to be baptized into someone's name was to declare loyalty to that person. Baptism is a loyalty oath — the believer publicly pledges allegiance to Jesus Christ as Lord." },
          { id: "with-the-body", title: "Identification with the Body", content: "Baptism also identifies you with the body of Christ — the Church. You are not just saying \"I belong to Jesus\" privately. You are publicly entering the visible community of His people.\n\nThis is why baptism in the New Testament was a public act with witnesses. It was a community event, not a private religious ritual." },
          { id: "ongoing-meaning", title: "Ongoing Meaning", content: "Romans 6:11 commands believers to \"reckon yourselves dead to sin and alive to God.\" The word reckons connects to the baptism that has already been performed. Baptism is not just a past event — it is a present identity marker.\n\nWhen temptation comes, you can say: \"I have been baptized. I am dead to sin. I am alive to God. I am not the person I was before the water.\" This is the ongoing power of baptism in the believer's life." },
        ],
        reflectionQuestions: [
          "How does baptism as a public identification with Christ differ from a merely private commitment?",
          "When was the last time you thought of your baptism as a source of strength against temptation?",
        ],
        prayer: "Lord, I am identified with you — in death and in life. Help me live from my baptismal identity every day.",
        assignment: "Write a personal baptism testimony — what your baptism meant (or would mean) to you, using the language of identification with Christ's death and resurrection.",
      },
      {
        id: "m08l05", moduleId: "m08", num: 5, title: "Effects of Baptism & Believer's Baptism",
        memoryVerse: { text: "And this water symbolizes baptism that now saves you also — not the removal of dirt from the body but the pledge of a clear conscience toward God.", ref: "1 Peter 3:21" },
        estimatedMinutes: 13,
        sections: [
          { id: "what-baptism-does", title: "What Baptism Does and Does Not Do", content: "Baptism does not save — salvation is by grace through faith alone (Ephesians 2:8-9). The thief on the cross was promised paradise without baptism (Luke 23:43). 1 Peter 3:21 clarifies: baptism saves \"not [as] the removal of dirt from the body\" (not water touching skin) but as \"the pledge of a clear conscience toward God\" — the faith expressed in the act.\n\nBaptism is the public expression and seal of the faith that saves. It declares, confirms, and marks — but the saving is done by grace through faith in Christ." },
          { id: "believers-baptism", title: "Believer's Baptism", content: "Believer's baptism (credobaptism) is the conviction that baptism is properly administered only to those who have personally professed faith in Jesus Christ. It is the position of the New Testament: \"Those who accepted his message were baptized\" (Acts 2:41) — faith preceded baptism every time.\n\nInfant baptism (paedobaptism) is practiced by other traditions as a sign of covenant membership. This is a genuine difference among sincere believers — one that deserves respectful conversation rather than condemnation." },
          { id: "rebaptism", title: "What About Rebaptism?", content: "Some who were baptized as infants without personal faith choose to be baptized as believers once they come to faith. This is a personal decision that should be made prayerfully and in consultation with the leadership of your church.\n\nThe question to ask is: Was your previous baptism an expression of your own faith in Christ? If it was not, believer's baptism may be a meaningful and obedient step." },
        ],
        reflectionQuestions: [
          "How do you understand the relationship between faith and baptism? Which comes first, and why does the order matter?",
          "If you were baptized as an infant, have you considered whether believer's baptism would be meaningful for you?",
        ],
        prayer: "Lord, clarify my understanding of baptism. Let me neither add to it (as if it saves by itself) nor subtract from it (as if it's unimportant).",
        assignment: "Interview two Christians from different baptism traditions. Ask them to explain what their tradition believes about baptism and why. Note the differences and similarities.",
      },
      {
        id: "m08l06", moduleId: "m08", num: 6, title: "The Lord's Supper",
        memoryVerse: { text: "For whenever you eat this bread and drink this cup, you proclaim the Lord's death until he comes.", ref: "1 Corinthians 11:26" },
        estimatedMinutes: 15,
        sections: [
          { id: "what-is-it", title: "What Is the Lord's Supper?", content: "The Lord's Supper (also called Communion, Eucharist, or the Breaking of Bread) is the ongoing ordinance in which the church remembers and proclaims Christ's death through the sharing of bread and wine (or grape juice).\n\nIt was instituted by Jesus on the night of His arrest (Matthew 26:26-29) and was practiced regularly by the early church (Acts 2:42; 1 Corinthians 11:17-34). It is a covenant meal — the new covenant sealed in Christ's blood (Luke 22:20)." },
          { id: "what-it-means", title: "What It Means", content: "The Lord's Supper has four dimensions:\n\nMemorial — \"Do this in remembrance of me\" (Luke 22:19). It looks backward to the cross.\nProclamation — \"You proclaim the Lord's death\" (1 Corinthians 11:26). It preaches the Gospel.\nCommunion — \"The bread that we break, is it not a participation in the body of Christ?\" (1 Corinthians 10:16). It creates community.\nAnticipation — \"until he comes\" (1 Corinthians 11:26). It looks forward to His return." },
          { id: "right-participation", title: "Right Participation", content: "1 Corinthians 11:27-31 warns against participating in the Lord's Supper \"in an unworthy manner\" — without recognizing the body of Christ (both the crucified Lord and the church community). This leads to eating and drinking judgment upon oneself.\n\nThe proper preparation is self-examination (verse 28) — honest confession of sin before approaching the table. The Lord's Supper is for those who believe — not for unbelievers, who have not yet entered the covenant the meal celebrates." },
        ],
        reflectionQuestions: [
          "When you take communion, do you approach it as a memorial, a proclamation, a communion, and an anticipation? Which dimension are you least aware of?",
          "What does it mean to \"examine yourself\" before taking communion? How do you practice this?",
        ],
        prayer: "Lord Jesus, as I remember your body broken and your blood poured out, let the weight of your sacrifice be real to me. Let this meal be holy.",
        assignment: "The next time you take communion, consciously think through all four dimensions (memorial, proclamation, communion, anticipation) as you receive the elements.",
      },
      {
        id: "m08l07", moduleId: "m08", num: 7, title: "The Last Supper",
        memoryVerse: { text: "This is my body given for you; do this in remembrance of me.", ref: "Luke 22:19" },
        estimatedMinutes: 14,
        sections: [
          { id: "context", title: "The Context: Passover", content: "The Last Supper took place within the context of the Passover meal — the annual Jewish feast celebrating Israel's deliverance from Egypt through the blood of a lamb. Jesus deliberately chose this moment to institute the new ordinance.\n\nIn doing so, He declared Himself the ultimate Passover Lamb — the one whose blood would deliver not just one nation from Egypt but all humanity from sin and death (John 1:29; 1 Corinthians 5:7)." },
          { id: "meaning-of-elements", title: "The Meaning of Bread and Cup", content: "Jesus took the bread and said, \"This is my body given for you\" (Luke 22:19). His body was given — not merely surrendered but voluntarily offered, in our place and for our sake.\n\nHe took the cup and said, \"This cup is the new covenant in my blood, which is poured out for you\" (Luke 22:20). The new covenant — promised in Jeremiah 31:31-34 — is sealed with His blood. Every cup of communion is a covenant renewal ceremony." },
          { id: "betrayal-and-love", title: "Betrayal and Love at the Same Table", content: "At this same table sat Judas, who would betray Him within hours. Jesus knew. Yet He washed Judas's feet, served him the meal, and offered him every opportunity to repent.\n\nThis is the character of the God whose death we celebrate at this table — He serves those who will betray Him. He loves His enemies. He dies for those who crucify Him. The Last Supper is a portrait of the kind of love that is utterly unlike our own." },
        ],
        reflectionQuestions: [
          "What does it mean to you that Jesus chose Passover — the feast of deliverance through blood — as the moment to institute communion?",
          "Knowing Judas was at the table, what does Jesus' conduct tell you about His character and His love?",
        ],
        prayer: "Lord Jesus, you gave your body. You poured out your blood. I receive what you have done — and I pledge my life to the One who loved me this completely.",
        assignment: "Read the four accounts of the Last Supper (Matthew 26:17-30, Mark 14:12-26, Luke 22:7-23, John 13:1-30). Note what each author emphasizes. What unique detail does each add?",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 9: THE CHRISTIAN AND SIN
  // ─────────────────────────────────────────
  {
    id: "m09",
    num: 9,
    title: "The Christian and Sin",
    description: "Face sin honestly, understand its power, and discover how to walk in progressive victory.",
    lessons: [
      {
        id: "m09l01", moduleId: "m09", num: 1, title: "Hamartiology: Doctrine of Sin",
        memoryVerse: { text: "For all have sinned and fall short of the glory of God.", ref: "Romans 3:23" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is Sin?", content: "Hamartiology is the study of sin (hamartia = missing the mark). The Bible describes sin in multiple ways: transgression (crossing a boundary), iniquity (moral crookedness), rebellion (deliberate defiance), and missing the mark (failing to achieve God's standard).\n\nSin is anything that falls short of God's perfect character and will — in thought, word, deed, or failure to do what is right (James 4:17). It is not just doing bad things; it is anything that deviates from God's good intention." },
          { id: "universal", title: "The Universality of Sin", content: "Romans 3:23 is unambiguous: \"all have sinned.\" No exceptions. No special categories of people exempt from the human condition. The apostle Paul includes himself: \"Christ Jesus came into the world to save sinners — of whom I am the worst\" (1 Timothy 1:15).\n\nThis universal diagnosis is not pessimistic — it is the only honest starting point for grace. You cannot receive a cure you don't know you need." },
          { id: "nature", title: "The Nature of Sin", content: "Sin is not merely behavior — it is a nature, a condition, and a power. Behavior is the symptom; the fallen nature is the disease. External reformation cannot fix an internal problem.\n\nSin has both vertical and horizontal dimensions. Vertically: all sin is ultimately against God (Psalm 51:4 — \"Against you, you only, have I sinned\"). Horizontally: sin damages relationships, communities, and creation." },
        ],
        reflectionQuestions: [
          "What definition of sin were you working with before this lesson? How has it expanded?",
          "Is it difficult for you to honestly admit that you are a sinner? What makes honesty about sin hard?",
        ],
        prayer: "Lord, I acknowledge that I am a sinner — not in performance but in nature. I need your salvation not just once but daily. Thank you that your grace is greater than my sin.",
        assignment: "Read Psalm 51 slowly. It is David's prayer after profound sin. What does David understand about the nature of sin, about God's character, and about what genuine repentance looks like?",
      },
      {
        id: "m09l02", moduleId: "m09", num: 2, title: "Sin Definition & Original Sin",
        memoryVerse: { text: "Therefore, just as sin entered the world through one man, and death through sin, and in this way death came to all people, because all sinned.", ref: "Romans 5:12" },
        estimatedMinutes: 14,
        sections: [
          { id: "original-sin", title: "Original Sin", content: "Original sin is the doctrine that Adam's sin in the garden had universal consequences. All of humanity is affected — not just by Adam's example but by solidarity with him as the head of the human race.\n\nTwo aspects: inherited guilt (we share in Adam's verdict) and inherited corruption (we are born with a nature inclined toward sin). This is why children sin without being taught to — the inclination is inherited." },
          { id: "total-depravity", title: "Total Depravity", content: "Total depravity does not mean every person is as evil as they could possibly be. It means sin has affected every dimension of human nature: intellect, will, emotion, and body. Nothing in us is untouched by the fall.\n\nThis is why natural humanity cannot seek God (Romans 3:11), cannot understand spiritual things (1 Corinthians 2:14), and cannot submit to God's law (Romans 8:7). Salvation must be initiated entirely by God — because the fallen human cannot initiate it." },
          { id: "consequences", title: "Consequences of Sin", content: "The consequences of original sin flow from Genesis 3: spiritual death (separation from God), physical death (the body returns to dust), relational brokenness (shame, blame, conflict), environmental corruption (thorns and thistles, painful labor), and eternal judgment (without redemption).\n\nEvery problem in the world — personal, relational, social, environmental — traces back to this one event. The Gospel addresses all of these consequences: regeneration for spiritual death, resurrection for physical death, reconciliation for relational brokenness." },
        ],
        reflectionQuestions: [
          "How does understanding inherited sin (total depravity) change your understanding of why the world is broken?",
          "Does the doctrine of original sin feel fatalistic to you, or does it actually provide hope? Why?",
        ],
        prayer: "Lord, I acknowledge the depth of the problem you came to solve. Sin is not merely behavior I can manage — it is a nature you must transform. Do your work in me.",
        assignment: "Read Genesis 3 carefully. List every consequence of the fall you can identify. Then find a New Testament passage that addresses each consequence through Christ.",
      },
      {
        id: "m09l03", moduleId: "m09", num: 3, title: "Actual Sin & The Flesh",
        memoryVerse: { text: "For the flesh desires what is contrary to the Spirit, and the Spirit what is contrary to the flesh. They are in conflict with each other.", ref: "Galatians 5:17" },
        estimatedMinutes: 14,
        sections: [
          { id: "actual-sin", title: "Actual Sin vs. Original Sin", content: "Original sin is the fallen nature we inherited. Actual sin is the specific sins we personally commit — thoughts, words, deeds, and omissions. Both are real; both require Christ's atonement.\n\nJesus' blood covers both: the inherited guilt of original sin and the specific guilt of every actual sin you have committed. \"He canceled the charge of our legal indebtedness, which stood against us and condemned us; he has taken it away, nailing it to the cross\" (Colossians 2:14)." },
          { id: "the-flesh", title: "What Is 'The Flesh'?", content: "Paul's word sarx (flesh) does not refer to the physical body — it refers to the self-directed life, the human nature operating independently of God. The flesh is what remains of the old Adam within the believer — not the old nature (which is dead), but its lingering patterns and desires.\n\nThe flesh operates through: the lusts of the body, the pride of life, and self-sufficiency. It produces the works listed in Galatians 5:19-21 — not because the believer wants to sin but because the flesh's patterns are still active." },
          { id: "believer-and-flesh", title: "The Believer and the Flesh", content: "The new creation is real. The flesh is also real. The Christian life involves genuine war between the new nature (which delights in God's law) and the flesh (which opposes it) — as Paul describes vividly in Romans 7.\n\nBut the war is not even. The Spirit who lives in you is greater (1 John 4:4). The Spirit enables you to put to death the deeds of the body (Romans 8:13). Victory is not perfection but direction — consistently walking by the Spirit rather than being driven by the flesh." },
        ],
        reflectionQuestions: [
          "What patterns of the flesh do you most consistently struggle with? Have you brought them honestly to God and to a trusted believer?",
          "How does knowing the battle is real — and that it is also winnable — give you both realism and hope?",
        ],
        prayer: "Lord, I acknowledge the war within me. By your Spirit, help me walk in victory — not pretending the flesh doesn't exist, but refusing to let it rule.",
        assignment: "Read Romans 7:14-25 and Romans 8:1-17 in one sitting. How does Paul's tone shift? What changes between chapters 7 and 8, and why?",
      },
      {
        id: "m09l04", moduleId: "m09", num: 4, title: "Temptation",
        memoryVerse: { text: "No temptation has overtaken you except what is common to mankind. And God is faithful; he will not let you be tempted beyond what you can bear.", ref: "1 Corinthians 10:13" },
        estimatedMinutes: 14,
        sections: [
          { id: "what-is-temptation", title: "What Is Temptation?", content: "Temptation is the enticement to sin — the pull toward what is contrary to God's will. It is not sin itself; Jesus was tempted in every way as we are, yet was without sin (Hebrews 4:15).\n\nThe temptation process described in James 1:14-15: desire → enticement → sin → death. At the desire stage, the test is the hardest and the most important. The moment we entertain and begin to negotiate with temptation, we have lost significant ground." },
          { id: "source", title: "The Sources of Temptation", content: "Temptation has three sources that theologians call the world, the flesh, and the devil. The world system promotes values contrary to God's Kingdom (1 John 2:15-17). The flesh responds to those attractions from within. The devil actively schemes to lead believers into sin (Ephesians 6:11; 1 Peter 5:8).\n\nThese three work together. The devil exploits the flesh's desires using the world's opportunities. Awareness of all three sources is part of the Christian's self-defense." },
          { id: "the-way-out", title: "The Way Out", content: "1 Corinthians 10:13 promises a way out — not the temptation removed, but an exit. This requires active cooperation: look for the exit before you are in the middle of the temptation.\n\nPractical exits: flee (Joseph ran from Potiphar's wife — Genesis 39:12), resist (James 4:7 — resist the devil and he will flee), pray in advance for protection (Matthew 6:13 — \"Lead us not into temptation\"), and confess to another believer (James 5:16 — confession brings accountability and prayer)." },
        ],
        reflectionQuestions: [
          "What are your primary points of vulnerability to temptation? Are you building protective structures around those vulnerabilities?",
          "Have you ever failed to take \"the way out\" in a moment of temptation? What can you learn from that experience?",
        ],
        prayer: "Lord, lead me not into temptation but deliver me from the evil one. Show me the exit before I am surrounded, and give me the courage and speed to take it.",
        assignment: "Identify your top three temptation patterns. For each one, identify a practical exit strategy — a specific action you will take when that temptation comes. Share these with your peer guide.",
      },
      {
        id: "m09l05", moduleId: "m09", num: 5, title: "Mortification: Putting Sin to Death",
        memoryVerse: { text: "For if you live according to the flesh, you will die; but if by the Spirit you put to death the misdeeds of the body, you will live.", ref: "Romans 8:13" },
        estimatedMinutes: 15,
        sections: [
          { id: "what-is-mortification", title: "What Is Mortification?", content: "Mortification is the active, ongoing work of putting sin to death — not suppressing or managing it but killing it at the root. The word comes from the Latin for death (mort). This is not a one-time event but a daily spiritual discipline.\n\nJohn Owen famously wrote: \"Be killing sin or it will be killing you.\" There is no neutral ground. Sin, left unchecked, grows. The believer's responsibility is to actively, aggressively pursue its destruction." },
          { id: "how-to-mortify", title: "How to Mortify Sin", content: "Mortification is not self-flagellation or white-knuckled willpower. It is Spirit-empowered, faith-driven action:\n\n1. Identify the specific sin — be ruthlessly honest.\n2. Trace it to its root — what desire, fear, or idol lies beneath the behavior?\n3. Counter the root with the Gospel — what does Christ's finished work say about this area?\n4. Replace the behavior with a Spirit-empowered opposite (Ephesians 4:28 — steal no more, work and give).\n5. Be accountable to another believer." },
          { id: "gracious", title: "Mortification Is Grace-Empowered", content: "Mortification is not a performance to impress God. It is the grateful response of someone who has been freed — it is gratitude expressing itself in warfare against what enslaved you.\n\nAnd it works by the Spirit (Romans 8:13) — \"if by the Spirit you put to death.\" The Spirit provides both the conviction (what needs to die) and the power (the means of its death). Our part is to cooperate, not generate the power ourselves." },
        ],
        reflectionQuestions: [
          "Is there a sin in your life you have been managing rather than mortifying? What would aggressive mortification look like?",
          "What is the root desire beneath your most persistent sin? How does the Gospel address that root?",
        ],
        prayer: "Lord, give me the courage to be ruthless with sin and the wisdom to trace it to its root. By your Spirit, I put [name specific sin] to death today.",
        assignment: "Choose one sin you are battling. Apply the five-step process from this lesson. Write it out specifically and share it with your peer guide for accountability.",
      },
      {
        id: "m09l06", moduleId: "m09", num: 6, title: "Confession of Sin",
        memoryVerse: { text: "Confess your sins to each other and pray for each other so that you may be healed.", ref: "James 5:16" },
        estimatedMinutes: 13,
        sections: [
          { id: "to-god", title: "Confession to God", content: "The primary direction of confession is toward God. All sin is ultimately against God — it violates His character, breaks His law, and grieves His heart. Confession to God restores the broken fellowship and the flow of grace.\n\n1 John 1:9 is the standing promise: confess, and He will forgive and cleanse. This is not a transaction — it is a return to the Father's house. Don't delay confession by trying to feel sorry enough first — come as you are and let His grace produce the sorrow." },
          { id: "to-others", title: "Confession to Others", content: "James 5:16 commands confession to one another, not just to God. This is harder — and more powerful. Secrecy is sin's oxygen. Bringing sin into the light of a trusted community kills its power.\n\nConfession to another believer does not replace confession to God. It adds accountability, human prayer support, and the experience of being accepted and loved despite your worst. The person who hears your confession becomes a tangible agent of God's grace." },
          { id: "who-to-confess-to", title: "Who Should You Confess To?", content: "Confession should go to a trustworthy, spiritually mature believer — someone who can keep confidence, respond with grace rather than shock, and pray effectively for you. This is not public confession of every sin — it is targeted, relational confession of sins that have power over you.\n\nIdeally, it is a peer guide, spiritual mentor, or trusted friend. The peer-to-peer relationship in this network is designed to create exactly this kind of safe, accountable space." },
        ],
        reflectionQuestions: [
          "Is there a sin you have confessed to God but not to another person? Does it still have power over you?",
          "Do you have a relationship in which mutual confession and prayer are practiced? If not, who could be that person?",
        ],
        prayer: "Lord, give me the humility to bring my sin into the light — before you and before a trusted brother or sister. Break the power of secrecy over my life.",
        assignment: "This week, confess a specific sin to both God and a trusted believer. Not a general confession — a specific one. Notice what changes in your experience of that sin after confession.",
      },
      {
        id: "m09l07", moduleId: "m09", num: 7, title: "Repentance & Forgiveness",
        memoryVerse: { text: "Repent, then, and turn to God, so that your sins may be wiped out, that times of refreshing may come from the Lord.", ref: "Acts 3:19" },
        estimatedMinutes: 14,
        sections: [
          { id: "repentance", title: "True Repentance", content: "Repentance (metanoia) means a change of mind that leads to a change of direction. It is not feeling bad about being caught. It is not promising to try harder. It is a genuine turn — from sin toward God.\n\nPaul describes two kinds of sorrow: worldly sorrow (that produces death — regret without change, grief about consequences) and godly sorrow (that produces repentance leading to salvation) (2 Corinthians 7:10). The question is not \"Do I feel bad?\" but \"Have I turned?\"" },
          { id: "elements", title: "Elements of Repentance", content: "Genuine repentance includes: recognizing the sin as sin (not excusing, minimizing, or blaming others), feeling appropriate sorrow toward God for having grieved Him, confessing specifically and honestly, turning from the sin and toward righteousness, making restitution where possible (Luke 19:8), and trusting God's forgiveness.\n\nRepentance is not a one-time event — it is a lifestyle. The Reformation principle Semper Reformanda (\"always reforming\") began with Luther's first thesis: \"When our Lord and Master Jesus Christ said 'Repent,' he willed the entire life of believers to be one of repentance.\"" },
          { id: "forgiveness", title: "The Forgiveness That Follows", content: "God's forgiveness is complete, immediate, and permanent. \"As far as the east is from the west, so far has he removed our transgressions from us\" (Psalm 103:12). He does not remember our sins in a judicial sense (Hebrews 8:12) — they are no longer counted against us.\n\nReceiving forgiveness requires faith — actually believing that God has done what He said He would do. Guilt that persists after genuine confession and repentance is not humility — it is unbelief. Accept the gift." },
        ],
        reflectionQuestions: [
          "Is there a sin you have confessed but not truly repented of — meaning you have not yet turned from it? What is preventing the turn?",
          "Is there a sin for which you have been forgiven but struggle to receive forgiveness? What lies are you believing about God's grace?",
        ],
        prayer: "Lord, I turn. Not just feel bad — I turn. Thank you for forgiveness that is complete. Help me receive it fully and walk in the freedom it brings.",
        assignment: "Read Luke 15:11-32 (The Prodigal Son) as a story about repentance and forgiveness. Identify every element of repentance in the son's journey. Then identify the Father's response at each stage.",
      },
      {
        id: "m09l08", moduleId: "m09", num: 8, title: "Sanctification & Victory",
        memoryVerse: { text: "For it is God who works in you to will and to act in order to fulfill his good purpose.", ref: "Philippians 2:13" },
        estimatedMinutes: 15,
        sections: [
          { id: "positional", title: "Positional Sanctification", content: "Positional sanctification is what is already true of every believer — you have been set apart (hagios = holy) in Christ. \"You were washed, you were sanctified, you were justified in the name of the Lord Jesus Christ\" (1 Corinthians 6:11).\n\nThis is not what you have achieved — it is what Christ has secured. You are already holy in the sight of God because you are in Christ, who is the Holy One." },
          { id: "progressive", title: "Progressive Sanctification", content: "Progressive sanctification is the ongoing process of becoming in practice what you already are in position — of your actual character and conduct increasingly conforming to your standing in Christ.\n\nThis is the lifelong work of the Spirit, through the Word, through community, through trials, through spiritual disciplines, and through the choices we make to cooperate with His work or resist it. It is not automatic — it requires effort, yet it is not merely human effort." },
          { id: "victory", title: "Victory: God's Work Through You", content: "The Christian life is not a slow crawl toward victory — it is walking in the victory Christ has already won. Romans 8:37: \"In all these things we are more than conquerors through him who loved us.\"\n\nPhilippians 2:12-13 holds the tension perfectly: \"Work out your salvation with fear and trembling, for it is God who works in you.\" You work because God is working. His work energizes yours. The outcome is certain because it rests on His faithfulness, not your performance." },
        ],
        reflectionQuestions: [
          "What is the difference between trying to become holy through willpower versus cooperating with the Spirit in sanctification?",
          "In what area of your life do you most clearly see progressive sanctification at work — where you have changed over time?",
        ],
        prayer: "Lord, continue your work in me. I cooperate — I yield, I practice, I resist — but I know the transformation is yours. Make me more like your Son.",
        assignment: "Look back over the past year. Identify one area where you have genuinely grown in holiness. Write about what contributed to that growth. Share it as an encouragement at your next session.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 10: SHARING YOUR FAITH
  // ─────────────────────────────────────────
  {
    id: "m10",
    num: 10,
    title: "Sharing Your Faith",
    description: "Learn to share the Gospel naturally, boldly, and effectively in everyday life.",
    lessons: [
      {
        id: "m10l01", moduleId: "m10", num: 1, title: "Evangelism Definition",
        memoryVerse: { text: "How, then, can they call on the one they have not believed in? And how can they believe in the one of whom they have not heard? And how can they hear without someone preaching to them?", ref: "Romans 10:14" },
        estimatedMinutes: 14,
        sections: [
          { id: "definition", title: "What Is Evangelism?", content: "Evangelism is the proclamation of the Good News (euangelion) of Jesus Christ — His life, death, and resurrection — so that people may repent, believe, and receive new life in Him.\n\nIt is not recruiting for a religion, promoting a lifestyle, or improving people's morality. It is announcing that the King has come, that reconciliation with God is possible, and that the free offer of salvation is available to all who receive it." },
          { id: "why-every-believer", title: "Why Every Believer Is Called", content: "The Great Commission is given to all disciples — not just pastors, missionaries, or evangelists (Matthew 28:18-20). Every believer has been given the ministry of reconciliation (2 Corinthians 5:18-20) — we are all ambassadors of Christ.\n\nThe spiritual gift of evangelism (Ephesians 4:11) is given to some in heightened measure — but the call to witness belongs to all. You don't need a gift to share what God has done in your life." },
          { id: "motivated-by-love", title: "Evangelism Motivated by Love", content: "The only sustainable motivation for evangelism is love — love for God and love for the lost. Fear-based evangelism burns out. Duty-based evangelism produces only reluctant compliance. But love for people — genuinely caring about their eternal destiny — produces natural, courageous, joyful sharing.\n\n\"Christ's love compels us\" (2 Corinthians 5:14). The word \"compels\" suggests an irresistible motivation. The more deeply you experience Christ's love, the more naturally it overflows toward those who don't yet know Him." },
        ],
        reflectionQuestions: [
          "Do you see yourself as an evangelist? If not, what barriers have prevented you from sharing your faith?",
          "What is your primary motivation when you think about sharing your faith — fear, duty, or love?",
        ],
        prayer: "Lord, give me your heart for the lost. Let your love compel me — not guilt or duty — to share what you have given me.",
        assignment: "Write a list of five people in your life who do not yet know Christ. Commit to pray for each of them by name every day this week.",
      },
      {
        id: "m10l02", moduleId: "m10", num: 2, title: "The Gospel: Good News",
        memoryVerse: { text: "For I am not ashamed of the gospel, because it is the power of God that brings salvation to everyone who believes.", ref: "Romans 1:16" },
        estimatedMinutes: 16,
        sections: [
          { id: "what-is-gospel", title: "What Is the Gospel?", content: "The Gospel is not advice — it is news. Advice tells you what to do. News tells you what has happened. The Gospel announces: God became man, lived the life we couldn't live, died the death we deserved, rose triumphant over sin and death, and now offers full reconciliation to all who repent and believe.\n\nPaul defines the Gospel's core content in 1 Corinthians 15:3-4: Christ died for our sins according to the Scriptures; He was buried; He rose on the third day according to the Scriptures." },
          { id: "four-parts", title: "The Four-Part Gospel Outline", content: "A simple outline for the Gospel:\n\n1. God: The Holy Creator who made us for relationship with Himself.\n2. Man: We have all sinned, broken that relationship, and stand under judgment.\n3. Christ: Jesus lived, died, and rose to restore what sin destroyed.\n4. Response: Repent and believe — turn from self-rule to Christ's rule and trust Him as Savior and Lord.\n\nEvery personal Gospel presentation can be organized around these four movements." },
          { id: "power-of-gospel", title: "The Power of the Gospel", content: "Romans 1:16 calls the Gospel \"the power of God for salvation.\" The Greek word for power is dunamis — from which we get dynamite. The Gospel is not a religious suggestion — it is explosive power that breaks chains, transforms lives, and creates new creation.\n\nThis means: we don't have to make the Gospel \"work.\" We just have to faithfully proclaim it. The power is in the message, not in our cleverness or technique. Our job is proclamation; God's job is transformation." },
        ],
        reflectionQuestions: [
          "Can you explain the Gospel clearly and simply to someone who has never heard it? Practice with your peer guide.",
          "Do you believe the Gospel is powerful enough to transform the people in your life? What or who makes it hard to believe?",
        ],
        prayer: "Lord, make me bold and unashamed of the Gospel. Let me trust its power and faithfully proclaim it, leaving the results to you.",
        assignment: "Practice sharing the Gospel using the four-part outline in 2-3 minutes. Present it to your peer guide and ask for honest feedback.",
      },
      {
        id: "m10l03", moduleId: "m10", num: 3, title: "Witnessing & Apologetics",
        memoryVerse: { text: "Always be prepared to give an answer to everyone who asks you to give the reason for the hope that you have. But do this with gentleness and respect.", ref: "1 Peter 3:15" },
        estimatedMinutes: 15,
        sections: [
          { id: "witnessing", title: "What Is Witnessing?", content: "Witnessing is sharing your personal testimony of what God has done in your life. A witness does not argue a case from theory — they testify to what they personally experienced.\n\nNo one can argue with your testimony. Your story of how Christ transformed you is uniquely yours and uniquely powerful. The blind man healed by Jesus had simple but devastating testimony: \"I was blind but now I see\" (John 9:25). That kind of first-hand account is disarming." },
          { id: "apologetics", title: "What Is Apologetics?", content: "Apologetics is the reasoned defense of the Christian faith (apologia = defense). 1 Peter 3:15 calls every believer to be ready to give a reason (apologia) for the hope they have.\n\nApologetics is not arguing people into the Kingdom — no one is argued into faith. It is removing intellectual obstacles so that the heart can hear the Gospel. Common topics: the existence of God, the reliability of Scripture, the resurrection, the problem of evil, and the exclusivity of Christ." },
          { id: "both-needed", title: "Testimony and Reason Together", content: "The most powerful evangelism combines both: your personal testimony (the experiential) and a reasoned defense (the intellectual). Paul in Athens engaged the philosophers with reasoned argument (Acts 17:17-31). The healed blind man in John 9 gave testimony. Paul and Silas sang in prison — testimony. Paul reasoned from the Scriptures — apologetics.\n\nLet the Spirit guide which approach is needed. Sometimes it's one, sometimes the other, sometimes both." },
        ],
        reflectionQuestions: [
          "What is your personal testimony of how you came to faith? Can you share it in two minutes?",
          "What are the most common questions or objections you hear from non-believers? Are you prepared to engage them?",
        ],
        prayer: "Lord, give me the words — testimony and reason — to answer the questions around me with gentleness, respect, and truth.",
        assignment: "Write your personal testimony in 300 words: your life before Christ, how you came to faith, and what has changed since. Practice sharing it with your peer guide.",
      },
      {
        id: "m10l04", moduleId: "m10", num: 4, title: "Missions & The Call to Missions",
        memoryVerse: { text: "Ask of me, and I will make the nations your inheritance, the ends of the earth your possession.", ref: "Psalm 2:8" },
        estimatedMinutes: 15,
        sections: [
          { id: "great-commission", title: "The Great Commission", content: "Matthew 28:18-20 is the defining mandate: go, make disciples of all nations, baptize, and teach. This is not the Great Suggestion — it is a command issued by the One who holds all authority.\n\nThe scope is global: \"all nations\" (panta ta ethne) — every people group, every language, every culture. It is not fulfilled until every people group has had access to the Gospel." },
          { id: "unreached", title: "The Unreached", content: "Approximately 3 billion people currently live in people groups with little to no access to the Gospel — the so-called 10/40 Window, where the majority of the world's unreached live. These are not people who have heard and rejected — they are people who have never had access.\n\nThe missions task is not complete. Every generation of the Church must take up this unfinished work." },
          { id: "every-believer", title: "Missions Is Every Believer's Business", content: "Not every believer is called to go as a missionary to another culture. But every believer is called to support the mission — through prayer, through giving, through sending others, through welcoming people of other cultures in your own community.\n\nThe peer-to-peer network is a global missions strategy. Every multiplication of disciples crosses cultural and geographic borders. Your faithfulness in discipling one person is a contribution to the global harvest." },
        ],
        reflectionQuestions: [
          "Have you ever prayed specifically for an unreached people group? Who could you begin to pray for regularly?",
          "How does the existence of 3 billion unreached people affect your sense of urgency in making disciples?",
        ],
        prayer: "Lord of the harvest, raise up workers for every field. Send me where you will, and make me a faithful sender and prayer supporter for those who go.",
        assignment: "Research one unreached people group this week (joshuaproject.net is a good resource). Learn their name, location, population, and spiritual condition. Pray for them daily for one month.",
      },
      {
        id: "m10l05", moduleId: "m10", num: 5, title: "Lifestyle Evangelism",
        memoryVerse: { text: "In the same way, let your light shine before others, that they may see your good deeds and glorify your Father in heaven.", ref: "Matthew 5:16" },
        estimatedMinutes: 14,
        sections: [
          { id: "lifestyle", title: "What Is Lifestyle Evangelism?", content: "Lifestyle evangelism is the ongoing witness of a life lived in alignment with the Gospel — so that non-believers around you are drawn to ask questions about your hope, your character, and the source of your joy.\n\nPeter describes it as having excellent conduct among the Gentiles so that even those who speak against you \"may see your good deeds and glorify God\" (1 Peter 2:12). Your life is a continuous sermon." },
          { id: "relationship", title: "Friendship as the Bridge", content: "Most people come to faith through a relationship with a believer — a friend, a family member, a coworker. Research consistently shows that the relational bridge is more effective than cold contact.\n\nThis means intentional friendship with non-believers is one of the most evangelistically powerful things you can do. It is not manipulation — it is genuine love expressed in genuine relationship, which naturally creates opportunities to share what you believe and why." },
          { id: "lost-condition", title: "Understanding the Condition of the Lost", content: "2 Corinthians 4:4 says the god of this age has blinded the minds of unbelievers. This means they are not just uninterested — they are spiritually unable to see the truth without the Spirit's intervention.\n\nThis changes our posture: from frustration with unbelievers to compassion. They are blind, not malicious. They need light, not argument. Prayer for their eyes to be opened is as important as any technique." },
        ],
        reflectionQuestions: [
          "Who are your genuine friends among non-believers? Are you intentionally maintaining and deepening those relationships?",
          "How does your life — your character, your joy, your integrity — either open or close doors for Gospel conversations?",
        ],
        prayer: "Lord, let my life be a compelling invitation. Help me to love people genuinely, without agenda — and let that love be an irresistible witness to your grace.",
        assignment: "Identify one non-believing friend or neighbor. Plan one meaningful interaction with them this week — not to share the Gospel, but to demonstrate genuine care and interest in their life.",
      },
      {
        id: "m10l06", moduleId: "m10", num: 6, title: "Confrontational Evangelism & Overcoming Fear",
        memoryVerse: { text: "I am not ashamed of the gospel, because it is the power of God that brings salvation to everyone who believes.", ref: "Romans 1:16" },
        estimatedMinutes: 14,
        sections: [
          { id: "confrontational", title: "Direct Gospel Proclamation", content: "Lifestyle evangelism creates opportunities; at some point, a direct Gospel proclamation is required. \"How can they believe in the one of whom they have not heard?\" (Romans 10:14). The Word must be spoken.\n\nDirect evangelism is not aggressive or rude — it is clear. It is saying what you believe, why you believe it, and what it means for the person you are talking with. It requires courage, clarity, and love." },
          { id: "fear", title: "Why We Fear and How to Overcome It", content: "Common fears in evangelism: fear of rejection (\"they will think I'm weird\"), fear of failure (\"what if I say something wrong?\"), fear of inadequacy (\"I don't know enough\"), and fear of damaging the relationship.\n\nAll of these fears are real — and all of them are addressed by the Gospel. If the Gospel is true and people without it face eternity without God, the stakes of NOT sharing are higher than any social awkwardness. Fear of man is a snare (Proverbs 29:25)." },
          { id: "holy-spirit-help", title: "The Spirit Will Help You", content: "Jesus promised: \"When you are brought before synagogues, rulers and authorities, do not worry about how you will defend yourselves or what you will say, for the Holy Spirit will teach you at that time what you should say\" (Luke 12:11-12).\n\nThis is not a license for lazy preparation, but it is a promise of Spirit-empowered assistance in the moment. Show up faithfully. Open your mouth. Trust the Spirit to give you what is needed." },
        ],
        reflectionQuestions: [
          "What is your primary fear around evangelism? How does the Gospel itself address that fear?",
          "Can you recall a time when you sensed the Holy Spirit helping you say the right thing in a Gospel conversation?",
        ],
        prayer: "Lord, let the love I have for the lost be greater than the fear I have of their response. Give me courage, clarity, and the Spirit's help in every Gospel moment.",
        assignment: "This week, make one intentional Gospel statement — not a full presentation, but one clear reference to your faith or to Christ — in a natural conversation with a non-believer.",
      },
      {
        id: "m10l07", moduleId: "m10", num: 7, title: "Practical Evangelism Skills",
        memoryVerse: { text: "Be wise in the way you act toward outsiders; make the most of every opportunity.", ref: "Colossians 4:5" },
        estimatedMinutes: 15,
        sections: [
          { id: "starting", title: "Starting Gospel Conversations", content: "Natural bridges into Gospel conversations: current events (\"How do you make sense of what's happening in the world?\"), life transitions (\"How are you coping with [loss/change]?\"), spiritual questions (\"Do you have any spiritual beliefs?\"), your own story (\"I've been reading something really meaningful — can I share it?\").\n\nListen for open doors. Ask good questions. People reveal their spiritual hunger when someone genuinely asks." },
          { id: "common-objections", title: "Common Objections and Responses", content: "\"I'm a good person.\" — Address by explaining what the standard is (God's holiness, not human comparison).\n\"All religions lead to God.\" — Address by asking what they mean by God and which Jesus they are referring to.\n\"Science disproves religion.\" — Address by distinguishing scientific method from philosophical materialism.\n\"There's too much suffering for God to be good.\" — Address by explaining the cross and the ultimate redemption of suffering.\n\nAlways respond with curiosity, not combativeness." },
          { id: "spirit-empowered", title: "Spirit-Empowered Witness", content: "The ultimate resource for evangelism is not skill but the power of the Holy Spirit. Acts 1:8 says you will receive power when the Holy Spirit comes on you, and you will be my witnesses. The ordering matters: power, then witness.\n\nPray before every Gospel conversation. Ask for open doors (Colossians 4:3), for the right words (Acts 4:29), and for the Spirit to convict (John 16:8). Then step out in faith." },
        ],
        reflectionQuestions: [
          "What are the most common objections you hear from the people in your life? Practice responding to one of them.",
          "How does your dependence on the Holy Spirit show up in your approach to evangelism?",
        ],
        prayer: "Lord, open doors, give me the right words, and let your Spirit convict and draw. I will step through the doors you open.",
        assignment: "Role-play a Gospel conversation with your peer guide — one playing a seeker with common objections, one playing the believer. Switch roles. Practice until it feels natural.",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 11: SPIRITUAL DISCIPLINES
  // ─────────────────────────────────────────
  {
    id: "m11",
    num: 11,
    title: "Spiritual Disciplines",
    description: "Practice the ancient disciplines that train the soul to live in ongoing communion with God.",
    lessons: [
      {
        id: "m11l01", moduleId: "m11", num: 1, title: "Spiritual Disciplines Overview",
        memoryVerse: { text: "Train yourself to be godly. For physical training is of some value, but godliness has value for all things.", ref: "1 Timothy 4:7-8" },
        estimatedMinutes: 14,
        sections: [
          { id: "what-are-disciplines", title: "What Are Spiritual Disciplines?", content: "Spiritual disciplines are the practices that place us in the path of grace — that position us to receive what God offers and to cooperate with what He is doing.\n\nThey do not earn God's favor — they train the soul the way a marathon runner trains the body: not to make running happen but to make it natural, sustainable, and strong. \"Train yourself\" (1 Timothy 4:7) implies intentional, consistent effort." },
          { id: "two-categories", title: "Two Categories", content: "Richard Foster and Dallas Willard identify disciplines in two categories:\n\nDisciplines of Abstinence: practices that require giving something up — solitude, silence, fasting, Sabbath, secrecy, frugality. These create space for God by removing what fills it.\n\nDisciplines of Engagement: practices that involve active participation — study, meditation, prayer, worship, service, confession, submission, guidance, celebration. These actively receive what God offers.\n\nBoth are necessary. Abstinence without engagement produces emptiness. Engagement without abstinence produces busyness." },
          { id: "why-practice", title: "Why Bother?", content: "Jesus practiced spiritual disciplines — He fasted (Matthew 4:2), retreated to solitude (Luke 5:16), worshiped in synagogue (Luke 4:16), and memorized Scripture (Matthew 4:4-10). If the Son of God needed these practices, we certainly do.\n\nThe goal of all disciplines is union with God — living in continuous awareness of and responsiveness to His presence, so that every moment of ordinary life becomes an act of discipleship." },
        ],
        reflectionQuestions: [
          "Which spiritual disciplines do you currently practice consistently? Which are entirely absent from your life?",
          "What is your honest motivation for spiritual discipline — trying to earn something from God, or genuinely wanting more of God?",
        ],
        prayer: "Lord, make me a disciplined disciple. Give me the wisdom to train and the grace to make training joyful rather than obligatory.",
        assignment: "Choose one discipline from each category (abstinence and engagement) that you don't currently practice. Practice each for one week and report what you discover.",
      },
      {
        id: "m11l02", moduleId: "m11", num: 2, title: "Disciplines of Abstinence: Fasting, Sabbath, Secrecy",
        memoryVerse: { text: "When you fast, do not look somber as the hypocrites do, for they disfigure their faces to show others they are fasting.", ref: "Matthew 6:16" },
        estimatedMinutes: 15,
        sections: [
          { id: "fasting", title: "Fasting", content: "Fasting is the voluntary abstinence from food for a spiritual purpose. It is not dieting — it is a deliberate act that creates physical hunger as a reminder to seek God.\n\nJesus said \"when you fast\" not \"if you fast\" (Matthew 6:16-18), implying it as normal practice. Fasting intensifies prayer, humbles the soul, and breaks the dominance of physical appetite. It can be applied to other things (social media, entertainment) but food fasting has a particular physical-spiritual potency." },
          { id: "sabbath", title: "Sabbath", content: "Sabbath is the practice of regular, deliberate rest — one day in seven dedicated to ceasing from work, receiving from God, and enjoying creation. It is the fourth commandment (Exodus 20:8-11) and the most frequently broken commandment in modern culture.\n\nSabbath is radical in a productivity-obsessed world. It declares: I am not what I produce. My worth is not my output. The world can keep spinning without my management. God rested and pronounced it good — so should we." },
          { id: "secrecy", title: "Secrecy", content: "The discipline of secrecy is doing good without announcing it. Jesus warned against performing righteousness to be seen by others (Matthew 6:1-18). Secrecy trains the soul out of the need for human approval and into a single-minded orientation toward God.\n\nWhen you fast secretly, give secretly, serve secretly — and no one knows except God — you discover whether your motivation is love for God or desire for human recognition." },
        ],
        reflectionQuestions: [
          "Have you ever fasted? What was your experience? Did it accomplish its intended purpose?",
          "Is a weekly Sabbath practice realistic in your life? What would need to change for you to honor it?",
        ],
        prayer: "Lord, teach me to fast in secret, rest without guilt, and serve without needing applause. Purify my motivations and simplify my devotion.",
        assignment: "Practice one day of Sabbath this week — no work, no productive output. Rest, worship, and notice what the day reveals about your relationship with busyness.",
      },
      {
        id: "m11l03", moduleId: "m11", num: 3, title: "Disciplines of Engagement: Study & Meditation",
        memoryVerse: { text: "Blessed is the one who does not walk in step with the wicked... but whose delight is in the law of the Lord, and who meditates on his law day and night.", ref: "Psalm 1:1-2" },
        estimatedMinutes: 15,
        sections: [
          { id: "study", title: "The Discipline of Study", content: "Study is the disciplined, intentional engagement of the mind with truth for the purpose of transformation. It goes beyond casual reading — it involves observation (what does it say?), interpretation (what does it mean?), and application (what does it require of me?).\n\nRomans 12:2 commands the renewing of the mind — transformation through the renovation of our thinking patterns. Study is the primary means by which the mind is renewed. You think yourself into new behaviors by thinking new thoughts about God, yourself, and the world." },
          { id: "meditation", title: "Biblical Meditation", content: "Biblical meditation is not the Eastern practice of emptying the mind — it is filling the mind with God's Word and allowing it to saturate your thinking. The Hebrew concept is of a cow chewing cud — returning repeatedly to the same truth, extracting more nourishment with each pass.\n\nPractically: choose one verse or passage. Read it. Pray it. Memorize it. Ask questions of it. Apply it. Return to it throughout the day. Let it become the background music of your thinking." },
          { id: "results", title: "The Results", content: "Psalm 1 describes the results of meditating on God's Word day and night: you become like a tree planted by streams of water, yielding fruit in season, with leaves that do not wither, and prospering in all you do.\n\nThis is not a promise of material success — it is a description of deep-rooted spiritual vitality. The person who meditates on the Word has roots that sustain them through every season, including drought." },
        ],
        reflectionQuestions: [
          "What is the difference between reading the Bible and studying it? Which do you mostly do?",
          "Is there a verse or passage you have meditated on deeply? What did sustained meditation reveal that a quick reading missed?",
        ],
        prayer: "Lord, give me a delight in your Word — not as duty but as nourishment. Let me become like the tree in Psalm 1: deeply rooted, consistently fruitful.",
        assignment: "Choose Psalm 1. Read it every day for seven days. Each day, meditate on one verse — write a journal entry about what you observe, what it means, and how it applies.",
      },
      {
        id: "m11l04", moduleId: "m11", num: 4, title: "Disciplines of Engagement: Prayer, Worship, Service",
        memoryVerse: { text: "Offer your bodies as a living sacrifice, holy and pleasing to God — this is your true and proper worship.", ref: "Romans 12:1" },
        estimatedMinutes: 15,
        sections: [
          { id: "prayer-discipline", title: "Prayer as Discipline", content: "Prayer has been addressed in Module 6. Here we consider it as a discipline — a consistent practice, not an occasional emergency response.\n\nA disciplined prayer life has regularity (the same time, consistently), variety (different forms and postures), and depth (moving from surface requests into genuine communion). The discipline trains the soul to remain in continuous connection with God rather than coming to Him only in crisis." },
          { id: "worship", title: "Worship as Discipline", content: "Worship is ascribing worth to God — declaring through word, song, silence, and deed that He is supremely valuable. As a discipline, it is practiced whether or not we feel it — the posture of worship precedes and produces the feeling of worship.\n\nRomans 12:1 extends worship beyond singing: offering your body as a living sacrifice is \"your true and proper worship.\" Every act of obedience is an act of worship. Every act of service is worship. Every moment of conscious devotion is worship. The discipline is maintaining this awareness throughout ordinary life." },
          { id: "service", title: "Service as Discipline", content: "Service (diakonia) practiced as a spiritual discipline is intentional, self-sacrificial, consistent giving of yourself for the benefit of others — not merely when it's convenient or when you feel like it.\n\nJesus modeled service as the mark of the greatest in the Kingdom (Mark 10:43-44). The discipline of service reshapes the soul — it counteracts the flesh's natural gravitational pull toward self-centeredness and trains the soul in the direction of love." },
        ],
        reflectionQuestions: [
          "How would you describe your current practice of worship outside of Sunday? Is it a lifestyle or only an event?",
          "In what specific ways do you serve others regularly — not as a program but as a discipline of love?",
        ],
        prayer: "Lord, let prayer, worship, and service become the rhythm of my life — not special occasions but ordinary expressions of who I am in you.",
        assignment: "This week, practice one act of anonymous service — serving someone without them knowing who did it. Notice how it feels and what it reveals about your motivation for serving.",
      },
      {
        id: "m11l05", moduleId: "m11", num: 5, title: "Disciplines of Engagement: Confession, Submission, Guidance",
        memoryVerse: { text: "Submit to one another out of reverence for Christ.", ref: "Ephesians 5:21" },
        estimatedMinutes: 14,
        sections: [
          { id: "confession-discipline", title: "Confession as Discipline", content: "Confession (addressed in Module 9) practiced as a regular discipline — not only when crisis forces it — creates a soul that lives in continuous transparency before God and community.\n\nRegular confession prevents the accumulation of hidden sin that slowly hardens the heart. Weekly (or even daily) examination and confession maintains the sensitivity of conscience that makes the Spirit-led life possible." },
          { id: "submission", title: "Submission", content: "The discipline of submission is voluntarily placing yourself under the authority and wisdom of another — a pastor, a mentor, a community — not because they are always right, but because humility is the posture of the Kingdom.\n\nThe autonomous Christian — accountable to no one, accepting correction from no one — is uniquely vulnerable to self-deception. Willful submission to a trusted community is the structural protection against the pride that blinds us to our own blind spots." },
          { id: "guidance", title: "Seeking Guidance", content: "The discipline of guidance is the regular practice of seeking wisdom from God through multiple channels: Scripture, prayer, community, and circumstances — in that order of priority.\n\nGuidance is sought, not merely waited for. \"If any of you lacks wisdom, let him ask God\" (James 1:5). The discipline is building guidance-seeking into regular life rather than only in major decisions. Small choices made with the Spirit's guidance accumulate into a Spirit-directed life." },
        ],
        reflectionQuestions: [
          "To whom are you genuinely accountable — someone who has permission to speak into your life and who does?",
          "How do you make significant decisions? Do you have a reliable process for seeking God's guidance?",
        ],
        prayer: "Lord, make me submissive to your voice in Scripture, in community, and in the wisdom of those you have placed over me. Guard me from the pride that refuses guidance.",
        assignment: "Identify one person in your life whose wisdom you trust. Bring them one genuine question or decision you are facing and ask for their input. Receive it humbly.",
      },
      {
        id: "m11l06", moduleId: "m11", num: 6, title: "Means of Grace & The Fasted Life",
        memoryVerse: { text: "Is not this the kind of fasting I have chosen: to loose the chains of injustice and untie the cords of the yoke, to set the oppressed free?", ref: "Isaiah 58:6" },
        estimatedMinutes: 14,
        sections: [
          { id: "means-of-grace", title: "Means of Grace", content: "Means of grace are the ordinary channels through which God pours His grace into the lives of His people: Scripture, prayer, the Lord's Supper, fellowship, and baptism. They are ordinary — not spectacular — yet they are the primary instruments of transformation.\n\nThe Christian who neglects means of grace while seeking dramatic spiritual experiences is like a person who refuses to eat while praying for health. The means are not magic — but they are God's chosen instruments." },
          { id: "fasted-life", title: "The Fasted Lifestyle", content: "Isaiah 58 contrasts hypocritical fasting (religious performance with no change in behavior) with the genuine fast God chooses: loosing chains of injustice, feeding the hungry, sheltering the poor, and clothing the naked.\n\nThe fasted lifestyle is not about skipping meals — it is about a whole-life orientation of self-denial for the benefit of others and the advancement of justice. It is the integration of spiritual discipline and social engagement." },
          { id: "withdrawal", title: "The Practice of Withdrawal", content: "Jesus regularly withdrew to solitary places (Luke 5:16; Mark 1:35) — not to escape ministry but to be renewed for it. The practice of withdrawal from ordinary activity for the purpose of spiritual renewal is one of the most counter-cultural disciplines available.\n\nIn a world of constant noise, connectivity, and activity, intentional withdrawal is an act of spiritual warfare. It protects the inner life that feeds the outer ministry." },
        ],
        reflectionQuestions: [
          "Which means of grace are most alive in your practice? Which are most neglected?",
          "What would a fasted lifestyle look like in your specific context — in your neighborhood, workplace, and relationships?",
        ],
        prayer: "Lord, let my fasting not be empty ritual but the overflow of a heart genuinely oriented toward your Kingdom and your justice. Let it cost me something.",
        assignment: "Read Isaiah 58 in full. Write a contemporary paraphrase of what this chapter calls you to. What would this look like in your specific context?",
      },
      {
        id: "m11l07", moduleId: "m11", num: 7, title: "Bible Intake Methods & Christian Stewardship",
        memoryVerse: { text: "Bring the whole tithe into the storehouse, that there may be food in my house.", ref: "Malachi 3:10" },
        estimatedMinutes: 15,
        sections: [
          { id: "bible-intake", title: "Methods of Bible Intake", content: "There are five primary ways to take in the Word of God:\n\n1. Hearing — listening to Scripture read or preached (Romans 10:17)\n2. Reading — going through the text personally (1 Timothy 4:13)\n3. Studying — systematic analysis with observation and application\n4. Memorizing — hiding the Word in the heart (Psalm 119:11)\n5. Meditating — dwelling on the Word until it saturates the mind\n\nA healthy diet of Scripture uses all five. Most believers only use one or two. The combination produces extraordinary spiritual strength." },
          { id: "stewardship-time", title: "Stewardship of Time and Gifts", content: "Christian stewardship is the understanding that everything you have — time, talents, treasure — belongs to God and is held in trust. You are a manager, not an owner.\n\nTime: every hour is a resource given by God and held for Kingdom purposes. Talents: your abilities, skills, and opportunities are investments God has made in you, expecting a return (Matthew 25:14-30). How you manage both reveals your actual theology." },
          { id: "stewardship-money", title: "Stewardship of Money: Tithing",
            content: "The tithe (ten percent of income) is the biblical baseline for giving. Malachi 3:10 presents it as the minimum; the New Testament presents grace-motivated generosity as the standard that exceeds the minimum.\n\n2 Corinthians 9:7 describes the New Covenant giver: \"Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver.\" The amount matters less than the heart that gives it. But faithful, consistent, generous giving is a concrete expression of trust in God as provider." },
        ],
        reflectionQuestions: [
          "Which of the five Bible intake methods do you practice? Which do you most need to add?",
          "Are you tithing? If not, what is the real reason — and how does this lesson address that reason?",
        ],
        prayer: "Lord, I hold everything I have loosely — time, gifts, money. You gave it all. I return it joyfully and trust you to multiply what I cannot see.",
        assignment: "For one week, track how you spend your time (work, sleep, entertainment, discipleship, rest, service). At the end of the week, evaluate: does your time reflect your stated priorities? What needs to change?",
      },
    ],
  },

  // ─────────────────────────────────────────
  // MODULE 12: LIVING WITH ETERNITY IN VIEW
  // ─────────────────────────────────────────
  {
    id: "m12",
    num: 12,
    title: "Living With Eternity in View",
    description: "Ground your daily choices in the certainty of Christ's return and the eternal weight of what is unseen.",
    lessons: [
      {
        id: "m12l01", moduleId: "m12", num: 1, title: "Eschatology: Doctrine of Last Things",
        memoryVerse: { text: "For I am convinced that neither death nor life, neither angels nor demons, neither the present nor the future... will be able to separate us from the love of God that is in Christ Jesus our Lord.", ref: "Romans 8:38-39" },
        estimatedMinutes: 14,
        sections: [
          { id: "what-is-eschatology", title: "What Is Eschatology?", content: "Eschatology is the doctrine of last things (eschaton = last). It encompasses everything the Bible reveals about the end of history: the return of Christ, the resurrection of the dead, the final judgment, heaven, and hell.\n\nMany Christians avoid eschatology because it seems confusing, divisive, or irrelevant. But Jesus spoke about the future more than almost any other topic. And Paul argued that eschatology is not merely future information — it is the foundation of present Christian living (Romans 8; 1 Corinthians 15; Philippians 3)." },
          { id: "personal-eschatology", title: "Personal Eschatology", content: "Personal eschatology concerns what happens to individuals at death. At death, the believer's spirit goes immediately into the presence of Christ (\"to depart and be with Christ, which is better by far\" — Philippians 1:23). This is the intermediate state — fully conscious, fully in God's presence, awaiting the bodily resurrection.\n\nThe unbeliever's soul enters a state of conscious separation from God, awaiting final judgment. Death is not the end for either — it is a transition." },
          { id: "why-it-matters", title: "Why Eschatology Matters Now", content: "Paul's extended treatment of resurrection in 1 Corinthians 15 ends: \"Therefore, my dear brothers and sisters, stand firm. Let nothing move you. Always give yourselves fully to the work of the Lord, because you know that your labor in the Lord is not in vain\" (15:58).\n\nEschatology is the foundation of present faithfulness. If this life is all there is, compromise makes sense. If eternity is real and the resurrection is certain, every act of faithfulness has eternal weight. The end reframes the middle." },
        ],
        reflectionQuestions: [
          "How does the certainty of your own resurrection change how you face suffering, disappointment, and death?",
          "Does knowing that your labor in the Lord is 'not in vain' affect the way you approach your daily work and service?",
        ],
        prayer: "Lord, let the certainty of your return and the reality of eternity give weight and direction to every ordinary choice I make today.",
        assignment: "Read 1 Corinthians 15 in one sitting. Write down every 'therefore' and 'because' in the chapter — note how Paul connects the resurrection to present behavior.",
      },
      {
        id: "m12l02", moduleId: "m12", num: 2, title: "The Return of Christ",
        memoryVerse: { text: "Look, he is coming with the clouds, and every eye will see him, even those who pierced him.", ref: "Revelation 1:7" },
        estimatedMinutes: 14,
        sections: [
          { id: "certainty", title: "The Certainty of His Return", content: "Jesus promised He would return (John 14:3; Matthew 24:30). Angels at His ascension promised it (Acts 1:11). Every New Testament book except Philemon references it. The Lord's Supper proclaims it (\"until he comes\" — 1 Corinthians 11:26).\n\nThe return of Christ is the most promised future event in Scripture. Its certainty is not in question — only its timing. \"Heaven and earth will pass away, but my words will never pass away\" (Matthew 24:35)." },
          { id: "nature", title: "The Nature of His Return", content: "Christ's return will be personal — He Himself will return, not a representative (Acts 1:11). It will be visible — \"every eye will see him\" (Revelation 1:7). It will be bodily — He will return as He ascended, in a glorified human body (Acts 1:11). It will be glorious — He comes \"in clouds with great power and glory\" (Mark 13:26).\n\nThe first coming was in humility; the second coming is in majesty. He comes not as a suffering servant but as the reigning King." },
          { id: "unknown-timing", title: "The Unknown Timing", content: "Jesus was explicit: \"But about that day or hour no one knows, not even the angels in heaven, nor the Son, but only the Father\" (Matthew 24:36). Every attempt to set dates for Christ's return has been wrong and has embarrassed the Church.\n\nThe appropriate response to unknown timing is not speculation but readiness. \"Therefore keep watch, because you do not know on what day your Lord will come\" (Matthew 24:42). Readiness means living now the way you would want to be found living when He arrives." },
        ],
        reflectionQuestions: [
          "If Jesus returned today, what would you wish you had done differently? What would you wish you had done more?",
          "How does the \"unknown timing\" of Christ's return change how you approach your daily schedule and priorities?",
        ],
        prayer: "Come, Lord Jesus. And until you come, find me faithful — busy with your business, loving your people, awaiting your arrival.",
        assignment: "Read Matthew 24-25. Jesus' teaching on the end times ends with three parables about readiness (the servant, the ten virgins, the talents). What does each parable say about the relationship between the Lord's return and how we live now?",
      },
      {
        id: "m12l03", moduleId: "m12", num: 3, title: "The Rapture & The Second Coming",
        memoryVerse: { text: "For the Lord himself will come down from heaven, with a loud command, with the voice of the archangel and with the trumpet call of God, and the dead in Christ will rise first.", ref: "1 Thessalonians 4:16" },
        estimatedMinutes: 15,
        sections: [
          { id: "rapture", title: "The Rapture", content: "The rapture refers to the catching up of believers to meet the Lord (1 Thessalonians 4:16-17; 1 Corinthians 15:51-52). Paul describes it as happening \"in a flash, in the twinkling of an eye\" — sudden, instantaneous, complete.\n\nThe timing of the rapture relative to the tribulation (pre, mid, or post) is one of the most debated questions in evangelical eschatology. Christians of good faith hold different positions. The key fact is not the timing but the fact: Christ will gather His people to Himself." },
          { id: "second-coming", title: "The Second Coming (Glorious Appearing)", content: "The second coming (parousia = arrival, presence) is Christ's visible, glorious return to earth as King. Every eye will see Him (Revelation 1:7). He comes to judge the nations, defeat evil, and establish His Kingdom in its fullness.\n\nRevelation 19:11-16 describes it: the heavens open, He appears on a white horse, called Faithful and True, judging in righteousness. The armies of heaven follow Him. He rules with iron authority. The enemies of God are defeated." },
          { id: "living-with-hope", title: "Living With Blessed Hope", content: "Titus 2:13 calls the second coming \"the blessed hope\" — the joyful certainty that Christ will return to set everything right. This hope is not passive wishful thinking — it is an active, purifying force.\n\n1 John 3:2-3: \"When Christ appears, we shall be like him... All who have this hope in him purify themselves, just as he is pure.\" Hope in Christ's return produces present purity. The expectation of seeing Him as He is motivates becoming more like Him now." },
        ],
        reflectionQuestions: [
          "How does the hope of Christ's return affect your sense of urgency in making disciples?",
          "Do you hold your specific view of the rapture's timing with humility, recognizing that sincere believers disagree?",
        ],
        prayer: "Lord Jesus, I live in the tension between your first coming and your second. Let the blessed hope purify me and motivate me. Come quickly.",
        assignment: "Write a personal creed about the return of Christ — what you believe, why you believe it from Scripture, and how it affects how you live. Keep it to one page.",
      },
      {
        id: "m12l04", moduleId: "m12", num: 4, title: "The Resurrection & Resurrection Body",
        memoryVerse: { text: "But Christ has indeed been raised from the dead, the firstfruits of those who have fallen asleep.", ref: "1 Corinthians 15:20" },
        estimatedMinutes: 15,
        sections: [
          { id: "bodily-resurrection", title: "The Bodily Resurrection", content: "The Christian hope is not for the immortality of the soul (the Greek philosophical idea) but for the resurrection of the body. The whole person — body and soul — will be raised. The body is not a prison from which the soul escapes — it is the intended home of the person, glorified and incorruptible.\n\nJesus' resurrection is the template. His resurrection body could be touched (John 20:27), ate food (Luke 24:42-43), and bore the marks of the cross (John 20:27) — yet could appear in closed rooms (John 20:19) and was not immediately recognized (Luke 24:16)." },
          { id: "transformation", title: "The Transformation", content: "1 Corinthians 15:42-44 describes the transformation: sown in dishonor, raised in glory; sown in weakness, raised in power; sown a natural body, raised a spiritual body.\n\nThe resurrection body is not ghostly or immaterial — \"spiritual\" means energized and sustained by the Spirit, not non-physical. It is the current body transformed, not replaced. The continuity between your present body and your resurrection body is like the continuity between a seed and the plant it becomes." },
          { id: "everything-changes", title: "Why the Resurrection Changes Everything", content: "If the resurrection is true, then:\n• Death is not the end — it is the door to greater life.\n• The body matters — it will be raised and matters eternally.\n• Present suffering is not meaningless — it is producing glory (2 Corinthians 4:17).\n• Christian service is never wasted — the labor is not in vain (1 Corinthians 15:58).\n• The future is not uncertain — its shape is already revealed in the resurrection of Christ.\n\nIf the resurrection is false, \"let us eat and drink, for tomorrow we die\" (1 Corinthians 15:32) — nothing has meaning and everything is permissible." },
        ],
        reflectionQuestions: [
          "How does the bodily resurrection change how you think about your physical body and your physical world?",
          "Has belief in the resurrection ever comforted you in the face of death — your own or someone you love? Share that experience.",
        ],
        prayer: "Lord, the same Spirit who raised Jesus from the dead lives in me (Romans 8:11). Let that power be real in me today.",
        assignment: "Read 1 Corinthians 15 in full. Identify Paul's primary argument for the resurrection. What would he say to someone who doubted it?",
      },
      {
        id: "m12l05", moduleId: "m12", num: 5, title: "The Judgment",
        memoryVerse: { text: "For we must all appear before the judgment seat of Christ, so that each of us may receive what is due us for the things done while in the body, whether good or bad.", ref: "2 Corinthians 5:10" },
        estimatedMinutes: 15,
        sections: [
          { id: "two-judgments", title: "Two Different Judgments", content: "The Bible describes two distinct judgments at the end of history:\n\n1. The Judgment Seat of Christ (Bema Seat — 2 Corinthians 5:10; Romans 14:10): for believers only, evaluating deeds done in the body. Salvation is not at stake — the believer's standing is secure. What is evaluated is the quality and faithfulness of service, resulting in rewards or loss of rewards.\n\n2. The Great White Throne Judgment (Revelation 20:11-15): for the unbelieving dead, judging them according to their works. This results in the second death for all whose names are not in the Book of Life." },
          { id: "believers-judgment", title: "The Believer's Judgment", content: "The Bema Seat is not about condemnation — there is no condemnation for those in Christ (Romans 8:1). It is an accountability for stewardship. Every believer will give an account for how they used the time, talents, and resources entrusted to them.\n\nPaul uses the metaphor of building (1 Corinthians 3:10-15): some build with gold, silver, and precious stones — materials that endure fire. Others build with wood, hay, and straw — consumed by fire. The builder is saved, but the work may be lost." },
          { id: "eternal-weight", title: "The Eternal Weight of Now", content: "2 Corinthians 4:17 calls present suffering \"light and momentary troubles\" that are achieving for us an \"eternal glory that far outweighs them all.\" The contrast is staggering: light vs. heavy, momentary vs. eternal.\n\nEvery act of faithfulness — every prayer, every act of service, every disciple made, every moment of obedience — carries eternal weight. Nothing is wasted. Nothing is neutral. The judgment makes every moment matter." },
        ],
        reflectionQuestions: [
          "If your life were evaluated at the Bema Seat today, what would the quality of your service reveal about your priorities?",
          "How does knowing you will give an account for your stewardship change how you approach ordinary tasks?",
        ],
        prayer: "Lord, let me live in light of the Bema Seat — building with gold, silver, and precious stones rather than with wood, hay, and straw. Let every act be an act of love for you.",
        assignment: "Write a personal accountability inventory: What has God entrusted to you (time, gifts, resources, relationships)? How are you currently managing each? What needs to change?",
      },
      {
        id: "m12l06", moduleId: "m12", num: 6, title: "Heaven & The New Creation",
        memoryVerse: { text: "He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.", ref: "Revelation 21:4" },
        estimatedMinutes: 15,
        sections: [
          { id: "what-is-heaven", title: "What Is Heaven?", content: "Heaven is the dwelling place of God — fully present, fully glorious, fully good. It is not a disembodied, cloudy existence but a real place of real relationships, real community, real work, and real worship.\n\nThe New Testament's primary description of our ultimate home is not \"heaven\" but the New Earth (Revelation 21-22) — the renewed, restored creation, where heaven and earth become one and God dwells permanently with His people." },
          { id: "new-creation", title: "New Heavens and New Earth", content: "Revelation 21:1 describes \"a new heaven and a new earth, for the first heaven and the first earth had passed away.\" This is not the destruction of creation but its renewal — the same way the resurrection body is the transformed current body.\n\nRomans 8:21 says creation itself will be \"liberated from its bondage to decay.\" The whole created order — not just souls but matter, space, and time — will be renewed. The curse of Genesis 3 will be completely reversed." },
          { id: "what-we-will-do", title: "What We Will Do", content: "Heaven is not eternal inactivity. Revelation 22:3 says \"his servants will serve him.\" We will worship (Revelation 19:6-9), reign with Christ (Revelation 22:5; 2 Timothy 2:12), and engage in the work of stewarding the new creation.\n\nEverything you have become in Christ — every discipline cultivated, every lesson learned, every character formed — is not left behind at death. It is carried forward into the new creation, where it will be put to full use in a world where everything works as God intended." },
        ],
        reflectionQuestions: [
          "How does the picture of the new creation (physical, relational, active) differ from the vague, disembodied heaven of popular imagination?",
          "What hopes and longings do you carry for the new creation — what are you most looking forward to?",
        ],
        prayer: "Come, Lord Jesus. Make all things new — starting with me, and ending with the whole creation. Let your hope anchor every storm I sail through.",
        assignment: "Read Revelation 21-22. Make a list of every specific description of the new creation. Then write about which aspects you most look forward to and why.",
      },
      {
        id: "m12l07", moduleId: "m12", num: 7, title: "Hell, The Millennium & Eternal Perspective",
        memoryVerse: { text: "Set your minds on things above, not on earthly things.", ref: "Colossians 3:2" },
        estimatedMinutes: 16,
        sections: [
          { id: "hell", title: "The Reality of Hell",
            content: "Hell is the most sobering teaching in Scripture — and Jesus spoke about it more than anyone else in the New Testament. It is described as outer darkness (Matthew 8:12), eternal fire (Matthew 25:41), the second death (Revelation 20:14), and conscious, eternal separation from God (2 Thessalonians 1:9).\n\nHell is not God's revenge — it is the just consequence of choosing, to the very end, to reject the One who is Life. Those in hell have been given exactly what they chose: existence without God. This reality is one of the most powerful motivations for evangelism." },
          { id: "millennium", title: "The Millennium",
            content: "Revelation 20:1-6 describes a thousand-year reign of Christ. Three primary views: Premillennialism (Christ returns before the millennium and reigns physically on earth for a literal 1,000 years), Amillennialism (the millennium is the present church age, Christ's spiritual reign), and Postmillennialism (the Gospel will transform the world before Christ returns).\n\nThis is a secondary theological issue — sincere, Scripture-believing Christians hold all three views. Unity is found in what all agree: Christ will return, evil will be defeated, and God will reign forever." },
          { id: "eternal-perspective", title: "Living With Eternal Perspective",
            content: "The whole purpose of eschatology is not information but transformation. Colossians 3:2 commands: \"Set your minds on things above.\" This is a deliberate reorientation of attention — keeping eternity in view while living fully in the present.\n\nThe person who lives with eternal perspective is not a dreamy idealist who ignores the present — they are the most realistic person in the room, the one who sees what is truly happening, what truly matters, and what will truly last. This is the vantage point from which the whole Christian life is lived most fully." },
        ],
        reflectionQuestions: [
          "How does the reality of hell affect your urgency and compassion in evangelism?",
          "What would it look like to have an 'eternal perspective' in your most pressing practical concern right now?",
        ],
        prayer: "Lord, set my mind on things above. Let eternity reframe my present — my fears, my ambitions, my priorities, my relationships — so that I live from the vantage point of your Kingdom.",
        assignment: "Write your life mission statement in light of eternity. Not a career plan — a Kingdom plan: why you are here, what you are building, and what will last when everything else is burned away.",
      },
    ],
  },
];

export function getLessonById(lessonId: string): CurriculumLesson | undefined {
  for (const mod of CURRICULUM) {
    const lesson = mod.lessons.find((l) => l.id === lessonId);
    if (lesson) return lesson;
  }
  return undefined;
}

export function getModuleById(moduleId: string): CurriculumModule | undefined {
  return CURRICULUM.find((m) => m.id === moduleId);
}

export function getTotalLessonCount(): number {
  return CURRICULUM.reduce((sum, m) => sum + m.lessons.length, 0);
}
