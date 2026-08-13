// Grain — 1 Grain per person who registers through your invite link.
export function grainLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "🌾 1 Grain · 1 person invited";
  return `🌾 ${count} Grain · ${count} people invited`;
}