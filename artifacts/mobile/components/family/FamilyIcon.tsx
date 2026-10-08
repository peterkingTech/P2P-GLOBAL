import React from "react";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

// The one icon vocabulary for My Family / Gatherings. Every control names
// what it means ("prayer", "mute"), never a glyph, so the whole surface
// stays one consistent outline set: an outline glyph when idle, the filled
// glyph when active/selected.
//
// All glyphs are Ionicons except prayer: Ionicons has no praying-hands
// symbol, so that one comes from MaterialCommunityIcons — the same
// @expo/vector-icons package, kept inside this file so screens never mix
// icon families themselves.
export type FamilyIconName =
  | "media" | "scripture" | "prayer" | "share" | "mute" | "study"
  | "raiseHand" | "reactions" | "voice" | "music" | "paused" | "warning"
  | "moment" | "question" | "focus" | "answered";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const IONICONS: Record<Exclude<FamilyIconName, "prayer">, { idle: IoniconName; active: IoniconName }> = {
  media: { idle: "play-circle-outline", active: "play-circle" },
  scripture: { idle: "book-outline", active: "book" },
  share: { idle: "mic-outline", active: "mic" },
  mute: { idle: "mic-off-outline", active: "mic-off" },
  study: { idle: "reader-outline", active: "reader" },
  raiseHand: { idle: "hand-right-outline", active: "hand-right" },
  reactions: { idle: "happy-outline", active: "happy" },
  voice: { idle: "mic-outline", active: "mic" },
  music: { idle: "musical-notes-outline", active: "musical-notes" },
  paused: { idle: "pause-circle-outline", active: "pause-circle" },
  warning: { idle: "alert-circle-outline", active: "alert-circle" },
  moment: { idle: "film-outline", active: "film" },
  question: { idle: "help-circle-outline", active: "help-circle" },
  focus: { idle: "locate-outline", active: "locate" },
  answered: { idle: "checkmark-circle-outline", active: "checkmark-circle" },
};

interface Props {
  name: FamilyIconName;
  size?: number;
  color: string;
  active?: boolean;
}

export default function FamilyIcon({ name, size = 20, color, active = false }: Props) {
  if (name === "prayer") {
    // A single glyph (there is no outline variant); state shows through color.
    return (
      <MaterialCommunityIcons
        name="hands-pray"
        size={size}
        color={color}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  const glyph = IONICONS[name];
  return (
    <Ionicons
      name={active ? glyph.active : glyph.idle}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
