import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { useAdaptiveTiles } from "@/hooks/useLayout";
import { MyP2PWidget } from "@/components/myp2p/MyP2PWidgets";
import {
  DEFAULT_LAYOUT, loadLayout, saveLayout, visibleWidgets, moveWidget, setWidgetVisible, widgetInfo, type Layout,
} from "@/lib/myP2P";
import { AppButton, IconButton } from "@/components/ui";

// My P2P dashboard: the person's widgets in their chosen order (Home shows
// it; /my-p2p shows it with Customize). Widgets refresh whenever the screen
// regains focus. Customize: show/hide (the two discipleship widgets always
// stay), move up/down, restore the default layout — saved per account.

export default function MyP2PDashboard({ editable = false, onCustomize }: { editable?: boolean; onCustomize?: () => void }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { profile } = useAuth();
  const router = useRouter();
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const grid = useAdaptiveTiles({ minItemWidth: 320, maxColumns: 2, gap: 12, columnChoices: [1, 2] });

  useEffect(() => { if (profile?.id) loadLayout(profile.id).then(setLayout); }, [profile?.id]);
  useFocusEffect(useCallback(() => { setRefreshKey((k) => k + 1); if (profile?.id) loadLayout(profile.id).then(setLayout); }, [profile?.id]));

  const update = (next: Layout) => { setLayout(next); if (profile?.id) void saveLayout(profile.id, next); };
  const shown = visibleWidgets(layout);

  return (
    <View style={{ gap: 12 }}>
      <View style={s.headRow}>
        <Text style={s.heading} accessibilityRole="header">My P2P</Text>
        {editable ? (
          <AppButton label={editing ? "Done" : "Customize"} onPress={() => setEditing((e) => !e)} variant="tertiary" icon={editing ? "checkmark" : "options-outline"} />
        ) : (
          <AppButton label="Customize" onPress={onCustomize ?? (() => router.push("/my-p2p" as any))} variant="tertiary" icon="options-outline" accessibilityLabel="Customize My P2P" />
        )}
      </View>

      {editing ? (
        <View style={s.editor}>
          <Text style={s.meta}>Choose which cards appear and their order. My Discipleship Journey and Journal always stay.</Text>
          {layout.order.map((id, i) => {
            const info = widgetInfo(id);
            const on = !layout.hidden.includes(id);
            return (
              <View key={id} style={s.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.editTitle}>{info.title}{info.required ? " · always shown" : ""}</Text>
                  <Text style={s.meta}>{info.description}</Text>
                </View>
                <IconButton icon="arrow-up" accessibilityLabel={`Move ${info.title} up`} onPress={() => update(moveWidget(layout, id, -1))} color={i === 0 ? c.borderBeige : c.textMid} disabled={i === 0} />
                <IconButton icon="arrow-down" accessibilityLabel={`Move ${info.title} down`} onPress={() => update(moveWidget(layout, id, 1))} color={i === layout.order.length - 1 ? c.borderBeige : c.textMid} disabled={i === layout.order.length - 1} />
                <Switch value={on} disabled={!!info.required} onValueChange={(v) => update(setWidgetVisible(layout, id, v))} accessibilityLabel={`Show ${info.title}`} />
              </View>
            );
          })}
          <AppButton label="Restore the default layout" onPress={() => update({ ...DEFAULT_LAYOUT, journalPreview: layout.journalPreview })} variant="tertiary" style={{ alignSelf: "flex-start" }} />
        </View>
      ) : (
        <View style={[s.grid, grid.containerStyle]} onLayout={grid.onLayout}>
          {shown.map((id) => (
            <View key={id} style={[{ width: "100%" }, grid.tileStyle]}>
              <MyP2PWidget id={id} refreshKey={refreshKey} journalPreview={layout.journalPreview}
                onToggleJournalPreview={() => update({ ...layout, journalPreview: !layout.journalPreview })} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    heading: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    editor: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 6 },
    editRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    editTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    restore: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
    restoreText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  });
}
