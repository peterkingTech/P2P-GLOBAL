export const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese',
  ar: 'Arabic', sw: 'Swahili', hi: 'Hindi', ig: 'Igbo',
  yo: 'Yoruba', ko: 'Korean', id: 'Indonesian', ru: 'Russian',
  tl: 'Tagalog', bn: 'Bengali', zh: 'Chinese', am: 'Amharic',
  ha: 'Hausa', tr: 'Turkish', ur: 'Urdu', it: 'Italian',
  nl: 'Dutch', ro: 'Romanian', uk: 'Ukrainian', el: 'Greek',
  he: 'Hebrew', fa: 'Persian', vi: 'Vietnamese', th: 'Thai',
};

export const getLanguageName = (code: string): string => {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
};
