// Dev-time accessibility check for every App Style — verifies WCAG AA
// contrast (>=4.5:1) on the text/background pairs each style actually
// renders (see app style spec §32). Run with: npx tsx scripts/checkStyleContrast.ts
import { APP_STYLES, resolveAppStyleColors } from "../constants/appStyles";
import { contrastRatio } from "../lib/contrast";

let failures = 0;
let checks = 0;

for (const style of APP_STYLES) {
  const modes: Array<"light" | "dark"> = style.isExisting
    ? [] // Original styles are the pre-existing themes, already shipped/verified separately.
    : ["light", "dark"];

  for (const mode of modes) {
    const c = resolveAppStyleColors(style, mode);
    const pairs: Array<[string, string, string]> = [
      ["text on background", c.textDark, c.lightCream],
      ["text on card", c.textDark, c.card],
      ["muted text on card", c.textMid, c.card],
      ["primary button text", "#FFFFFF", c.primaryGreen],
    ];
    for (const [label, fg, bg] of pairs) {
      checks++;
      const ratio = contrastRatio(fg, bg);
      if (ratio < 4.5) {
        failures++;
        console.log(`FAIL  ${style.id} (${mode}) — ${label}: ${ratio.toFixed(2)}:1 (need >=4.5)`);
      }
    }
  }
}

console.log(`\n${checks} checks run, ${failures} failing (${style_count()} styles, Original excluded — pre-existing).`);
function style_count() { return APP_STYLES.filter((s) => !s.isExisting).length; }
if (failures > 0) process.exit(1);