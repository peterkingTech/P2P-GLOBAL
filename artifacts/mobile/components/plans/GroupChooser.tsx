import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { SegmentedControl } from "@/components/ui";
import { groupsILead, type LedGroupCard } from "@/lib/studyPlansApi";

// P2P PLANS — Study Together: use an existing group the person LEADS (only those — a plan is attached by a
// group's leaders), or create a new private group from the plan, prefilled with the plan's title and
// description (editable). New groups are private (migration 245): only members see they exist.
export type GroupChoice =
  | { kind: "existing"; type: string; id: string; name: string | null }
  | { kind: "new"; name: string; description: string };

export default function GroupChooser({ value, onChange, defaultName, defaultDescription }: {
  value: GroupChoice | null; onChange: (g: GroupChoice | null) => void; defaultName: string; defaultDescription: string;
}) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [groups, setGroups] = useState<LedGroupCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mode = value?.kind ?? "existing";
  useEffect(() => { groupsILead().then((r) => setGroups(r.groups), (e) => { setGroups([]); setError(e?.message ?? null); }); }, []);
  useEffect(() => { if (value === null && groups && !groups.length) onChange({ kind: "new", name: defaultName, description: defaultDescription }); }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 10 }}>
      <SegmentedControl accessibilityLabel={t("p2pPlans.together.how")} value={mode}
        options={[{ value: "existing", label: t("p2pPlans.together.existing") }, { value: "new", label: t("p2pPlans.together.new") }]}
        onChange={(m) => onChange(m === "new" ? { kind: "new", name: defaultName, description: defaultDescription } : null)} />
      {mode === "existing" ? (
        !groups ? <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /> : groups.length ? groups.map((g) => {
          const busy = !!g.activePlan;
          const on = value?.kind === "existing" && value.id === g.id;
          return (
            <TouchableOpacity key={`${g.type}:${g.id}`} style={[s.group, on && s.groupOn, busy && s.groupBusy]} disabled={busy} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: busy }}
              onPress={() => onChange({ kind: "existing", type: g.type, id: g.id, name: g.name })}
              accessibilityLabel={`${g.name ?? t("p2pPlans.together.group")}. ${t("p2pPlans.together.members", { count: g.members })}${busy ? `. ${t("p2pPlans.together.hasActive", { title: g.activePlan!.title })}` : ""}`}>
              <View style={s.avatar}><Ionicons name={g.type === "family" ? "home-outline" : g.type === "church" ? "business-outline" : "people-outline"} size={18} color={c.accentGreen} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.groupName}>{g.name ?? t("p2pPlans.together.group")}</Text>
                {g.description ? <Text style={s.small} numberOfLines={1}>{g.description}</Text> : null}
                <Text style={s.small}>{t(`p2pPlans.together.kind.${g.type}`)} · {t("p2pPlans.together.members", { count: g.members })}{g.completedPlans ? ` · ${t("p2pPlans.together.completedCount", { count: g.completedPlans })}` : ""}</Text>
                {busy ? <Text style={s.busy}>{t("p2pPlans.together.hasActive", { title: g.activePlan!.title })}</Text> : null}
              </View>
              {on ? <Ionicons name="checkmark-circle" size={22} color={c.primaryGreen} /> : null}
            </TouchableOpacity>
          );
        }) : <Text style={s.meta}>{error ?? t("p2pPlans.together.noneLed")}</Text>
      ) : value?.kind === "new" ? (
        <View style={s.card}>
          <Text style={s.label}>{t("p2pPlans.together.groupName")}</Text>
          <TextInput value={value.name} onChangeText={(v) => onChange({ ...value, name: v.slice(0, 80) })} style={s.input} accessibilityLabel={t("p2pPlans.together.groupName")} />
          <Text style={s.label}>{t("p2pPlans.together.groupDescription")}</Text>
          <TextInput value={value.description} onChangeText={(v) => onChange({ ...value, description: v.slice(0, 1000) })} style={[s.input, { minHeight: 64 }]} multiline accessibilityLabel={t("p2pPlans.together.groupDescription")} />
          <View style={s.noteRow}><Ionicons name="lock-closed-outline" size={14} color={c.textMid} /><Text style={s.small}>{t("p2pPlans.together.privateNote")}</Text></View>
          <Text style={s.small}>{t("p2pPlans.together.prefilled")}</Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    group: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, minHeight: 56 },
    groupOn: { borderColor: c.primaryGreen, borderWidth: 1.5 },
    groupBusy: { opacity: 0.6 },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.cardBeige },
    groupName: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    busy: { fontSize: 12.5, color: c.amber, fontFamily: "Inter_600SemiBold" },
    card: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
    noteRow: { flexDirection: "row", gap: 6, alignItems: "center" },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, flexShrink: 1 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
  });
}
