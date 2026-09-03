import { hexToRgb } from "./colorUtils";

// WCAG 2.x relative luminance + contrast ratio — used at style-definition
// time (see scripts/checkStyleContrast.ts) to verify every App Style's
// text/background pairs are actually accessible rather than eyeballed.
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA for normal text is 4.5:1; large text/UI components can use 3:1.
export function meetsAA(hexA: string, hexB: string, largeText = false): boolean {
  return contrastRatio(hexA, hexB) >= (largeText ? 3 : 4.5);
}