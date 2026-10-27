import { APP_SCHEME } from "@/lib/sharing";

// Sharing a Kingdom Story into a P2P chat. The message is ordinary text
// (title, number, link) sent through the normal message insert, so the
// database's own rules decide who may post where (membership, blocks,
// safeguarding) and notifications go out as for any message. Nothing about
// the sender's progress, notes or answers is included.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const STORY_LINK_RE = new RegExp(`${APP_SCHEME}://kingdom-stories/(${UUID})`, "i");

export function storyLink(storyId: string) { return `${APP_SCHEME}://kingdom-stories/${storyId}`; }

export function storyShareMessage(story: { id: string; title: string; subtitle?: string | null; topicNumber?: number | null }): string {
  const num = story.topicNumber ? `Topic ${String(story.topicNumber).padStart(3, "0")} · ` : "";
  return `📖 Kingdom Story — ${num}${story.title}${story.subtitle ? `\n${story.subtitle}` : ""}\n${storyLink(story.id)}`;
}

/** The story a chat message links to, if any (for the "Open story" button). */
export function storyIdInMessage(body: string | null | undefined): string | null {
  const m = (body ?? "").match(STORY_LINK_RE);
  return m ? m[1].toLowerCase() : null;
}

type Insertable = { from: (t: string) => { insert: (row: Record<string, unknown>) => { select: (c: string) => { single: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> } } } };
function newId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16); });
}

/** Sends through the same insert the chat screen uses (RLS: members only). */
export async function sendStoryToChat(client: Insertable, p: { conversationId: string; senderId: string; body: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client.from("p2p_messages")
    .insert({ id: newId(), conversation_id: p.conversationId, sender_id: p.senderId, body: p.body, reply_to_message_id: null })
    .select("id").single();
  if (!error) return { ok: true };
  if (/row-level security|permission|policy/i.test(error.message ?? "")) return { ok: false, error: "You can't post in that chat." };
  return { ok: false, error: "That didn't send. Please try again." };
}
