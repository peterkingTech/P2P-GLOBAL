// Verbatim copy of the extraction/validation logic from
// artifacts/mobile/lib/mediaProviders/youtube.ts (this repo has no
// lightweight single-TS-file runner outside Metro/tsc, so this pure-logic
// copy is how that function is exercised standalone — kept in sync by hand,
// not imported, and noted as such in the implementation report).
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const URL_PATTERNS = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
];
function extractId(input) {
  const trimmed = input.trim();
  if (ID_PATTERN.test(trimmed)) return trimmed;
  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}
function matches(input) {
  const trimmed = input.trim();
  return ID_PATTERN.test(trimmed) || /youtube\.com|youtu\.be/i.test(trimmed);
}

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label} — got ${JSON.stringify(actual)}${ok ? "" : `, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}

check("watch URL", extractId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("watch URL with extra params", extractId("https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ&t=30s"), "dQw4w9WgXcQ");
check("youtu.be short URL", extractId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("embed URL", extractId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("shorts URL", extractId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("bare 11-char id", extractId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
check("bare id with whitespace", extractId("  dQw4w9WgXcQ  "), "dQw4w9WgXcQ");
check("a random mp3 URL is NOT a valid YouTube id", extractId("https://example.com/song.mp3"), null);
check("a YouTube channel page is NOT a valid video id", extractId("https://www.youtube.com/@somechannel"), null);
check("garbage text is NOT a valid id", extractId("not a link at all"), null);

check("matches() true for watch URL", matches("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), true);
check("matches() true for bare id", matches("dQw4w9WgXcQ"), true);
check("matches() false for an mp3 link (falls through to legacy path)", matches("https://example.com/song.mp3"), false);
check("matches() false for a Spotify link", matches("https://open.spotify.com/track/abc123"), false);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);