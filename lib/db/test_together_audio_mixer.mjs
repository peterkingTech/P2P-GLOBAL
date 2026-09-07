// Runs against the REAL artifacts/mobile/lib/togetherAudio/mixer.ts via
// Node 22's --experimental-strip-types (confirmed working directly on
// this file — no RN/AsyncStorage imports here, so no mocking needed) —
// not a verbatim copy, unlike some earlier tests this session that had no
// choice but to copy RN-dependent logic by hand.
import { clampVolume, effectiveMediaVolume, effectiveParticipantVolume, rampVolume } from "../../artifacts/mobile/lib/togetherAudio/mixer.ts";

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); fail++; }
}

check("clampVolume clamps above 1", clampVolume(1.5) === 1);
check("clampVolume clamps below 0", clampVolume(-0.3) === 0);
check("clampVolume passes through mid-range", clampVolume(0.42) === 0.42);
check("clampVolume treats NaN as 0", clampVolume(NaN) === 0);

const basePrefs = { outputVolume: 1, mediaVolume: 0.75, roomVolume: 0.6, participantVolumes: { peter: 1, john: 0.7 }, mutedParticipants: [] };

check("effectiveMediaVolume = output * media", effectiveMediaVolume(basePrefs) === 0.75);
check("effectiveParticipantVolume(peter) = output * room * personal", Math.abs(effectiveParticipantVolume(basePrefs, "peter") - 0.6) < 1e-9);
check("effectiveParticipantVolume(john) uses john's own personal fader", Math.abs(effectiveParticipantVolume(basePrefs, "john") - 0.42) < 1e-9);
check("a participant with no personal fader set defaults to full (1)", Math.abs(effectiveParticipantVolume(basePrefs, "mary") - 0.6) < 1e-9);

console.log("\n=== Independence checks (the actual product requirement) ===");
{
  // Changing Media Audio does not change voice.
  const before = effectiveParticipantVolume(basePrefs, "peter");
  const changed = { ...basePrefs, mediaVolume: 0.1 };
  check("changing Media Audio does not change any participant's effective volume", effectiveParticipantVolume(changed, "peter") === before);
}
{
  // Changing Room Audio does not change media.
  const before = effectiveMediaVolume(basePrefs);
  const changed = { ...basePrefs, roomVolume: 0.05 };
  check("changing Room Audio does not change Media's effective volume", effectiveMediaVolume(changed) === before);
}
{
  // Changing Peter's personal volume does not change John's.
  const johnBefore = effectiveParticipantVolume(basePrefs, "john");
  const changed = { ...basePrefs, participantVolumes: { ...basePrefs.participantVolumes, peter: 0.2 } };
  check("changing Peter's personal volume does not change Peter's own value in isolation", effectiveParticipantVolume(changed, "peter") !== effectiveParticipantVolume(basePrefs, "peter"));
  check("changing Peter's personal volume does NOT change John's effective volume", effectiveParticipantVolume(changed, "john") === johnBefore);
}
{
  // Master affects final output for both media and room-based voice.
  const full = { ...basePrefs, outputVolume: 1 };
  const half = { ...basePrefs, outputVolume: 0.5 };
  check("Master affects Media's final effective volume", effectiveMediaVolume(half) === effectiveMediaVolume(full) / 2);
  check("Master affects a participant's final effective volume", Math.abs(effectiveParticipantVolume(half, "peter") - effectiveParticipantVolume(full, "peter") / 2) < 1e-9);
}
{
  // Muting a participant zeroes them out regardless of their personal fader, without touching anyone else.
  const muted = { ...basePrefs, mutedParticipants: ["peter"] };
  check("a muted participant's effective volume is 0", effectiveParticipantVolume(muted, "peter") === 0);
  check("muting Peter does not affect John's effective volume", effectiveParticipantVolume(muted, "john") === effectiveParticipantVolume(basePrefs, "john"));
}

console.log("\n=== rampVolume ===");
{
  const ticks = [];
  await new Promise((resolve) => {
    const cancel = rampVolume(0, 1, 90, (v) => {
      ticks.push(v);
      if (v >= 1) resolve();
    });
  });
  check("rampVolume produces multiple intermediate steps, not one jump", ticks.length >= 2, ticks);
  check("rampVolume's final tick lands exactly on the target", ticks[ticks.length - 1] === 1, ticks);
  check("rampVolume's steps are monotonically increasing toward the target (no jitter)", ticks.every((v, i) => i === 0 || v >= ticks[i - 1]), ticks);
}
{
  let called = 0;
  const cancel = rampVolume(0, 1, 500, () => { called++; });
  cancel();
  await new Promise((r) => setTimeout(r, 200));
  check("cancelling a ramp stops further ticks", called <= 1, { called });
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);