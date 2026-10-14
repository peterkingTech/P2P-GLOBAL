// ISO 3166-1 alpha-2 code -> canonical English country name.
//
// The device's reverse geocoder returns the country name in the PHONE's
// language ("Deutschland", "Allemagne", ...), so the same country was being
// stored under several names while country_code was always "DE". Everything
// that compares p2p_profiles.country (country centroids, the Global Forest,
// country lists) expects one English name, so the name is derived from the
// ISO code instead. Names match p2p_country_centroids.country_name.

const COUNTRY_NAMES: Record<string, string> = {
  AD: "Andorra", AE: "United Arab Emirates", AF: "Afghanistan", AG: "Antigua and Barbuda",
  AI: "Anguilla", AL: "Albania", AM: "Armenia", AO: "Angola", AR: "Argentina",
  AS: "American Samoa", AT: "Austria", AU: "Australia", AW: "Aruba", AZ: "Azerbaijan",
  BA: "Bosnia and Herzegovina", BB: "Barbados", BD: "Bangladesh", BE: "Belgium",
  BF: "Burkina Faso", BG: "Bulgaria", BH: "Bahrain", BI: "Burundi", BJ: "Benin",
  BM: "Bermuda", BN: "Brunei", BO: "Bolivia", BR: "Brazil", BS: "Bahamas", BT: "Bhutan",
  BW: "Botswana", BY: "Belarus", BZ: "Belize", CA: "Canada",
  CD: "Democratic Republic of the Congo", CF: "Central African Republic",
  CG: "Republic of the Congo", CH: "Switzerland", CI: "Ivory Coast", CK: "Cook Islands",
  CL: "Chile", CM: "Cameroon", CN: "China", CO: "Colombia", CR: "Costa Rica", CU: "Cuba",
  CV: "Cape Verde", CW: "Curacao", CY: "Cyprus", CZ: "Czech Republic", DE: "Germany",
  DJ: "Djibouti", DK: "Denmark", DM: "Dominica", DO: "Dominican Republic", DZ: "Algeria",
  EC: "Ecuador", EE: "Estonia", EG: "Egypt", EH: "Western Sahara", ER: "Eritrea",
  ES: "Spain", ET: "Ethiopia", FI: "Finland", FJ: "Fiji", FM: "Micronesia",
  FO: "Faroe Islands", FR: "France", GA: "Gabon", GB: "United Kingdom", GD: "Grenada",
  GE: "Georgia", GF: "French Guiana", GH: "Ghana", GI: "Gibraltar", GL: "Greenland",
  GM: "Gambia", GN: "Guinea", GP: "Guadeloupe", GQ: "Equatorial Guinea", GR: "Greece",
  GT: "Guatemala", GU: "Guam", GW: "Guinea-Bissau", GY: "Guyana", HK: "Hong Kong",
  HN: "Honduras", HR: "Croatia", HT: "Haiti", HU: "Hungary", ID: "Indonesia", IE: "Ireland",
  IL: "Israel", IN: "India", IQ: "Iraq", IR: "Iran", IS: "Iceland", IT: "Italy",
  JM: "Jamaica", JO: "Jordan", JP: "Japan", KE: "Kenya", KG: "Kyrgyzstan", KH: "Cambodia",
  KI: "Kiribati", KM: "Comoros", KN: "Saint Kitts and Nevis", KP: "North Korea",
  KR: "South Korea", KW: "Kuwait", KY: "Cayman Islands", KZ: "Kazakhstan", LA: "Laos",
  LB: "Lebanon", LC: "Saint Lucia", LI: "Liechtenstein", LK: "Sri Lanka", LR: "Liberia",
  LS: "Lesotho", LT: "Lithuania", LU: "Luxembourg", LV: "Latvia", LY: "Libya",
  MA: "Morocco", MC: "Monaco", MD: "Moldova", ME: "Montenegro", MG: "Madagascar",
  MH: "Marshall Islands", MK: "North Macedonia", ML: "Mali", MM: "Myanmar", MN: "Mongolia",
  MO: "Macau", MQ: "Martinique", MR: "Mauritania", MT: "Malta", MU: "Mauritius",
  MV: "Maldives", MW: "Malawi", MX: "Mexico", MY: "Malaysia", MZ: "Mozambique",
  NA: "Namibia", NC: "New Caledonia", NE: "Niger", NG: "Nigeria", NI: "Nicaragua",
  NL: "Netherlands", NO: "Norway", NP: "Nepal", NR: "Nauru", NZ: "New Zealand", OM: "Oman",
  PA: "Panama", PE: "Peru", PF: "French Polynesia", PG: "Papua New Guinea",
  PH: "Philippines", PK: "Pakistan", PL: "Poland", PR: "Puerto Rico", PS: "Palestine",
  PT: "Portugal", PW: "Palau", PY: "Paraguay", QA: "Qatar", RE: "Reunion", RO: "Romania",
  RS: "Serbia", RU: "Russia", RW: "Rwanda", SA: "Saudi Arabia", SB: "Solomon Islands",
  SC: "Seychelles", SD: "Sudan", SE: "Sweden", SG: "Singapore", SI: "Slovenia",
  SK: "Slovakia", SL: "Sierra Leone", SM: "San Marino", SN: "Senegal", SO: "Somalia",
  SR: "Suriname", SS: "South Sudan", ST: "Sao Tome and Principe", SV: "El Salvador",
  SX: "Sint Maarten", SY: "Syria", SZ: "Eswatini", TC: "Turks and Caicos Islands",
  TD: "Chad", TG: "Togo", TH: "Thailand", TJ: "Tajikistan", TL: "Timor-Leste",
  TM: "Turkmenistan", TN: "Tunisia", TO: "Tonga", TR: "Turkey", TT: "Trinidad and Tobago",
  TV: "Tuvalu", TW: "Taiwan", TZ: "Tanzania", UA: "Ukraine", UG: "Uganda",
  US: "United States", UY: "Uruguay", UZ: "Uzbekistan", VA: "Vatican City",
  VC: "Saint Vincent and the Grenadines", VE: "Venezuela", VG: "British Virgin Islands",
  VI: "U.S. Virgin Islands", VN: "Vietnam", VU: "Vanuatu", WS: "Samoa", XK: "Kosovo",
  YE: "Yemen", ZA: "South Africa", ZM: "Zambia", ZW: "Zimbabwe",
};

