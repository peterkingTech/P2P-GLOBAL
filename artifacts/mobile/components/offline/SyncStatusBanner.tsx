import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import { flush, useSyncStatus } from "@/lib/offline";
import { AppButton } from "@/components/ui";

// The one sync-status line (owner brief 2026-11-18 §11): shown only when it matters — offline, changes
// waiting, or a change that needs the person (a conflict or a failure). Silent when everything is in sync.
/** offlineNote: what this screen can't do without a connection (e.g. live messages and calls). */
export default function SyncStatusBanner({ offlineNote }: { offlineNote?: string } = {}) {
  const s = useSyncStatus();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const needs = s.conflicts.length + s.failed.length;
  if (s.online && !s.pending && !needs) return null;
  const text = [
    !s.online ? `${t("sync.offline", { defaultValue: "You're offline." })}${offlineNote ? ` ${offlineNote}` : ""}` : s.syncing ? t("sync.syncing", { defaultValue: "Syncing…" }) : "",
    s.pending ? t("sync.waiting", { defaultValue: "{{count}} change(s) waiting to sync.", count: s.pending }) : "",
    needs ? t("sync.needsYou", { defaultValue: "{{count}} change(s) couldn't be saved — open the item to choose what to keep.", count: needs }) : "",
  ].filter(Boolean).join(" ");
  return (
    <View style={[styles.bar, { backgroundColor: c.cardBeige, borderColor: needs ? c.amber : c.borderBeige }]} accessibilityLiveRegion="polite" accessibilityRole="summary">
      <Ionicons name={!s.online ? "cloud-offline-outline" : needs ? "alert-circle-outline" : "sync-outline"} size={18} color={c.textMid} />
      <Text style={[styles.text, { color: c.textMid }]}>{text}</Text>
      {s.online && s.pending && !s.syncing ? <AppButton label={t("sync.now", { defaultValue: "Sync now" })} size="sm" variant="tertiary" onPress={() => void flush()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  text: { flex: 1, fontSize: 14, lineHeight: 19 },
});
