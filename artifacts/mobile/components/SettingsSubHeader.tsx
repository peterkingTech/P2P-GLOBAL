import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

// Shared back-button + title header for every settings/* sub-screen (and
// other screens that want the same look — notifications, connections
// requests, etc.), so each one doesn't hand-roll the same row.
//
// Route-name leak fix: none of this component's 14 call sites hid Expo
// Router's own default native header, so the router's default title (the
// raw route segment, e.g. "notifications/index") rendered above this
// component's own title, visible in production. Fixed once here, at the
// shared component, rather than in each of the 14 screens individually, so
// no future screen adopting this component can reintroduce the same leak.
export default function SettingsSubHeader({ title }: { title: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: colors.borderBeige }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textDark }]}>{title}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
});