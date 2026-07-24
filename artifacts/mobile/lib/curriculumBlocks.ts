export type BlockType =
  | "heading" | "paragraph" | "scripture" | "memory_verse" | "reflection_question"
  | "assignment" | "checkpoint" | "image" | "video_link" | "audio_link"
  | "divider" | "callout" | "quote" | "key_point" | "glossary_term";

export interface LessonBlock {
  id: string;
  lesson_id: string;
  block_type: BlockType;
  content: Record<string, any>;
  order_index: number;
  is_required: boolean;
  is_submittable: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface BlockTypeMeta {
  type: BlockType;
  label: string;
  icon: string; // Ionicons name
  section: "Text" | "Scripture" | "Learning" | "Media" | "Layout";
  shortcut?: string;
  defaultContent: () => Record<string, any>;
}

export const BLOCK_TYPE_META: Record<BlockType, BlockTypeMeta> = {
  heading: {
    type: "heading", label: "Heading", icon: "text", section: "Text", shortcut: "H",
    defaultContent: () => ({ text: "", level: 2 }),
  },
  paragraph: {
    type: "paragraph", label: "Paragraph", icon: "reader-outline", section: "Text", shortcut: "P",
    defaultContent: () => ({ text: "" }),
  },
  callout: {
    type: "callout", label: "Callout", icon: "megaphone-outline", section: "Text",
    defaultContent: () => ({ text: "", style: "info" }),
  },
  quote: {
    type: "quote", label: "Quote", icon: "chatbox-outline", section: "Text",
    defaultContent: () => ({ text: "", attribution: "" }),
  },
  key_point: {
    type: "key_point", label: "Key Point", icon: "key-outline", section: "Text", shortcut: "K",
    defaultContent: () => ({ text: "" }),
  },
  scripture: {
    type: "scripture", label: "Scripture", icon: "book-outline", section: "Scripture", shortcut: "S",
    defaultContent: () => ({ reference: "", text: "", translation: "" }),
  },
  memory_verse: {
    type: "memory_verse", label: "Memory Verse", icon: "bookmark-outline", section: "Scripture", shortcut: "M",
    defaultContent: () => ({ reference: "", text: "", translation: "" }),
  },
  reflection_question: {
    type: "reflection_question", label: "Reflection Question", icon: "help-circle-outline", section: "Learning", shortcut: "R",
    defaultContent: () => ({ question: "" }),
  },
  assignment: {
    type: "assignment", label: "Assignment", icon: "clipboard-outline", section: "Learning", shortcut: "A",
    defaultContent: () => ({ title: "", instructions: "", due_after_days: 7, questions: [] }),
  },
  checkpoint: {
    type: "checkpoint", label: "Checkpoint", icon: "checkmark-done-outline", section: "Learning", shortcut: "C",
    defaultContent: () => ({ text: "" }),
  },
  glossary_term: {
    type: "glossary_term", label: "Glossary Term", icon: "library-outline", section: "Learning",
    defaultContent: () => ({ term: "", definition: "" }),
  },
  image: {
    type: "image", label: "Image", icon: "image-outline", section: "Media", shortcut: "I",
    defaultContent: () => ({ url: "", caption: "", alt: "" }),
  },
  video_link: {
    type: "video_link", label: "Video Link", icon: "videocam-outline", section: "Media",
    defaultContent: () => ({ url: "", title: "" }),
  },
  audio_link: {
    type: "audio_link", label: "Audio", icon: "musical-notes-outline", section: "Media",
    defaultContent: () => ({ url: "", title: "" }),
  },
  divider: {
    type: "divider", label: "Divider", icon: "remove-outline", section: "Layout",
    defaultContent: () => ({}),
  },
};

export const BLOCK_SECTIONS: BlockTypeMeta["section"][] = ["Text", "Scripture", "Learning", "Media", "Layout"];

// The 9 most common block types, for the quick-action toolbar.
export const QUICK_TOOLBAR_TYPES: BlockType[] = [
  "paragraph", "memory_verse", "reflection_question", "assignment",
  "heading", "callout", "key_point", "image", "checkpoint",
];

// Publish requires at least one of each of these (mirrors the DB trigger
// p2p_check_lesson_publishable added in migration 039).
export const PUBLISH_REQUIRED_TYPES: BlockType[] = ["paragraph", "memory_verse", "reflection_question", "assignment"];

export function checkPublishRequirements(blocks: LessonBlock[]): { ok: boolean; missing: BlockType[] } {
  const present = new Set(blocks.map((b) => b.block_type));
  const missing = PUBLISH_REQUIRED_TYPES.filter((t) => {
    if (t === "memory_verse") {
      return !blocks.some((b) => b.block_type === "memory_verse" && (b.content?.text ?? "").trim() !== "");
    }
    return !present.has(t);
  });
  return { ok: missing.length === 0, missing };
}

export function estimateReadingMinutes(blocks: LessonBlock[]): number {
  const WORDS_PER_MINUTE = 200;
  let words = 0;
  for (const b of blocks) {
    const text: string =
      b.content?.text ?? b.content?.question ?? b.content?.instructions ?? b.content?.definition ?? "";
    words += text.split(/\s+/).filter(Boolean).length;
  }
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
