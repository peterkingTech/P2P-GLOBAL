import { getFlagEmoji } from "@/lib/countryGeo";

// One way to show WHO / WHERE / CALLED TO across Discover Peers, the public
// profile and the user's own profile, so the three never disagree.
// Location is only ever city + country (never coordinates or an address);
// callers pass null when the person has chosen not to show their country.

// "🇩🇪 Braunschweig, Germany" — or "🇩🇪 Germany" when no city is on file.
// Null when there's no public country (nothing is invented).
export function publicLocationLabel(city: string | null | undefined, country: string | null | undefined): string | null {
  const c = country?.trim();
  if (!c) return null;
  const ci = city?.trim();
  return `${getFlagEmoji(c)} ${ci ? `${ci}, ${c}` : c}`;
}

export const NO_PUBLIC_LOCATION = "Location not added";

// The person's own stated calling, if they've written one. The account's
// permission role (e.g. "student") is never shown as a calling.
export function calledToValue(calling: string | null | undefined): string | null {
  const v = calling?.trim();
  return v ? v : null;
}
