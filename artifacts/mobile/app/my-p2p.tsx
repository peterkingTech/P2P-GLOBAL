import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import MyP2PDashboard from "@/components/myp2p/MyP2PDashboard";

// My P2P — the full widget dashboard with Customize (show/hide, reorder,
// restore default). Home shows the same widgets in the same order.
export default function MyP2PScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.lightCream }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Stack.Screen options={{ title: "My P2P" }} />
      <Text style={[styles.sub, { color: c.textMuted }]}>Your learning, Bible reading, discipleship and communities in one place. Only you can see this page.</Text>
      <MyP2PDashboard editable />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, width: "100%", maxWidth: 1000, alignSelf: "center" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
