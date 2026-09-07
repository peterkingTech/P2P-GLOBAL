export interface YouTubePlayerProps {
  externalId: string;
  isPlaying: boolean;
  // The raw server-anchored clock (matches p2p_family_worship_sessions'
  // own fields exactly) — the player computes "expected position right
  // now" itself, both immediately (on mount / whenever a real command
  // changes baseServerTimeIso or isPlaying — this also covers join-in-
  // progress, since mounting always computes the current expected
  // position) and periodically thereafter (see DRIFT_* below), rather
  // than being handed a single stale snapshot.
  basePositionMs: number;
  baseServerTimeIso: string;
  playbackRate: number;
  volume: number; // 0-1 — TogetherAudio's effective Media volume
  // Bumping this forces an immediate resync to the currently-computed
  // expected position — the "Return to Live" tap target's actual effect.
  // A plain number rather than a callback/ref so it composes with the
  // same prop-driven resync effect the mount/command paths already use.
  resyncNonce?: number;
  // Fires true when a periodic check finds a large-enough gap to be
  // user-visible (drives the worship screen's "Return to Live" banner),
  // false once back in sync. Distinct from the smaller auto-correct
  // threshold below — the banner is for "you clearly fell behind
  // (backgrounded, buffered)", not every few-hundred-ms wobble.
  onDriftStatus?: (isBehind: boolean) => void;
  onEnded?: () => void;
  onError: (message: string) => void;
}

export const NOTICEABLE_DRIFT_THRESHOLD_MS = 4000;

// Companions' embedded players naturally drift from buffering, ads, or a
// manual scrub — checked periodically and corrected only when the gap is
// large enough to matter, so ordinary network jitter never causes a
// visible seek. The interval is longer and the threshold looser than the
// legacy raw-file player's (4s / 1.5s) because a YouTube embed has more
// inherent latency than a direct file stream.
export const DRIFT_CHECK_INTERVAL_MS = 5000;
export const DRIFT_THRESHOLD_MS = 2500;

// YouTube's own documented iframe API error codes.
export function describeYouTubeError(code: number): string {
  switch (code) {
    case 2: return "That video link isn't valid.";
    case 5: return "This video can't be played in this app.";
    case 100: return "That video isn't available anymore.";
    case 101:
    case 150: return "The video's owner has disabled playback outside YouTube.";
    default: return "This video couldn't be loaded.";
  }
}