/** Canonical English name for an ISO alpha-2 code, or null if unknown. */
export function countryNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_NAMES[code.trim().toUpperCase()] ?? null;
}

// Names countries use for themselves (what a phone set to the local language
// returns), plus common English variants. Profiles saved before names were
// normalized can hold these.
const NAME_ALIASES: Record<string, string> = {
  usa: "US", "united states of america": "US", us: "US", uk: "GB", "great britain": "GB",
  england: "GB", scotland: "GB", wales: "GB", uae: "AE", "côte d'ivoire": "CI",
  "cote d'ivoire": "CI", czechia: "CZ", "dr congo": "CD", drc: "CD", burma: "MM",
  swaziland: "SZ", "east timor": "TL", "korea": "KR", holland: "NL",
  deutschland: "DE", österreich: "AT", osterreich: "AT", schweiz: "CH", suisse: "CH",
  svizzera: "CH", france: "FR", españa: "ES", espana: "ES", italia: "IT",
  nederland: "NL", belgië: "BE", belgie: "BE", belgique: "BE", polska: "PL",
  "česko": "CZ", "česká republika": "CZ", slovensko: "SK", magyarország: "HU",
  románia: "RO", românia: "RO", ελλάδα: "GR", ελλάς: "GR", "türkiye": "TR", turkiye: "TR",
  sverige: "SE", norge: "NO", danmark: "DK", suomi: "FI", ísland: "IS", éire: "IE",
  hrvatska: "HR", srbija: "RS", србија: "RS", slovenija: "SI", "България": "BG",
  "българия": "BG", lietuva: "LT", latvija: "LV", eesti: "EE", "україна": "UA",
  "россия": "RU", "беларусь": "BY", "brasil": "BR", "méxico": "MX", "perú": "PE",
  "panamá": "PA", "república dominicana": "DO", "haïti": "HT", "nigéria": "NG",
  "cameroun": "CM", "sénégal": "SN", "maroc": "MA", "algérie": "DZ", "tunisie": "TN",
  "مصر": "EG", "السعودية": "SA", "المملكة العربية السعودية": "SA",
  "الإمارات العربية المتحدة": "AE", "ישראל": "IL", "ایران": "IR", "پاکستان": "PK",
  "भारत": "IN", "বাংলাদেশ": "BD", "中国": "CN", "中國": "CN", "台灣": "TW", "臺灣": "TW",
  "日本": "JP", "대한민국": "KR", "한국": "KR", "ประเทศไทย": "TH", "việt nam": "VN",
  "pilipinas": "PH", "nihon": "JP", "ethiopia": "ET", "ኢትዮጵያ": "ET",
};

let nameIndex: Map<string, string> | null = null;
function buildNameIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const add = (name: string, code: string) => { const k = name.trim().toLowerCase(); if (k && !index.has(k)) index.set(k, code); };
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) add(name, code);
  for (const [name, code] of Object.entries(NAME_ALIASES)) add(name, code);
  // Where the JS engine provides localized region names, also accept the
  // country name in every app language. Optional: skipped if unavailable.
  const DisplayNames = (Intl as any)?.DisplayNames;
  if (typeof DisplayNames === "function") {
    for (const lang of ["de", "es", "fr", "pt", "it", "nl", "pl", "ro", "el", "ru", "uk", "tr", "ar", "he", "fa", "hi", "bn", "ur", "ta", "te", "zh", "zh-TW", "ja", "ko", "th", "vi", "id", "ms", "sw", "ha", "yo", "ig", "tl", "zu"]) {
      try {
        const dn = new DisplayNames([lang], { type: "region" });
        for (const code of Object.keys(COUNTRY_NAMES)) { const n = dn.of(code); if (n && n !== code) add(n, code); }
      } catch { /* language not available in this engine */ }
    }
  }
  return index;
}

/** ISO alpha-2 code for a country name in English, its own language, or a
 *  2-letter code itself. Null if unrecognized. */
export function countryCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = name.trim();
  if (/^[A-Za-z]{2}$/.test(t) && COUNTRY_NAMES[t.toUpperCase()]) return t.toUpperCase();
  if (!nameIndex) nameIndex = buildNameIndex();
  return nameIndex.get(t.toLowerCase()) ?? null;
}

/** Flag emoji built from an ISO alpha-2 code (regional indicator symbols). */
export function flagFromCode(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code.trim())) return null;
  const c = code.trim().toUpperCase();
  if (!COUNTRY_NAMES[c]) return null;
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
