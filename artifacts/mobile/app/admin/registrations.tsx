import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// ── Types ─────────────────────────────────────────────────────────────────────

type FollowUpStatus = "not_contacted" | "contacted" | "in_progress" | "resolved";

type RegSummary = {
  id: string;
  full_name: string;
  email: string;
  location_city: string;
  location_country: string;
  faith_journey_stage: number;
  follow_up_status: FollowUpStatus;
  submitted_at: string;
};

type RegDetail = RegSummary & {
  contact: string | null;
  primary_language: string;
  other_languages: string[];
  born_again: string;
  born_again_other: string | null;
  walking_with_christ_duration: string;
  church_involvement: string | null;
  admin_notes: string | null;
  user_id: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: FollowUpStatus | "all"; label: string; color: string }[] = [
  { value: "all", label: "All", color: colors.textMuted },
  { value: "not_contacted", label: "Not contacted", color: "#B45309" },
  { value: "contacted", label: "Contacted", color: colors.accentGreen },
  { value: "in_progress", label: "In progress", color: "#1D4ED8" },
  { value: "resolved", label: "Resolved", color: colors.textMuted },
];

const DURATION_LABELS: Record<string, string> = {
  less_than_1_year: "< 1 year",
  "1_3_years": "1–3 years",
  "3_10_years": "3–10 years",
  "10_plus_years": "10+ years",
};

