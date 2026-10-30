import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEMES, type AppColors } from "@/constants/themes";
import { AppButton, IconButton, Chip, FilterChip, ChipRow, SegmentedControl, CallControl, ButtonThemeProvider } from "@/components/ui";

// Developer preview of the P2P Global button system: every part, in the light
// and dark themes side by side. Development builds only (localhost) — a
// production app shows nothing here. The "Save (2 s)" button uses a demo
// promise so the loading state and double-tap protection can be seen; no
// real action is performed anywhere on this screen.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Panel({ colors, mode }: { colors: AppColors; mode: "light" | "dark" }) {
  const [filters, setFilters] = useState<string[]>(["stories"]);
  const [view, setView] = useState<"progress" | "done">("progress");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [saved, setSaved] = useState(false);
  const [presses, setPresses] = useState(0);
  const toggle = (k: string) => setFilters((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  const t = { color: colors.textDark, fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 18, marginBottom: 8 } as const;
  return (
    <ButtonThemeProvider colors={colors} mode={mode}>
      <View style={[styles.panel, { backgroundColor: colors.lightCream, borderColor: colors.borderBeige }]}>
        <Text style={[styles.h, { color: colors.textDark }]}>{mode === "light" ? "Light theme" : "Dark theme"}</Text>

        <Text style={t}>Variants (medium)</Text>
        <View style={styles.row}>
          <AppButton label="Continue Learning" icon="play" onPress={() => setPresses((n) => n + 1)} />
          <AppButton label="View Details" variant="secondary" onPress={() => setPresses((n) => n + 1)} />
          <AppButton label="View All" variant="tertiary" icon="chevron-forward" iconPosition="trailing" onPress={() => setPresses((n) => n + 1)} />
          <AppButton label="Cancel" variant="outline" onPress={() => setPresses((n) => n + 1)} />
          <AppButton label="Delete" variant="destructive" icon="trash-outline" onPress={() => setPresses((n) => n + 1)} />
        </View>
        <Text style={{ color: colors.textMid, fontSize: 12 }}>Presses: {presses}</Text>

        <Text style={t}>Sizes</Text>
        <View style={styles.row}>
          <AppButton label="Small" size="sm" onPress={() => {}} />
          <AppButton label="Medium" size="md" onPress={() => {}} />
          <AppButton label="Large" size="lg" icon="arrow-forward" iconPosition="trailing" onPress={() => {}} />
        </View>

        <Text style={t}>States</Text>
        <View style={styles.row}>
          <AppButton label="Disabled" disabled onPress={() => {}} />
          <AppButton label="Sending" loading onPress={() => {}} />
          <AppButton label={saved ? "Saved" : "Save (2 s demo)"} icon={saved ? "checkmark" : "save-outline"} onPress={async () => { await wait(2000); setSaved(true); }} />
          <AppButton label="Full width" variant="secondary" fullWidth onPress={() => {}} />
        </View>

        <Text style={t}>Icon buttons</Text>
        <View style={[styles.row, { alignItems: "center" }]}>
          <IconButton icon="search" accessibilityLabel="Search" onPress={() => {}} />
          <IconButton icon="create-outline" variant="tinted" accessibilityLabel="Edit" onPress={() => {}} />
          <IconButton icon="close" size="sm" accessibilityLabel="Close" onPress={() => {}} />
          <IconButton icon="bookmark-outline" selectedIcon="bookmark" selected={saved} variant="tinted" accessibilityLabel={saved ? "Saved" : "Save"} onPress={() => setSaved((v) => !v)} />
          <View style={styles.art}>
            <IconButton icon="play" variant="overlay" accessibilityLabel="Play" onPress={() => {}} />
            <IconButton icon="expand" variant="overlay" size="sm" accessibilityLabel="Full screen" onPress={() => {}} />
          </View>
        </View>

        <Text style={t}>Chips and segmented control</Text>
        <ChipRow accessibilityLabel="Filter by kind">
          {[["stories", "Kingdom Stories"], ["school", "Kingdom School"], ["bible", "Bible"]].map(([k, l]) => (
            <FilterChip key={k} label={l} selected={filters.includes(k)} onPress={() => toggle(k)} />
          ))}
          <Chip label="Add topic" icon="add" onPress={() => {}} />
        </ChipRow>
        <View style={{ height: 10 }} />
        <SegmentedControl accessibilityLabel="Show" value={view} onChange={setView}
          options={[{ value: "progress", label: "In progress" }, { value: "done", label: "Completed" }]} />

        <Text style={t}>Call controls (always on the dark call screen)</Text>
        <View style={styles.call}>
          <CallControl icon="mic" activeIcon="mic-off" active={muted} label={muted ? "Unmute" : "Mute"} onPress={() => setMuted((v) => !v)} />
          <CallControl icon="videocam" activeIcon="videocam-off" active={camOff} label={camOff ? "Camera on" : "Camera off"} onPress={() => setCamOff((v) => !v)} />
          <CallControl icon="call" kind="end" label="End call" onPress={() => {}} />
        </View>
      </View>
    </ButtonThemeProvider>
  );
}

export default function ButtonPreview() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (!__DEV__) return <View style={{ flex: 1 }} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40, gap: 16 }}>
      <Stack.Screen options={{ title: "Button system" }} />
      <Text style={styles.title}>P2P Global button system</Text>
      <Text style={styles.sub}>Development preview — every part in both themes. Nothing here performs a real action.</Text>
      <View style={{ flexDirection: width >= 1000 ? "row" : "column", gap: 16 }}>
        <Panel colors={THEMES.light} mode="light" />
        <Panel colors={THEMES.dark} mode="dark" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#4A3A1E" },
  sub: { fontSize: 13, color: "#8A7B5C" },
  panel: { flex: 1, padding: 16, borderRadius: 16, borderWidth: 1 },
  h: { fontSize: 17, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 6 },
  art: { flexDirection: "row", gap: 8, padding: 8, borderRadius: 12, backgroundColor: "#6B5C3D" },
  call: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 16, borderRadius: 16, backgroundColor: "#0B1410" },
});
