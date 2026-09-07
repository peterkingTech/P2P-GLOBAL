// storage.ts imports @react-native-async-storage/async-storage, a native
// module Node can't load directly (unlike mixer.ts, tested for real in
// test_together_audio_mixer.mjs). This verbatim-copies storage.ts's
// parse/merge/default logic against an in-memory AsyncStorage mock — same
// approach as this session's earlier YouTube-provider logic test, for the
// same reason. Keep this in sync by hand if storage.ts's shape changes.
const DEFAULT_TOGETHER_AUDIO_PREFS = {
  outputVolume: 1, mediaVolume: 0.75, roomVolume: 0.6, participantVolumes: {}, mutedParticipants: [],
};

function makeMockAsyncStorage() {
  const store = new Map();
  return {
    getItem: async (k) => store.has(k) ? store.get(k) : null,
    setItem: async (k, v) => { store.set(k, v); },
  };
}

async function loadTogetherAudioPrefs(AsyncStorage, STORAGE_KEY) {
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
async function saveTogetherAudioPrefs(AsyncStorage, STORAGE_KEY, prefs) {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* local-only, non-fatal */ }
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); fail++; }
}

const KEY = "p2p_together_audio_prefs";

{
  const AsyncStorage = makeMockAsyncStorage();
  const loaded = await loadTogetherAudioPrefs(AsyncStorage, KEY);
  check("nothing persisted yet -> returns defaults", JSON.stringify(loaded) === JSON.stringify(DEFAULT_TOGETHER_AUDIO_PREFS), loaded);
}
{
  const AsyncStorage = makeMockAsyncStorage();
  const written = { outputVolume: 0.8, mediaVolume: 0.5, roomVolume: 0.3, participantVolumes: { peter: 0.9 }, mutedParticipants: ["mary"] };
  await saveTogetherAudioPrefs(AsyncStorage, KEY, written);
  const loaded = await loadTogetherAudioPrefs(AsyncStorage, KEY);
  check("round-trip save -> load preserves every field exactly", JSON.stringify(loaded) === JSON.stringify(written), { written, loaded });
}
{
  // A second, independent "app open" (fresh mock, same underlying key) simulates a real restart.
  const AsyncStorage = makeMockAsyncStorage();
  await AsyncStorage.setItem(KEY, JSON.stringify({ outputVolume: 0.4, mediaVolume: 0.6, roomVolume: 0.6, participantVolumes: {}, mutedParticipants: [] }));
  const loaded = await loadTogetherAudioPrefs(AsyncStorage, KEY);
  check("preferences survive a simulated app restart (fresh load from the same stored key)", loaded.outputVolume === 0.4, loaded);
}
{
  const AsyncStorage = makeMockAsyncStorage();
  await AsyncStorage.setItem(KEY, "{not valid json");
  const loaded = await loadTogetherAudioPrefs(AsyncStorage, KEY);
  check("malformed stored JSON falls back to defaults rather than throwing", JSON.stringify(loaded) === JSON.stringify(DEFAULT_TOGETHER_AUDIO_PREFS), loaded);
}
{
  const AsyncStorage = makeMockAsyncStorage();
  await AsyncStorage.setItem(KEY, JSON.stringify({ outputVolume: "loud", participantVolumes: "not an object" }));
  const loaded = await loadTogetherAudioPrefs(AsyncStorage, KEY);
  check("a corrupted field falls back to its own default instead of poisoning the whole object", loaded.outputVolume === 1 && JSON.stringify(loaded.participantVolumes) === "{}", loaded);
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);