const FAITH_STAGE_SHORT = ["Exploring", "New believer", "Growing", "Established", "Leading others"];

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function RegistrationsScreen() {
  const insets = useSafeAreaInsets();
  const [registrations, setRegistrations] = useState<RegSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FollowUpStatus | "all">("all");
  const [selected, setSelected] = useState<RegDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftStatus, setDraftStatus] = useState<FollowUpStatus>("not_contacted");

  const fetchList = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("p2p_registration_profiles")
      .select("id,full_name,email,location_city,location_country,faith_journey_stage,follow_up_status,submitted_at")
      .order("submitted_at", { ascending: false });

    if (statusFilter !== "all") query = query.eq("follow_up_status", statusFilter);
    if (search.trim()) {
      query = query.or(`full_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%`);
    }

    const { data, error } = await query;
    if (!error) setRegistrations((data ?? []) as RegSummary[]);
    setLoading(false);
  }, [search, statusFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("p2p_registration_profiles")
      .select("*")
      .eq("id", id)
      .single();
    setDetailLoading(false);
    if (!error && data) {
      const r = data as RegDetail;
      setSelected(r);
      setDraftNotes(r.admin_notes ?? "");
      setDraftStatus(r.follow_up_status);
    }
  }

  async function saveAdmin() {
    if (!selected) return;
    setSavingNotes(true);
    const { data, error } = await supabase
      .from("p2p_registration_profiles")
      .update({ follow_up_status: draftStatus, admin_notes: draftNotes })
      .eq("id", selected.id)
      .select()
      .single();
    setSavingNotes(false);
    if (!error && data) {
      const updated = data as RegDetail;
      setSelected(updated);
      setRegistrations((prev) =>
        prev.map((r) =>
          r.id === updated.id
            ? { ...r, follow_up_status: updated.follow_up_status }
            : r
        )
      );
    }
  }

  // ── Detail Panel ────────────────────────────────────────────────────────────

  if (selected) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.detailContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
      >
        <TouchableOpacity style={styles.detailBack} onPress={() => setSelected(null)}>
          <Ionicons name="arrow-back" size={18} color={colors.accentGreen} />
          <Text style={styles.detailBackText}>Back to list</Text>
        </TouchableOpacity>

        <Text style={styles.detailName}>{selected.full_name}</Text>
        <Text style={styles.detailEmail}>{selected.email}</Text>
        <Text style={styles.detailMeta}>
          {selected.location_city}, {selected.location_country} ·{" "}
          {new Date(selected.submitted_at).toLocaleDateString()}
        </Text>

        <SectionCard title="Basic Information">
          <DetailRow label="Contact" value={selected.contact ?? "—"} />
          <DetailRow label="Primary Language" value={selected.primary_language.toUpperCase()} />
          <DetailRow
            label="Other Languages"
            value={selected.other_languages?.join(", ").toUpperCase() || "—"}
          />
        </SectionCard>

        <SectionCard title="Spiritual Background">
          <DetailRow
            label="Faith Journey Stage"
            value={`${selected.faith_journey_stage} — ${FAITH_STAGE_SHORT[selected.faith_journey_stage - 1] ?? ""}`}
          />
          <DetailRow
            label="Born Again"
            value={
              selected.born_again === "other"
                ? `Other: ${selected.born_again_other ?? ""}`
                : selected.born_again
            }
          />
          <DetailRow
            label="Walking with Christ"
            value={DURATION_LABELS[selected.walking_with_christ_duration] ?? selected.walking_with_christ_duration}
          />
          <DetailRow
            label="Church Involvement"
            value={selected.church_involvement ?? "—"}
            multiline
          />
        </SectionCard>

        <SectionCard title="Follow-up">
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.statusPills}>
            {STATUS_OPTIONS.filter((o) => o.value !== "all").map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[
                  styles.statusPill,
                  draftStatus === o.value && { backgroundColor: o.color, borderColor: o.color },
                ]}
                onPress={() => setDraftStatus(o.value as FollowUpStatus)}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    draftStatus === o.value && { color: "#fff" },
                  ]}
                >
                  {o.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Admin Notes</Text>
          <TextInput
            style={styles.notesInput}
            value={draftNotes}
            onChangeText={setDraftNotes}
            placeholder="Add notes about this person…"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={[styles.saveBtn, savingNotes && { opacity: 0.7 }]}
            onPress={saveAdmin}
            disabled={savingNotes}
          >
            {savingNotes ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </SectionCard>
      </ScrollView>
    );
  }

  // ── List Panel ──────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or email…"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchList}>
          <Ionicons name="refresh" size={18} color={colors.accentGreen} />
        </TouchableOpacity>
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_OPTIONS.map((o) => {
          const active = statusFilter === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.filterChip, active && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen }]}
              onPress={() => setStatusFilter(o.value as any)}
            >
              <Text style={[styles.filterChipText, active && { color: "#fff" }]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 48 }} color={colors.accentGreen} />
      ) : registrations.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No registrations found</Text>
        </View>
      ) : (
        <FlatList
          data={registrations}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            const statusColor = STATUS_OPTIONS.find((s) => s.value === item.follow_up_status)?.color ?? colors.textMuted;
            return (
              <TouchableOpacity
                style={styles.regCard}
                onPress={() => openDetail(item.id)}
                activeOpacity={0.85}
              >
                <View style={styles.regCardMain}>
                  <Text style={styles.regName}>{item.full_name}</Text>
                  <Text style={styles.regEmail}>{item.email}</Text>
                  <Text style={styles.regMeta}>
                    {item.location_city}, {item.location_country} ·{" "}
                    Stage {item.faith_journey_stage}
                  </Text>
                </View>
                <View style={styles.regRight}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusLabel, { color: statusColor }]}>
                    {STATUS_OPTIONS.find((s) => s.value === item.follow_up_status)?.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginTop: 4 }} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {detailLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.accentGreen} size="large" />
        </View>
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionCardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowLabel}>{label}</Text>
      <Text style={[styles.detailRowValue, multiline && { flex: 1 }]}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },

  // Search
  searchRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  refreshBtn: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.1)",
    alignItems: "center", justifyContent: "center",
  },

  // Filter chips
  filterRow: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff",
  },
  filterChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  regCard: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, flexDirection: "row", gap: 12,
  },
  regCardMain: { flex: 1, gap: 3 },
  regName: { fontSize: 15, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  regEmail: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  regMeta: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  regRight: { alignItems: "flex-end", gap: 4, minWidth: 90 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "right" },

  // Empty
  emptyWrap: { alignItems: "center", marginTop: 80, gap: 12 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  // Overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center", justifyContent: "center",
  },

  // Detail
  detailContent: { padding: 20, gap: 16 },
  detailBack: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  detailBackText: { color: colors.accentGreen, fontSize: 14, fontFamily: "Inter_500Medium" },
  detailName: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  detailEmail: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  detailMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  sectionCard: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, gap: 10,
  },
  sectionCardTitle: {
    fontSize: 13, fontWeight: "700", color: colors.textMid,
    fontFamily: "Inter_700Bold", textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 4,
  },
  detailRow: { flexDirection: "row", gap: 8 },
  detailRowLabel: {
    fontSize: 13, color: colors.textMuted,
    fontFamily: "Inter_500Medium", width: 130, flexShrink: 0,
  },
  detailRowValue: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", flex: 1 },

  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  statusPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  statusPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  statusPillText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  notesInput: {
    backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 12, minHeight: 100,
    fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
    marginTop: 6,
  },
  saveBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 12, height: 46,
    alignItems: "center", justifyContent: "center", marginTop: 12,
  },
  saveBtnText: { fontSize: 15, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },
});
