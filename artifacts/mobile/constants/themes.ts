export type ThemeName = "light" | "dark" | "sepia" | "midnight";

export interface AppColors {
  lightCream: string;
  card: string;
  cream: string;
  cardBeige: string;
  warmBeige: string;
  borderBeige: string;
  textDark: string;
  textMid: string;
  textMuted: string;
  textMutedLight: string;
  primaryGreen: string;
  accentGreen: string;
  lightGreen: string;
  amber: string;
  brightYellow: string;
  navBg: string;
  navBorder: string;
  darkBg: string;
  progressFill: string;
  progressTrack: string;
  upperRoomBg: string;
  upperRoomCard: string;
  upperRoomBorder: string;
  upperRoomAmber: string;
  upperRoomAmberLight: string;
  upperRoomCream: string;
  upperRoomMuted: string;
  radius: number;
}

export const THEMES: Record<ThemeName, AppColors> = {
  light: {
    lightCream: "#FBF7EE",
    card: "#F4EFE4",
    cream: "#F4EFE4",
    cardBeige: "#EFE7D3",
    warmBeige: "#E8DDC4",
    borderBeige: "#E3D9C2",
    textDark: "#4A3A1E",
    textMid: "#6B5C3D",
    textMuted: "#8A7B5C",
    textMutedLight: "#A8997A",
    primaryGreen: "#0F6E56",
    accentGreen: "#1D9E75",
    lightGreen: "#9FE1CB",
    amber: "#BA7517",
    brightYellow: "#F7C948",
    navBg: "#0B3A2E",
    navBorder: "#1D5544",
    darkBg: "#06110D",
    progressFill: "#1D9E75",
    progressTrack: "#E3D9C2",
    upperRoomBg: "#100B06",
    upperRoomCard: "#140D07",
    upperRoomBorder: "#3A2C14",
    upperRoomAmber: "#E0A441",
    upperRoomAmberLight: "#EFB659",
    upperRoomCream: "#F4ECD8",
    upperRoomMuted: "#C9B48A",
    radius: 16,
  },

  dark: {
    lightCream: "#07120D",
    card: "#0D2218",
    cream: "#0D2218",
    cardBeige: "#0F2B1E",
    warmBeige: "#112A1A",
    borderBeige: "#1A3D2B",
    textDark: "#EDE8DE",
    textMid: "#9DC4B0",
    textMuted: "#4E7A62",
    textMutedLight: "#3D6050",
    primaryGreen: "#28B885",
    accentGreen: "#1D9E75",
    lightGreen: "#7ED9C0",
    amber: "#D4922A",
    brightYellow: "#F7C948",
    navBg: "#060E09",
    navBorder: "#163529",
    darkBg: "#030809",
    progressFill: "#1D9E75",
    progressTrack: "#1A3D2B",
    upperRoomBg: "#030608",
    upperRoomCard: "#080D0A",
    upperRoomBorder: "#1A3020",
    upperRoomAmber: "#D4922A",
    upperRoomAmberLight: "#E8A835",
    upperRoomCream: "#EDE8DE",
    upperRoomMuted: "#4E7A62",
    radius: 16,
  },

  sepia: {
    lightCream: "#F5EDD8",
    card: "#EDE0C4",
    cream: "#EDE0C4",
    cardBeige: "#E5D4B0",
    warmBeige: "#DEC99E",
    borderBeige: "#C9B48A",
    textDark: "#2D1B0E",
    textMid: "#5C3D1E",
    textMuted: "#8B6B44",
    textMutedLight: "#A8896A",
    primaryGreen: "#4A6E2A",
    accentGreen: "#3A8A28",
    lightGreen: "#8AC87A",
    amber: "#C07820",
    brightYellow: "#E8B52A",
    navBg: "#1A0F06",
    navBorder: "#3A2510",
    darkBg: "#0D0804",
    progressFill: "#3A8A28",
    progressTrack: "#C9B48A",
    upperRoomBg: "#100A04",
    upperRoomCard: "#180E06",
    upperRoomBorder: "#3A2510",
    upperRoomAmber: "#C07820",
    upperRoomAmberLight: "#D8922A",
    upperRoomCream: "#F5EDD8",
    upperRoomMuted: "#8B6B44",
    radius: 16,
  },

  midnight: {
    lightCream: "#080C12",
    card: "#0E1520",
    cream: "#0E1520",
    cardBeige: "#111B2A",
    warmBeige: "#142034",
    borderBeige: "#1A2840",
    textDark: "#E8EEF5",
    textMid: "#8CA8C5",
    textMuted: "#4A6A8A",
    textMutedLight: "#3A5570",
    primaryGreen: "#1A9FAA",
    accentGreen: "#15B8A8",
    lightGreen: "#6AD4CC",
    amber: "#C08A20",
    brightYellow: "#E0B030",
    navBg: "#050810",
    navBorder: "#162035",
    darkBg: "#030508",
    progressFill: "#15B8A8",
    progressTrack: "#1A2840",
    upperRoomBg: "#030508",
    upperRoomCard: "#080C14",
    upperRoomBorder: "#162035",
    upperRoomAmber: "#C08A20",
    upperRoomAmberLight: "#D4A030",
    upperRoomCream: "#E8EEF5",
    upperRoomMuted: "#4A6A8A",
    radius: 16,
  },
};

export const THEME_META: Record<ThemeName, { label: string; preview: string[]; isDark: boolean }> = {
  light: {
    label: "Light",
    preview: ["#FBF7EE", "#F4EFE4", "#1D9E75", "#4A3A1E"],
    isDark: false,
  },
  dark: {
    label: "Dark",
    preview: ["#07120D", "#0D2218", "#1D9E75", "#EDE8DE"],
    isDark: true,
  },
  sepia: {
    label: "Sepia",
    preview: ["#F5EDD8", "#EDE0C4", "#3A8A28", "#2D1B0E"],
    isDark: false,
  },
  midnight: {
    label: "Midnight",
    preview: ["#080C12", "#0E1520", "#15B8A8", "#E8EEF5"],
    isDark: true,
  },
};
