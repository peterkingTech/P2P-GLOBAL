// Lightweight country -> continent + flag-emoji lookup for the Global Forest
// map (app/forest.tsx). p2p_profiles.country is free text (not an ISO code),
// so this is a best-effort table covering the countries this network is
// actually likely to have — an unmatched country still gets listed in the
// flag strip below the map, it just doesn't light up a continent zone.

export type Continent = "north_america" | "south_america" | "europe" | "africa" | "asia" | "oceania";

const COUNTRY_TO_CONTINENT: Record<string, Continent> = {
  "united states": "north_america", "usa": "north_america", "us": "north_america",
  "canada": "north_america", "mexico": "north_america", "jamaica": "north_america",
  "haiti": "north_america", "cuba": "north_america", "dominican republic": "north_america",

  "brazil": "south_america", "argentina": "south_america", "colombia": "south_america",
  "peru": "south_america", "chile": "south_america", "venezuela": "south_america",
  "ecuador": "south_america", "bolivia": "south_america", "paraguay": "south_america", "uruguay": "south_america",

  "united kingdom": "europe", "uk": "europe", "germany": "europe", "france": "europe",
  "spain": "europe", "italy": "europe", "netherlands": "europe", "portugal": "europe",
  "poland": "europe", "ukraine": "europe", "romania": "europe", "greece": "europe",
  "sweden": "europe", "norway": "europe", "finland": "europe", "ireland": "europe",
  "switzerland": "europe", "belgium": "europe", "austria": "europe", "denmark": "europe",

  "nigeria": "africa", "kenya": "africa", "south africa": "africa", "ghana": "africa",
  "uganda": "africa", "tanzania": "africa", "ethiopia": "africa", "egypt": "africa",
  "zimbabwe": "africa", "zambia": "africa", "rwanda": "africa", "cameroon": "africa",
  "senegal": "africa", "ivory coast": "africa", "sierra leone": "africa", "liberia": "africa",
  "malawi": "africa", "mozambique": "africa", "botswana": "africa", "namibia": "africa",

  "india": "asia", "china": "asia", "japan": "asia", "philippines": "asia",
  "indonesia": "asia", "south korea": "asia", "vietnam": "asia", "thailand": "asia",
  "pakistan": "asia", "bangladesh": "asia", "malaysia": "asia", "singapore": "asia",
  "israel": "asia", "saudi arabia": "asia", "uae": "asia", "united arab emirates": "asia",
  "nepal": "asia", "sri lanka": "asia", "myanmar": "asia",

  "australia": "oceania", "new zealand": "oceania", "fiji": "oceania", "papua new guinea": "oceania",
};

const COUNTRY_TO_FLAG: Record<string, string> = {
  "united states": "🇺🇸", "usa": "🇺🇸", "us": "🇺🇸", "canada": "🇨🇦", "mexico": "🇲🇽",
  "jamaica": "🇯🇲", "haiti": "🇭🇹", "cuba": "🇨🇺", "dominican republic": "🇩🇴",
  "brazil": "🇧🇷", "argentina": "🇦🇷", "colombia": "🇨🇴", "peru": "🇵🇪", "chile": "🇨🇱",
  "venezuela": "🇻🇪", "ecuador": "🇪🇨", "bolivia": "🇧🇴", "paraguay": "🇵🇾", "uruguay": "🇺🇾",
  "united kingdom": "🇬🇧", "uk": "🇬🇧", "germany": "🇩🇪", "france": "🇫🇷", "spain": "🇪🇸",
  "italy": "🇮🇹", "netherlands": "🇳🇱", "portugal": "🇵🇹", "poland": "🇵🇱", "ukraine": "🇺🇦",
  "romania": "🇷🇴", "greece": "🇬🇷", "sweden": "🇸🇪", "norway": "🇳🇴", "finland": "🇫🇮",
  "ireland": "🇮🇪", "switzerland": "🇨🇭", "belgium": "🇧🇪", "austria": "🇦🇹", "denmark": "🇩🇰",
  "nigeria": "🇳🇬", "kenya": "🇰🇪", "south africa": "🇿🇦", "ghana": "🇬🇭", "uganda": "🇺🇬",
  "tanzania": "🇹🇿", "ethiopia": "🇪🇹", "egypt": "🇪🇬", "zimbabwe": "🇿🇼", "zambia": "🇿🇲",
  "rwanda": "🇷🇼", "cameroon": "🇨🇲", "senegal": "🇸🇳", "ivory coast": "🇨🇮", "sierra leone": "🇸🇱",
  "liberia": "🇱🇷", "malawi": "🇲🇼", "mozambique": "🇲🇿", "botswana": "🇧🇼", "namibia": "🇳🇦",
  "india": "🇮🇳", "china": "🇨🇳", "japan": "🇯🇵", "philippines": "🇵🇭", "indonesia": "🇮🇩",
  "south korea": "🇰🇷", "vietnam": "🇻🇳", "thailand": "🇹🇭", "pakistan": "🇵🇰", "bangladesh": "🇧🇩",
  "malaysia": "🇲🇾", "singapore": "🇸🇬", "israel": "🇮🇱", "saudi arabia": "🇸🇦",
  "uae": "🇦🇪", "united arab emirates": "🇦🇪", "nepal": "🇳🇵", "sri lanka": "🇱🇰", "myanmar": "🇲🇲",
  "australia": "🇦🇺", "new zealand": "🇳🇿", "fiji": "🇫🇯", "papua new guinea": "🇵🇬",
};

export function getContinent(country: string | null | undefined): Continent | null {
  if (!country) return null;
  return COUNTRY_TO_CONTINENT[country.trim().toLowerCase()] ?? null;
}

export function getFlagEmoji(country: string | null | undefined): string {
  if (!country) return "🌐";
  return COUNTRY_TO_FLAG[country.trim().toLowerCase()] ?? "🌐";
}

export const CONTINENT_LABELS: Record<Continent, string> = {
  north_america: "North America",
  south_america: "South America",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  oceania: "Oceania",
};