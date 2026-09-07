import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_TOGETHER_AUDIO_PREFS, type TogetherAudioPrefs } from "./types";

// A single local-only JSON blob — no database column, per this feature's
// explicit "these are local preferences, don't add unnecessary database
// columns" requirement. Same AsyncStorage-key-per-blob convention already
// used by ThemeContext.tsx for App Style prefs.
const STORAGE_KEY = "p2p_together_audio_prefs";

export async function loadTogetherAudioPrefs(): Promise<TogetherAudioPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TOGETHER_AUDIO_PREFS;
    const parsed = JSON.parse(raw);
    return {
      outputVolume: typeof parsed.outputVolume === "number" ? parsed.outputVolume : DEFAULT_TOGETHER_AUDIO_PREFS.outputVolume,
      mediaVolume: typeof parsed.mediaVolume === "number" ? parsed.mediaVolume : DEFAULT_TOGETHER_AUDIO_PREFS.mediaVolume,
      roomVolume: typeof parsed.roomVolume === "number" ? parsed.roomVolume : DEFAULT_TOGETHER_AUDIO_PREFS.roomVolume,
      participantVolumes: parsed.participantVolumes && typeof parsed.participantVolumes === "object" ? parsed.participantVolumes : {},
      mutedParticipants: Array.isArray(parsed.mutedParticipants) ? parsed.mutedParticipants : [],
    };
  } catch {
    return DEFAULT_TOGETHER_AUDIO_PREFS;
  }
}

export async function saveTogetherAudioPrefs(prefs: TogetherAudioPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Local persistence failing (e.g. storage full) shouldn't break the
    // mixer itself — the in-memory state this session still works fine.
  }
}