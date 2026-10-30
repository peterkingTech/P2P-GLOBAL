import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Chip, Pill, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { getCalendar, type CalendarEvent } from "@/lib/studioApi";
import { ACTION_LABELS, SCHEDULE_STATUS_LABELS, dateKeyInZone, deviceTimeZone, eventsByDay, formatInZone, gridRange, isOverdue, monthGrid } from "@/lib/studioModel";
import { IconButton } from "@/components/ui";

// Content Calendar: scheduled jobs (all statuses) and publications of
// Kingdom Stories for the visible month, grouped by day in the device's time
// zone. Read view — scheduling, rescheduling and cancelling happen in the
// Schedule Editor, which goes through the API's approval and permission checks.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function StudioCalendar() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tz = deviceTimeZone();
  const todayKey = dateKeyInZone(new Date().toISOString(), tz);
  const [view, setView] = useState<"month" | "agenda">(width >= 700 ? "month" : "agenda");
  const [cursor, setCursor] = useState(() => ({ y: Number(todayKey.slice(0, 4)), m: Number(todayKey.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState(todayKey);
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const range = useMemo(() => gridRange(grid), [grid]);
  const { data, loading, error, reload } = useStudioQuery(() => getCalendar(range.from, range.to), [range.from, range.to]);
  const events = useMemo(() => eventsByDay(data?.events ?? [], tz), [data, tz]);
  const now = Date.now();
  const agenda = useMemo(() => Array.from(events.entries()).filter(([k]) => grid.some((w) => w.some((c) => c.inMonth && c.key === k))).sort(([a], [b]) => (a < b ? -1 : 1)), [events, grid]);

  const move = (delta: number) => setCursor(({ y, m }) => { const t = m + delta; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; });
  const cell = Math.max(44, Math.min(160, Math.floor((width - 28 - 6 * 4) / 7)));
  const gridWidth = cell * 7 + 6 * 4;
  const open = (e: CalendarEvent) => router.push({ pathname: "/admin/studio/schedule", params: { sourceId: e.sourceId } } as any);

  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.content}>
      <View style={ss.row}>
        <Pill label="Month" selected={view === "month"} onPress={() => setView("month")} />
        <Pill label="Agenda" selected={view === "agenda"} onPress={() => setView("agenda")} />
        <Text style={[ss.meta, { marginLeft: "auto" }]}>Days in {tz}</Text>
      </View>
      <View style={[ss.row, { justifyContent: "space-between", width: view === "month" ? gridWidth : undefined, alignSelf: "center" }]}>
        <NavBtn icon="chevron-back" label="Previous month" onPress={() => move(-1)} />
        <Text style={ss.h2} accessibilityRole="header">{MONTHS[cursor.m]} {cursor.y}</Text>
        <NavBtn icon="chevron-forward" label="Next month" onPress={() => move(1)} />
      </View>

      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : view === "month" ? (
        <View style={{ width: gridWidth, alignSelf: "center", gap: 4 }}>
          <View style={styles.weekRow}>{WEEKDAYS.map((d) => <Text key={d} style={[styles.weekday, { width: cell }]}>{d}</Text>)}</View>
          {grid.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((c) => {
                const list = events.get(c.key) ?? [];
                const problem = list.some((e) => isOverdue(e, now) || (e.kind === "schedule" && e.status === "failed"));
                const isSel = c.key === selected;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.cell, { width: cell, minHeight: Math.min(cell, 84) }, !c.inMonth && styles.cellOut, c.key === todayKey && styles.cellToday, isSel && styles.cellSel]}
                    onPress={() => setSelected(c.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.key}${list.length ? `, ${list.length} item${list.length > 1 ? "s" : ""}` : ""}${problem ? ", needs attention" : ""}`}
                    accessibilityState={{ selected: isSel }}
                    aria-selected={isSel}
                  >
                    <Text style={[styles.dayNum, !c.inMonth && { color: colors.textMutedLight }]}>{c.day}</Text>
                    {list.length ? <View style={[styles.badge, problem && styles.badgeRed]}><Text style={styles.badgeText}>{list.length}{problem ? "!" : ""}</Text></View> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <Text style={[ss.h2, { marginTop: 8 }]} accessibilityRole="header">{selected}</Text>
          {(events.get(selected) ?? []).length === 0 ? <Text style={ss.meta}>Nothing scheduled or published on this day.</Text>
            : (events.get(selected) ?? []).map((e) => <EventRow key={e.id} e={e} tz={tz} now={now} onOpen={() => open(e)} />)}
        </View>
      ) : agenda.length === 0 ? <StateView empty emptyText="Nothing scheduled or published this month." /> : agenda.map(([k, list]) => (
        <View key={k} style={{ gap: 6 }}>
          <Text style={ss.h2} accessibilityRole="header">{k === todayKey ? `Today · ${k}` : k}</Text>
          {list.map((e) => <EventRow key={e.id} e={e} tz={tz} now={now} onOpen={() => open(e)} />)}
        </View>
      ))}
      <Banner tone="info" text="Every scheduled job is listed, including finished and cancelled ones; each story's History has its full record." />
    </ScrollView>
  );
}

function EventRow({ e, tz, now, onOpen }: { e: CalendarEvent; tz: string; now: number; onOpen: () => void }) {
  const overdue = isOverdue(e, now);
  const tone = e.kind === "published" ? "green" : e.status === "failed" || overdue ? "red" : e.status === "running" ? "amber" : e.status === "pending" ? "blue" : "grey";
  const status = e.kind === "published" ? "Published" : overdue ? "Overdue" : SCHEDULE_STATUS_LABELS[e.status];
  return (
    <TouchableOpacity style={styles.event} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${e.kind === "schedule" ? ACTION_LABELS[e.action] : "Published"}: ${e.title}, ${status}, ${formatInZone(e.at, tz)}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ss.title} numberOfLines={1}>{e.title}</Text>
        <Text style={ss.meta}>{e.kind === "schedule" ? `${ACTION_LABELS[e.action]} · ` : ""}{formatInZone(e.at, tz)}{e.kind === "schedule" && e.lastError ? ` · ${e.lastError}` : ""}</Text>
      </View>
      <Chip label={status} tone={tone} />
    </TouchableOpacity>
  );
}

function NavBtn({ icon, label, onPress }: { icon: "chevron-back" | "chevron-forward"; label: string; onPress: () => void }) {
  return (
    <IconButton icon={icon} accessibilityLabel={label} onPress={onPress} variant="tinted" color={colors.primaryGreen} palette="fixedLight" />
  );
}

const styles = StyleSheet.create({
  weekRow: { flexDirection: "row", gap: 4 },
  weekday: { textAlign: "center", fontSize: 11, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  cell: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, padding: 4, alignItems: "center", gap: 4 },
  cellOut: { opacity: 0.5 },
  cellToday: { borderColor: colors.accentGreen, borderWidth: 2 },
  cellSel: { backgroundColor: "#E3F4EC" },
  dayNum: { fontSize: 12, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  badge: { backgroundColor: colors.primaryGreen, borderRadius: 9, paddingHorizontal: 6, minWidth: 18, alignItems: "center" },
  badgeRed: { backgroundColor: "#B91C1C" },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  event: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, minHeight: 48 },
});
