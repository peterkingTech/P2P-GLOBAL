// PROGRESSIVE DISCLOSURE — shared patterns for the app-wide UI refinement (owner brief 2026-11-19 "Show what matters
// now. Reveal additional information when needed."). One look everywhere:
//   • SectionHeader   — a section title with an optional "See all" (or any one trailing action);
//   • Collapsible     — a section that opens on demand (content kept mounted once opened, so state survives);
//   • EmptyNote       — a one-line empty state with an optional action (never a big empty card);
//   • FilterSheet     — one "Filters" button → a bottom sheet of grouped options, the selection shown as small
//                       removable chips, and Reset;
//   • ActiveFilters   — the compact summary of chosen filters.
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import AppButton from "./AppButton";
import { Chip, FilterChip, ChipRow } from "./Chip";

export function SectionHeader({ title, actionLabel = "See all", onAction, count }: { title: string; actionLabel?: string; onAction?: () => void; count?: number | null }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.header}>
      <Text style={s.headerTitle} accessibilityRole="header">{title}{count != null ? <Text style={s.headerCount}>  {count}</Text> : null}</Text>
      {onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${actionLabel}: ${title}`} style={s.seeAll}>
          <Text style={s.seeAllText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={c.accentGreen} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Collapsible({ title, summary, initiallyOpen = false, children, icon }: { title: string; summary?: string | null; initiallyOpen?: boolean; children: React.ReactNode; icon?: keyof typeof Ionicons.glyphMap }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(initiallyOpen);
  const [mounted, setMounted] = useState(initiallyOpen);
  return (
    <View style={s.collapsible}>
      <Pressable style={s.collapsibleHead} onPress={() => { setOpen((o) => !o); setMounted(true); }} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}${summary ? `, ${summary}` : ""}`}>
        {icon ? <Ionicons name={icon} size={18} color={c.accentGreen} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.collapsibleTitle}>{title}</Text>
          {summary && !open ? <Text style={s.collapsibleSummary} numberOfLines={1}>{summary}</Text> : null}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
      </Pressable>
      {mounted ? <View style={[s.collapsibleBody, !open && { display: "none" }]}>{children}</View> : null}
    </View>
  );
}

export function EmptyNote({ text, actionLabel, onAction, icon = "information-circle-outline" }: { text: string; actionLabel?: string; onAction?: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={16} color={c.textMuted} />
      <Text style={s.emptyText}>{text}</Text>
      {actionLabel && onAction ? <AppButton size="sm" variant="tertiary" label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export interface FilterGroup { key: string; title: string; multi?: boolean; options: { value: string; label: string }[] }
export type FilterValue = Record<string, string[]>;
/** The "Filters" button + bottom sheet. `value` per group; `defaults` is what Reset returns to. */
export function FilterSheet({ groups, value, defaults, onChange, label = "Filters" }: { groups: FilterGroup[]; value: FilterValue; defaults: FilterValue; onChange: (v: FilterValue) => void; label?: string }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);
  const changed = groups.filter((g) => JSON.stringify([...(value[g.key] ?? [])].sort()) !== JSON.stringify([...(defaults[g.key] ?? [])].sort())).length;
  const toggle = (g: FilterGroup, v: string) => {
    const cur = value[g.key] ?? [];
    const next = g.multi ? (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]) : cur[0] === v && !(defaults[g.key] ?? []).includes(v) ? [...(defaults[g.key] ?? [])] : [v];
    onChange({ ...value, [g.key]: next });
  };
  return (
    <>
      <Pressable style={[s.filterBtn, changed > 0 && s.filterBtnOn]} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}${changed ? `, ${changed} chosen` : ""}`}>
        <Ionicons name="options-outline" size={16} color={changed ? c.accentGreen : c.textMid} />
        <Text style={[s.filterBtnText, changed > 0 && { color: c.accentGreen }]}>{label}{changed ? ` · ${changed}` : ""}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close filters" />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle} accessibilityRole="header">{label}</Text>
            <AppButton size="sm" variant="tertiary" label="Reset" onPress={() => onChange(JSON.parse(JSON.stringify(defaults)))} disabled={!changed} />
          </View>
          <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            {groups.map((g) => (
              <View key={g.key} style={{ gap: 6 }}>
                <Text style={s.groupTitle}>{g.title}</Text>
                <ChipRow accessibilityLabel={g.title} single={!g.multi}>
                  {g.options.map((o) => <FilterChip key={o.value} label={o.label} selected={(value[g.key] ?? []).includes(o.value)} selection={g.multi ? undefined : "single"} onPress={() => toggle(g, o.value)} />)}
                </ChipRow>
              </View>
            ))}
          </ScrollView>
          <AppButton label="Done" fullWidth onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

/** Chosen filters as small removable chips (only those that differ from the defaults). */
export function ActiveFilters({ groups, value, defaults, onChange }: { groups: FilterGroup[]; value: FilterValue; defaults: FilterValue; onChange: (v: FilterValue) => void }) {
  const chosen = groups.flatMap((g) => (value[g.key] ?? []).filter((v) => !(defaults[g.key] ?? []).includes(v)).map((v) => ({ g, v, label: g.options.find((o) => o.value === v)?.label ?? v })));
  if (!chosen.length) return null;
  return (
    <ChipRow accessibilityLabel="Chosen filters">
      {chosen.map(({ g, v, label }) => (
        <Chip key={`${g.key}:${v}`} label={label} icon="close" onPress={() => onChange({ ...value, [g.key]: g.multi ? (value[g.key] ?? []).filter((x) => x !== v) : [...(defaults[g.key] ?? [])] })} accessibilityLabel={`Remove filter ${label}`} />
      ))}
    </ChipRow>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 8, gap: 8 },
    headerTitle: { flexShrink: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    headerCount: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32 },
    seeAllText: { fontSize: 13.5, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    collapsible: { borderRadius: 14, backgroundColor: c.card, overflow: "hidden" },
    collapsibleHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 52 },
    collapsibleTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    collapsibleSummary: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular" },
    collapsibleBody: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
    empty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, flexWrap: "wrap" },
    emptyText: { flexShrink: 1, fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    filterBtnOn: { borderColor: c.accentGreen },
    filterBtnText: { fontSize: 13.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "80%", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 34, gap: 12, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: c.lightCream },
    grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderBeige },
    sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sheetTitle: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    groupTitle: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  });
}
