// Small hex-color helpers used only to derive the legacy AppColors fields
// (lightGreen, darkBg, etc.) from a style's approved design tokens, and by
// lib/contrast.ts to verify accessibility. Not a general-purpose color
// library — just enough math for this.

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`;
}

// amount: 0-1, moves each channel toward 255 (white)
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

// amount: 0-1, moves each channel toward 0 (black)
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

// Appends an 8-bit alpha suffix (e.g. "#1D9E75" + 0.6 -> "#1D9E7599") for
// the RN/CSS #RRGGBBAA hex-with-alpha form used throughout this codebase.
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `${hex}${a.toString(16).padStart(2, "0")}`;
}