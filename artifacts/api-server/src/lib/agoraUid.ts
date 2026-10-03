// Server-side mirror of artifacts/mobile/lib/agoraUid.ts's uidFromUserId —
// byte-for-byte the same FNV-1a hash. Deliberately duplicated rather than
// shared across the mobile/api-server package boundary (client and server
// are separate deployable runtimes here); the two MUST stay identical, so
// any future edit to one requires the same edit to the other.
//
// Stage 19 (call security/privacy audit) — this existed only on the client
// before. The server accepted whatever numeric `uid` a caller supplied in
// POST /calls/token without checking it matched the authorized userId's own
// deterministic uid, so a caller authorized for a channel (real membership
// check passed) could still request a token for an ARBITRARY uid — e.g. a
// value colliding with another real participant's expected uid inside that
// same channel. This lets calls.ts independently recompute the expected uid
// and reject a mismatch, closing that gap without touching how legitimate
// callers already behave (every existing client always sends the correct
// deterministic uid already, so no legitimate caller is affected).
export function uidFromUserId(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}
