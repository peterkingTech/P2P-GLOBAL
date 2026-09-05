// My Tree's environment ambiance — derives a season/climate mood from data
// the profile may ALREADY have (never a new location request for this
// feature, per the feature's own privacy requirement). Nothing here ever
// returns or exposes the raw location fields it reads — only an opaque
// season/weather enum, which is all any UI is allowed to render.

export type Hemisphere = "northern" | "southern" | "tropical";
export type Season = "spring" | "summer" | "autumn" | "winter" | "dry" | "wet";
export type Weather = "sunny" | "cloudy" | "light_rain" | "snow" | "fog";

// A small set of representative tropical-band country codes (roughly within
// ~23.5° of the equator) where a forced winter/snow reading would be
// unrealistic — climate there is better described by wet/dry seasons than
// the four-season cycle. Not exhaustive; countries not listed here fall
// back to a latitude-free but still hemisphere-aware guess from ISO code
// continent grouping, and ultimately to a neutral default if unknown.
const TROPICAL_COUNTRY_CODES = new Set([
  "NG", "GH", "KE", "UG", "TZ", "CD", "CM", "CI", "SN", "ET",
  "CO", "VE", "EC", "PE", "BR", "PA", "CR", "GT", "HN", "SV", "NI",
  "IN", "TH", "VN", "PH", "MY", "ID", "SG", "LK",
]);

const SOUTHERN_HEMISPHERE_COUNTRY_CODES = new Set([
  "AU", "NZ", "ZA", "AR", "CL", "UY", "PY", "BO", "PE", "BR",
  "ZW", "ZM", "MZ", "NA", "BW", "MG", "FJ", "PG",
]);

export function inferHemisphere(input: { latitude?: number | null; countryCode?: string | null }): Hemisphere {
  if (typeof input.latitude === "number" && Number.isFinite(input.latitude)) {
    if (Math.abs(input.latitude) <= 23.5) return "tropical";
    return input.latitude > 0 ? "northern" : "southern";
  }
  const code = input.countryCode?.toUpperCase() ?? null;
  if (code && TROPICAL_COUNTRY_CODES.has(code)) return "tropical";
  if (code && SOUTHERN_HEMISPHERE_COUNTRY_CODES.has(code)) return "southern";
  return "northern"; // neutral default — most represented user base, and a
  // four-season Northern-Hemisphere cycle is a reasonable, unsurprising
  // default when no signal is available at all.
}

export function getSeason(hemisphere: Hemisphere, date: Date = new Date()): Season {
  const month = date.getMonth(); // 0-11

  if (hemisphere === "tropical") {
    // Roughly Nov-Apr wet, May-Oct dry — a simplification, not a per-
    // country model, appropriate for a subtle ambiance rather than an
    // accurate forecast.
    return month >= 10 || month <= 3 ? "wet" : "dry";
  }

  // Meteorological seasons (Dec/Jan/Feb = winter in the Northern
  // Hemisphere), mirrored exactly for the Southern Hemisphere.
  const northernSeasonByMonth: Season[] = [
    "winter", "winter", "spring", "spring", "spring", "summer",
    "summer", "summer", "autumn", "autumn", "autumn", "winter",
  ];
  const season = northernSeasonByMonth[month];
  if (hemisphere === "northern") return season;
  // Southern Hemisphere is six months out of phase.
  const flip: Record<Season, Season> = {
    winter: "summer", summer: "winter", spring: "autumn", autumn: "spring",
    dry: "dry", wet: "wet",
  };
  return flip[season];
}

// A deterministic, per-day pseudo-random weather pick — same user sees the
// same weather all day, and it's stable across app opens, but changes
// gradually day to day. Deliberately not a live weather API (kept simple,
// no new dependency/permission, no network dependency for a purely
// ambient visual).
export function getWeather(season: Season, date: Date = new Date()): Weather {
  const daySeed = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  const roll = ((daySeed * 9301 + 49297) % 233280) / 233280; // 0-1

  if (season === "winter") {
    if (roll < 0.35) return "snow";
    if (roll < 0.55) return "fog";
    if (roll < 0.75) return "cloudy";
    return "sunny";
  }
  if (season === "wet") {
    return roll < 0.5 ? "light_rain" : "cloudy";
  }
  if (roll < 0.15) return "light_rain";
  if (roll < 0.4) return "cloudy";
  if (roll < 0.5) return "fog";
  return "sunny";
}

export interface TreeEnvironmentReading {
  hemisphere: Hemisphere;
  season: Season;
  weather: Weather;
}

export function readTreeEnvironment(
  profile: { latitude?: number | null; countryCode?: string | null },
  date: Date = new Date()
): TreeEnvironmentReading {
  const hemisphere = inferHemisphere(profile);
  const season = getSeason(hemisphere, date);
  const weather = getWeather(season, date);
  return { hemisphere, season, weather };
}