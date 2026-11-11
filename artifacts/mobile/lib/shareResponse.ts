// "Share Your Response" for one Comprehensive Check question (owner request 2026-11-09 for Kingdom Stories;
// 2026-11-10 for every Comprehensive Check — lessons, Family Circle and Church too).
// Shares ONE question and the participant's own submitted answer — exactly as submitted — with the story
// or lesson title and P2P Global attribution, through the device's share sheet. Only when the participant taps it; it
// never calls the API, so it cannot change the submission, its evaluation or any progress. Evaluator
// feedback, review status and anyone else's information are never included.
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

export interface ResponseShare {
  /** The story or lesson title. */
  storyTitle: string;
  /** Named after the title: "Kingdom Stories" (the default), "Comprehensive Check", … */
  source?: string | null;
  /** e.g. "Chapter 1: Before Everything: In the Beginning" */
  chapterLabel?: string | null;
  question: string;
  /** The participant's submitted written answer, unchanged. */
  response: string;
}

/** The text that is shared. The answer is included exactly as written (only surrounding blank space trimmed). */
export function responseShareText(r: ResponseShare): string {
  return [
    `${r.storyTitle.trim()} — ${r.source?.trim() || "Kingdom Stories"}`,
    r.chapterLabel?.trim() || null,
    "",
    "Question:",
    r.question.trim(),
    "",
    "My response:",
    r.response.replace(/^\s+|\s+$/g, ""),
    "",
    "Shared from P2P Global",
  ].filter((l) => l !== null).join("\n");
}

/** A submitted answer that can be shared: written text that isn't empty. */
export function shareableResponse(textContent: string | null | undefined): string | null {
  const t = typeof textContent === "string" ? textContent : "";
  return t.trim() ? t : null;
}

/**
 * Opens the device's share sheet. Where a browser has no share sheet, the text is copied instead.
 * Resolves "shared" | "copied" | "dismissed".
 */
export async function shareResponse(r: ResponseShare): Promise<"shared" | "copied" | "dismissed"> {
  const message = responseShareText(r);
  if (Platform.OS === "web" && typeof navigator !== "undefined" && !(navigator as { share?: unknown }).share) {
    await Clipboard.setStringAsync(message);
    return "copied";
  }
  try {
    const res = await Share.share({ message, title: r.storyTitle });
    return res.action === Share.dismissedAction ? "dismissed" : "shared";
  } catch {
    return "dismissed";
  }
}
