export interface YouTubePlayerProps {
  externalId: string;
  isPlaying: boolean;
  // The position (ms) to seek to, and a key that changes exactly when a
  // real server-side command happened (session.playbackBaseServerTime) —
  // the player resyncs when syncKey changes, not on a continuous polling
  // loop. That's a deliberate v1 simplification: correct on every real
  // PLAY/PAUSE/SEEK/MEDIA_CHANGE event (including the first mount, which
  // covers late-join sync) rather than fighting the embedded YouTube
  // player's own position continuously.
  syncPositionMs: number;
  syncKey: string;
  onError: (message: string) => void;
}

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