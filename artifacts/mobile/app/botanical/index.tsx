import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { IconButton } from "@/components/ui";
import BotanicalModelView from "@/components/growth/BotanicalModelView";
import { APPLE_LIFECYCLE, LIFECYCLE_NOTE } from "@/lib/botanicalLifecycle";
import { botanicalAvailability } from "@/lib/growthTreeAssets";

// HOW AN APPLE TREE GROWS — the apple tree's year, with the owner's Meshy models (shared register +
// BotanicalModelView). Teaching only: not participant stages, never applied to anyone's tree on a schedule.
// One model is loaded at a time (the one chosen). A model that isn't hosted yet says so — it is never
// replaced by a picture or another model.
export default function BotanicalLifecycleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sections = useMemo(() => APPLE_LIFECYCLE.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, available: botanicalAvailability(i.asset) !== "unavailable", local: botanicalAvailability(i.asset) === "local_review" })) })), []);
  const all = sections.flatMap((s) => s.items);
  const [selected, setSelected] = useState(all.find((i) => i.available)?.asset ?? null);
  const current = all.find((i) => i.asset === selected) ?? null;
  const ready = all.filter((i) => i.available).length;
  const topPad = insets.top + (Platform.OS === "web" ? 16 : 6);

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <IconButton palette="fixedLight" icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <Text style={styles.title} accessibilityRole="header">How an apple tree grows</Text>
      </View>
      {current ? (
        <View style={styles.viewerWrap}>
          <BotanicalModelView assetId={current.asset} label={`${current.name}. ${current.note}`} style={styles.viewer} />
          <View style={styles.caption}>
            <Text style={styles.captionTitle}>{current.name}</Text>
            <Text style={styles.captionText}>{current.note}</Text>
            {current.local ? <Text style={styles.local}>Local review copy — not yet published in the app.</Text> : null}
          </View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.note} accessible accessibilityRole="text">
          <Ionicons name="information-circle-outline" size={16} color={colors.primaryGreen} />
          <Text style={styles.noteText}>{LIFECYCLE_NOTE}</Text>
        </View>
        <Text style={styles.meta}>{ready} of {all.length} models available{ready < all.length ? " · the others are prepared and will appear once published" : ""}.</Text>
        {sections.map((s) => (
          <View key={s.id} style={{ gap: 8 }}>
            <Text style={styles.section} accessibilityRole="header">{s.title}</Text>
            <Text style={styles.meta}>{s.intro}</Text>
            {s.items.map((i) => {
              const on = i.asset === selected;
              return (
                <TouchableOpacity key={i.asset} disabled={!i.available} onPress={() => setSelected(i.asset)} style={[styles.row, on && styles.rowOn, !i.available && styles.rowOff]}
                  accessibilityRole="button" accessibilityState={{ selected: on, disabled: !i.available }}
                  accessibilityLabel={`${i.name}. ${i.available ? (on ? "Showing in 3D" : "Show in 3D") : "Not available yet"}`}>
                  <Ionicons name={i.available ? (on ? "cube" : "cube-outline") : "time-outline"} size={18} color={i.available ? colors.primaryGreen : colors.textMuted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle}>{i.name}</Text>
                    <Text style={styles.rowNote} numberOfLines={2}>{i.available ? i.note : "Not available yet"}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  viewerWrap: { marginHorizontal: 12, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: colors.card },
  viewer: { height: 300 },
  caption: { padding: 12, gap: 3 },
  captionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark },
  captionText: { fontSize: 13.5, fontFamily: "Inter_400Regular", color: colors.textMid, lineHeight: 19 },
  local: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.amber },
  note: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 12, padding: 10 },
  noteText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: colors.textMid, lineHeight: 18 },
  section: { fontSize: 13, letterSpacing: 0.6, fontFamily: "Inter_700Bold", color: colors.textMuted, textTransform: "uppercase", marginTop: 6 },
  meta: { fontSize: 12.5, fontFamily: "Inter_400Regular", color: colors.textMuted, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, padding: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  rowOn: { borderColor: colors.primaryGreen, borderWidth: 2 },
  rowOff: { opacity: 0.6 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  rowNote: { fontSize: 12.5, fontFamily: "Inter_400Regular", color: colors.textMid, lineHeight: 17 },
});
