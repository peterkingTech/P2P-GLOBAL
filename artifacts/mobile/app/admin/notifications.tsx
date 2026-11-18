// ADMIN › NOTIFICATIONS — the central panel (owner brief 2026-11-18). What every Admin Centre module needs from this
// administrator, newest first; only modules their roles open (decided by the server). Opening a notification goes
// to the exact record; reading it never resolves the underlying item — resolving happens in the module's own
// workflow, and the notification follows (Resolved).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { timeAgo } from "@/lib/timeFormat";
import { useAdminContentWidth } from "@/lib/adminLayout";
import {
  getNotificationPrefs, listNotifications, markNotifications, refreshSummary, saveNotificationPrefs, useAdminNotificationSummary,
  type AdminNotification, type NotificationFilter, type NotificationPrefs, type Priority,
} from "@/lib/adminNotificationsApi";

const FILTER_LABEL: Record<NotificationFilter, string> = { all: "All", unread: "Unread", action: "Action required", assigned: "Assigned to me", important: "Important", resolved: "Resolved" };
const PRIORITY: Record<Priority, { label: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = {
  critical: { label: "Critical", color: "#B42318", icon: "alert-circle" }, high: { label: "High", color: "#B54708", icon: "warning" },
  normal: { label: "Normal", color: colors.primaryGreen, icon: "notifications" }, info: { label: "Info", color: "#667085", icon: "information-circle" },
};
const CATEGORY_LABEL: Record<string, string> = { new_submissions: "New submissions", reviews: "Reviews and approvals", assigned: "Assigned tasks", overdue: "Overdue tasks", system: "Important system events", security: "Security alerts", crisis: "Crisis alerts" };
const MANDATORY = new Set(["security", "crisis"]);

export default function AdminNotifications() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const width = useAdminContentWidth();
  const summary = useAdminNotificationSummary();
  const [filter, setFilter] = useState<NotificationFilter>((Object.keys(FILTER_LABEL) as NotificationFilter[]).includes(params.filter as NotificationFilter) ? (params.filter as NotificationFilter) : "all");
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [filters, setFilters] = useState<{ key: NotificationFilter; count: number }[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  const load = useCallback(async (more = false) => {
    setLoading(true); setError(null);
    try {
      const r = await listNotifications({ filter, before: more ? next : null });
      setItems((cur) => (more ? [...cur, ...r.items] : r.items)); setFilters(r.filters); setNext(r.next); setPersisted(r.persisted);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [filter, next]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(false); }, [filter, summary?.unread, summary?.actionRequired]);
  useEffect(() => { getNotificationPrefs().then((r) => setPrefs(r.prefs)).catch(() => {}); }, []);

  const open = async (n: AdminNotification) => {
    if (n.unread) { await markNotifications("read", [n.id]).catch(() => {}); void refreshSummary(); }
    router.push({ pathname: n.route, params: n.params ?? {} } as any); // the exact record; the module re-checks permissions
  };
  const markAll = async () => { await markNotifications("read", "all").catch(() => {}); await refreshSummary(); await load(false); };
  const toggleRead = async (n: AdminNotification) => { await markNotifications(n.unread ? "read" : "unread", [n.id]).catch(() => {}); await refreshSummary(); await load(false); };
  const setCat = (k: string, v: boolean) => { if (!prefs || MANDATORY.has(k)) return; const p = { ...prefs, categories: { ...prefs.categories, [k]: v } }; setPrefs(p); void saveNotificationPrefs(p).then(() => refreshSummary()); };

  return (
    <>
      <Stack.Screen options={{ title: "Notifications" }} />
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16, gap: 12, width: "100%", maxWidth: Math.max(320, Math.min(width, 980)), alignSelf: "center" }}>
        <View style={s.headRow}>
          <Text style={s.h1} accessibilityRole="header">Notifications</Text>
          <View style={s.row}>
            {summary?.unread ? <AppButton size="sm" variant="secondary" icon="checkmark-done" label="Mark all as read" onPress={() => void markAll()} /> : null}
            <AppButton size="sm" variant="tertiary" icon="options-outline" label={showPrefs ? "Hide settings" : "Settings"} onPress={() => setShowPrefs((x) => !x)} />
          </View>
        </View>
        {!persisted ? <Text style={s.warn}>Notifications are rebuilt from each module every minute, but read status is only kept until the server restarts — apply migration 255 to keep it.</Text> : null}

        {showPrefs && prefs ? (
          <View style={s.card}>
            <Text style={s.h2}>What to notify me about</Text>
            {Object.keys(CATEGORY_LABEL).map((k) => (
              <View key={k} style={s.prefRow}>
                <Text style={s.prefLabel}>{CATEGORY_LABEL[k]}{MANDATORY.has(k) ? " · always on" : ""}</Text>
                <Switch value={prefs.categories[k] !== false} disabled={MANDATORY.has(k)} onValueChange={(v) => setCat(k, v)} accessibilityLabel={CATEGORY_LABEL[k]} trackColor={{ true: colors.primaryGreen, false: "#D0D5DD" }} thumbColor="#fff" />
              </View>
            ))}
            <View style={s.prefRow}>
              <Text style={s.prefLabel}>Sound for new critical alerts</Text>
              <Switch value={prefs.sound} onValueChange={(v) => { const p = { ...prefs, sound: v }; setPrefs(p); void saveNotificationPrefs(p); }} accessibilityLabel="Sound for new critical alerts" trackColor={{ true: colors.primaryGreen, false: "#D0D5DD" }} thumbColor="#fff" />
            </View>
            <Text style={s.note}>In-app notifications only. Security and crisis alerts can't be switched off. Items assigned to you always reach you.</Text>
          </View>
        ) : null}

        <ChipRow accessibilityLabel="Filter notifications" single>
          {filters.map((f) => <FilterChip key={f.key} label={`${FILTER_LABEL[f.key]} ${f.count}`} selected={filter === f.key} selection="single" onPress={() => setFilter(f.key)} />)}
        </ChipRow>

        {error ? <Text style={s.warn}>{error}</Text> : null}
        {!loading && !items.length ? <Text style={s.note}>{filter === "resolved" ? "Nothing resolved in the last 30 days." : "You're all caught up."}</Text> : null}
        {items.map((n) => {
          const p = PRIORITY[n.priority];
          return (
            <View key={n.id} style={[s.item, n.unread && s.itemUnread, n.priority === "critical" && n.status === "open" && s.itemCritical]}>
              <Pressable style={{ flexDirection: "row", gap: 10, flex: 1, minHeight: 44 }} onPress={() => void open(n)} accessibilityRole="link"
                accessibilityLabel={`${n.unread ? "Unread. " : ""}${p.label}. ${n.moduleLabel}. ${n.title}. Open`}>
                <Ionicons name={p.icon} size={20} color={p.color} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.meta}>{n.moduleLabel} · {timeAgo(n.remindedAt ?? n.occurredAt)}{n.remindedAt ? ` · reminder ${n.reminderCount}` : ""}{n.priority !== "normal" ? ` · ${p.label}` : ""}</Text>
                  <Text style={[s.title, n.unread && s.titleUnread]}>{n.title}</Text>
                  <Text style={s.desc}>{n.description}{n.actorLabel ? ` — ${n.actorLabel}` : ""}</Text>
                  <Text style={s.meta}>{n.status === "resolved" ? `Resolved ${n.resolvedAt ? timeAgo(n.resolvedAt) : ""}` : n.actionRequired ? "Action required" : "For information"}{n.dueAt && n.status === "open" && Date.parse(n.dueAt) < Date.now() ? " · overdue" : ""}</Text>
                </View>
              </Pressable>
              {n.status === "open" ? <Pressable onPress={() => void toggleRead(n)} style={s.readBtn} accessibilityRole="button" accessibilityLabel={n.unread ? "Mark as read" : "Mark as unread"}>
                <Ionicons name={n.unread ? "ellipse" : "ellipse-outline"} size={12} color={colors.primaryGreen} />
              </Pressable> : null}
            </View>
          );
        })}
        {next ? <AppButton variant="tertiary" label="Older notifications" loading={loading} onPress={() => void load(true)} /> : null}
        {summary?.notConnected?.length ? (
          <View style={s.card}>
            <Text style={s.h2}>Modules without notifications</Text>
            {summary.notConnected.map((m) => <Text key={m.module} style={s.note}>{m.module}: {m.reason}</Text>)}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  h1: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.textDark },
  h2: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.textDark },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.borderBeige },
  prefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40, gap: 8 },
  prefLabel: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_500Medium" },
  item: { flexDirection: "row", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.borderBeige },
  itemUnread: { borderColor: colors.primaryGreen, backgroundColor: "#F3F8F4" },
  itemCritical: { borderLeftWidth: 4, borderLeftColor: "#B42318" },
  meta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  title: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_500Medium" },
  titleUnread: { fontFamily: "Inter_700Bold" },
  desc: { fontSize: 13, color: colors.textMid, lineHeight: 18 },
  note: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  warn: { fontSize: 13, color: "#B54708", lineHeight: 18 },
  readBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
