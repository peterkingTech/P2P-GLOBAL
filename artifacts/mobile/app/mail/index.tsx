import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { IconButton } from "@/components/ui";
import MailHome from "@/components/messages/MailHome";

// P2P Mail on its own screen — opened from a chat's "P2P Mail" button with ?with=<userId>&name=…, it shows
// only the correspondence with that person (their chat stays a separate timeline).
export default function MailScreen() {
  const { with: withId, name } = useLocalSearchParams<{ with?: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.lightCream, paddingTop: insets.top + 4 }}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={[styles.title, { color: c.textDark }]} numberOfLines={1}>{withId ? `P2P Mail · ${name ?? "Participant"}` : "P2P Mail"}</Text>
      </View>
      <MailHome withUser={withId ? { id: String(withId), name: String(name ?? "Participant") } : null} bottomPad={insets.bottom + 24} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
});
