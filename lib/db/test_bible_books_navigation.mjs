// Pure-logic test for artifacts/mobile/lib/bibleBooks.ts's nextChapter/
// previousChapter — run against the real source file (not a copy) via
// Node's --experimental-strip-types, same technique used for the audio
// mixer tests. Run this file with: node --experimental-strip-types <path>
import { BIBLE_BOOKS, nextChapter, previousChapter } from "../../artifacts/mobile/lib/bibleBooks.ts";

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); fail++; }
}

console.log("=== nextChapter ===");
check("advances within a book", JSON.stringify(nextChapter("Genesis", 1)) === JSON.stringify({ book: "Genesis", chapter: 2 }));
check("rolls over to the next book at the last chapter", JSON.stringify(nextChapter("Ruth", 4)) === JSON.stringify({ book: "1 Samuel", chapter: 1 }));
check("stays put at the very last chapter of the very last book (Revelation 22)", JSON.stringify(nextChapter("Revelation", 22)) === JSON.stringify({ book: "Revelation", chapter: 22 }));
check("advances within Psalms (150 chapters)", JSON.stringify(nextChapter("Psalms", 149)) === JSON.stringify({ book: "Psalms", chapter: 150 }));
check("rolls Psalms 150 into Proverbs 1", JSON.stringify(nextChapter("Psalms", 150)) === JSON.stringify({ book: "Proverbs", chapter: 1 }));
check("an unknown book name is returned unchanged (no crash)", JSON.stringify(nextChapter("Not A Book", 1)) === JSON.stringify({ book: "Not A Book", chapter: 1 }));

console.log("\n=== previousChapter ===");
check("goes back within a book", JSON.stringify(previousChapter("Genesis", 2)) === JSON.stringify({ book: "Genesis", chapter: 1 }));
check("rolls back to the previous book's last chapter", JSON.stringify(previousChapter("1 Samuel", 1)) === JSON.stringify({ book: "Ruth", chapter: 4 }));
check("stays put at the very first chapter of the very first book (Genesis 1)", JSON.stringify(previousChapter("Genesis", 1)) === JSON.stringify({ book: "Genesis", chapter: 1 }));
check("rolls Proverbs 1 back into Psalms 150", JSON.stringify(previousChapter("Proverbs", 1)) === JSON.stringify({ book: "Psalms", chapter: 150 }));
check("an unknown book name is returned unchanged (no crash)", JSON.stringify(previousChapter("Not A Book", 1)) === JSON.stringify({ book: "Not A Book", chapter: 1 }));

console.log("\n=== Structural integrity ===");
check("all 66 canonical books are present", BIBLE_BOOKS.length === 66, BIBLE_BOOKS.length);
check("Genesis is first, Revelation is last", BIBLE_BOOKS[0].name === "Genesis" && BIBLE_BOOKS[65].name === "Revelation");
check("every book has a positive chapter count", BIBLE_BOOKS.every((b) => b.chapters > 0));

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
