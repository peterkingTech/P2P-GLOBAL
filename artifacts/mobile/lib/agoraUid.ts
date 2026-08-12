// Agora's RtcEngine.joinChannel and RtcTokenBuilder both key participants by
// a 32-bit unsigned numeric uid — this app's user ids are Supabase UUIDs.
// Every call screen needs the SAME numeric uid for the same user on both the
// client (joinChannel) and server (token minting) sides, so this is a pure,
// deterministic hash rather than anything random or server-assigned.
//
// FNV-1a, truncated to stay within Agora's safe range (avoiding the top bit
// so the value behaves identically whether read as signed or unsigned across
// the JS <-> native bridge).
export function uidFromUserId(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1; // never 0 — Agora reserves 0 to mean "auto-assign"
}