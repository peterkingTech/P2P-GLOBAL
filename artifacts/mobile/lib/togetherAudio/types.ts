// TogetherAudio — the client-side audio mixer abstraction for P2P
// Together. Kept as pure data + pure functions (mixer.ts) precisely so it
// stays testable without a real audio sink, and so a future Voice Space
// integration (Phase 8, Agora) only ever needs to READ
// effectiveParticipantVolume() — it never needs to know this layer exists.
//
// Personal (per-participant) volumes are intentionally never sent to the
// server: "Peter turned John down for himself" is meaningless to anyone
// but Peter, so it lives in AsyncStorage only (see storage.ts).
export interface TogetherAudioPrefs {
  outputVolume: number; // 0-1 — master, scales everything below it
  mediaVolume: number; // 0-1 — Shared Media (YouTube/expo-av)
  roomVolume: number; // 0-1 — Voice Space as a group
  participantVolumes: Record<string, number>; // userId -> 0-1, local-only
  mutedParticipants: string[]; // userId[] (array, not Set — JSON-serializable)
}

export const DEFAULT_TOGETHER_AUDIO_PREFS: TogetherAudioPrefs = {
  outputVolume: 1,
  mediaVolume: 0.75,
  roomVolume: 0.6,
  participantVolumes: {},
  mutedParticipants: [],
};

export const VOLUME_STEP = 0.05; // one accessibility increment/decrement — never a sudden jump