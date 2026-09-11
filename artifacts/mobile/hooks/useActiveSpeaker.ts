import { useCallback, useRef, useState } from "react";

const SPEAKING_VOLUME_THRESHOLD = 5; // matches the existing threshold already used to filter audio.tsx's own volume-indication debug log
const SPEAKER_SWITCH_HYSTERESIS_MS = 1200; // a new candidate must stay loudest for this long before the center actually moves

export interface VolumeSample { uid?: number; volume?: number }

// Presentation-layer only. Consumes the existing, UNMODIFIED Agora
// onAudioVolumeIndication callback (already wired into audio.tsx/video.tsx
// via useAgoraEngine's eventHandler — previously only console.logged, the
// underlying Agora volume-indication implementation is untouched here).
// Turns raw per-tick volume samples into a smooth "who is centered right
// now" signal for the P2P participant orbit:
//   - the center only moves when a different participant has been clearly
//     louder for a short sustained window (avoids flicker from brief
//     background noise/breathing);
//   - once someone has spoken, the center never reverts to "nobody" —
//     speakingUids (used for the glow/pulse ring) empties out and fades,
//     but the LAST active speaker stays centered, matching "fades rather
//     than disappearing abruptly" instead of an abrupt re-center.
// uid 0 is the existing self-tile sentinel already used throughout this
// codebase (ParticipantGrid.tsx, video.tsx's group grid `{ uid: 0, isSelf:
// true, ... }`) — Agora's own volume-indication callback also reports the
// local participant as uid 0, so no remapping is needed here.
export function useActiveSpeaker() {
  const [activeUid, setActiveUid] = useState<number | null>(null);
  const [speakingUids, setSpeakingUids] = useState<ReadonlySet<number>>(new Set());
  const lastSwitchAtRef = useRef(0);
  const activeUidRef = useRef<number | null>(null);
  activeUidRef.current = activeUid;

  const reportVolume = useCallback((speakers: VolumeSample[]) => {
    const loud = (speakers ?? [])
      .map((s) => ({ uid: s.uid ?? 0, volume: s.volume ?? 0 }))
      .filter((s) => s.volume > SPEAKING_VOLUME_THRESHOLD);

    setSpeakingUids(new Set(loud.map((s) => s.uid)));
    if (loud.length === 0) return;

    const loudest = loud.reduce((a, b) => (b.volume > a.volume ? b : a));
    if (loudest.uid === activeUidRef.current) return;

    const now = Date.now();
    if (now - lastSwitchAtRef.current < SPEAKER_SWITCH_HYSTERESIS_MS) return;
    lastSwitchAtRef.current = now;
    setActiveUid(loudest.uid);
  }, []);

  // A participant leaving shouldn't leave the orbit centered on someone
  // who is no longer here.
  const clearIfActive = useCallback((uid: number) => {
    if (activeUidRef.current === uid) setActiveUid(null);
    setSpeakingUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }, []);

  return { activeUid, speakingUids, reportVolume, clearIfActive };
}
