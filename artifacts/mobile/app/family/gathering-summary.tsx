import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { getFamilyDetail, getWorshipSessionSummary, updateGuideSummary, updateContinuityNotes, type WorshipSessionSummary } from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function providerLabel(provider: string): string {
  if (provider === "youtube") return "YouTube";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// Mirrors the MODES list in app/family/worship/[sessionId].tsx exactly —
// the timeline must show the same labels a Guide actually tapped
// ("Media", "Bible"...), never the internal mode keys ("worship").
const MODE_LABEL: Record<string, string> = {
  worship: "Media", scripture: "Bible", prayer: "Prayer", sharing: "Share", silent_prayer: "Mute", teaching: "Study Workspace",
};

const TIMELINE_LABEL: Record<string, (data: Record<string, unknown> | null) => string> = {
  started: () => "Gathering started",
  ended: () => "Gathering ended",
  mode_changed: (d) => `Switched to ${MODE_LABEL[d?.mode as string] ?? "a new"} mode`,
  scripture_changed: (d) => (d?.reference ? `Scripture opened: ${d.reference}` : "Scripture opened"),
  media_played: (d) => (d?.id ? `Media played (${providerLabel((d.provider as string) ?? "media")})` : "Media played"),
  lesson_attached: (d) => (d?.lessonTitle ? `Lesson attached: ${d.lessonTitle}` : "Lesson attached"),
};

// Shared by Guide's Summary and Continuity Notes below — both are the same
// "optional, manual, plain text, Guide/Shepherd-editable" shape (Stage 1 §7,
// Stage 2 §13); the only difference is which field they read/write.
function EditableNoteSection({
  title, value, placeholder, emptyText, canEdit, addLinkText, styles, colors: c, onSave,
}: {
  title: string; value: string | null; placeholder: string; emptyText: string; canEdit: boolean; addLinkText: string;
  styles: ReturnType<typeof makeStyles>; colors: AppColors; onSave: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDraft(value ?? "");
    setEditing(true);
  }
  async function save() {
    if (draft.length > 2000) {
      showAlert("Too long", `${title} must be 2000 characters or fewer.`);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {editing ? (
        <>
          <TextInput
            style={styles.textArea}
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={c.textMuted}
          />
          <View style={styles.editRow}>
            <TouchableOpacity style={styles.secondaryBtnSmall} onPress={() => setEditing(false)} disabled={saving}>
              <Text style={styles.secondaryBtnSmallText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtnSmall} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnSmallText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : value ? (
        <>
          <Text style={styles.bodyText}>{value}</Text>
          {canEdit && (
            <TouchableOpacity onPress={startEditing} style={{ marginTop: 8 }}>
              <Text style={styles.linkText}>Edit</Text>
            </TouchableOpacity>
          )}
        </>
      ) : canEdit ? (
        <TouchableOpacity onPress={startEditing}>
          <Text style={styles.linkText}>{addLinkText}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.emptyText}>{emptyText}</Text>
      )}
    </View>
  );
}

// The Session Summary detail screen — a read-only, derived view over the
// existing Family Gathering session tables (p2p_family_worship_history +
// the new session_events log). There is no AI-generated interpretation
// anywhere on this screen; every section below is either a stored fact,
// an aggregate count, or the Guide's own manually-written text.
export default function GatheringSummaryScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { user } = useAuth();
  const { historyId, familyId } = useLocalSearchParams<{ historyId: string; familyId: string }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<WorshipSessionSummary | null>(null);
  const [familyName, setFamilyName] = useState<string>("");
  const [isShepherd, setIsShepherd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!historyId) return;
    try {
      setError(null);
      const [s, fam] = await Promise.all([
        getWorshipSessionSummary(historyId),
        familyId ? getFamilyDetail(familyId).catch(() => null) : Promise.resolve(null),
      ]);
      setSummary(s);
      if (fam) {
        setFamilyName(fam.family.name);
        setIsShepherd(fam.myRole === "shepherd");
      }
    } catch (e: any) {
      setError(e.message ?? "Couldn't load this Gathering's summary.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [historyId, familyId]);

  useEffect(() => { load(); }, [load]);

  const canEditGuideSummary = !!summary && !!user && (summary.guide?.id === user.id || isShepherd);

  async function saveGuideSummary(text: string) {
    if (!historyId) return;
    await updateGuideSummary(historyId, text);
    setSummary((prev) => (prev ? { ...prev, guideSummary: text || null } : prev));
  }
  async function saveContinuityNotes(text: string) {
    if (!historyId) return;
    await updateContinuityNotes(historyId, text);
    setSummary((prev) => (prev ? { ...prev, continuityNotes: text || null } : prev));
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Session Summary" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Stack.Screen options={{ title: "Session Summary" }} />
        <Text style={{ color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" }}>
          {error ?? "This Gathering summary isn't available."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Session Summary" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        {/* Gathering Overview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gathering Overview</Text>
          {!!familyName && <Text style={styles.overviewLine}>Family: {familyName}</Text>}
          <Text style={styles.overviewLine}>Date: {formatDateTime(summary.startedAt)}</Text>
          <Text style={styles.overviewLine}>Duration: {formatDuration(summary.durationSeconds)}</Text>
          <Text style={styles.overviewLine}>Guide: {summary.guide?.name ?? "Unknown"}</Text>
          <Text style={styles.overviewLine}>
            Participants: {summary.participation.participantCount}
          </Text>
        </View>

        {/* Guide's Summary — optional, manual, never auto-generated */}
        <EditableNoteSection
          title="Guide's Summary"
          value={summary.guideSummary}
          placeholder="Write a short summary of this Gathering..."
          emptyText="The Guide didn't leave a summary for this Gathering."
          addLinkText="+ Add a summary"
          canEdit={canEditGuideSummary}
          styles={styles}
          colors={c}
          onSave={saveGuideSummary}
        />

        {/* Participation — informative, never a leaderboard */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Participation</Text>
          <Text style={styles.bodyText}>
            {summary.participation.participantCount} participant{summary.participation.participantCount === 1 ? "" : "s"} · {summary.participation.contributorCount} contributed (Share, Notes, or Prayer)
          </Text>
        </View>

        {/* Scripture */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scripture</Text>
          {summary.scripture.references.length === 0 ? (
            <Text style={styles.emptyText}>No Scripture was opened during this Gathering.</Text>
          ) : (
            summary.scripture.references.map((ref) => <Text key={ref} style={styles.bodyText}>• {ref}</Text>)
          )}
        </View>

        {/* Study / Lesson — references the existing curriculum, never a
            second copy of it; empty state when no lesson was attached. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Study</Text>
          {summary.study ? (
            <>
              <Text style={styles.bodyText}>{summary.study.lessonTitle}</Text>
              <Text style={styles.overviewLine}>
                {summary.study.moduleTitle}{summary.study.curriculumTitle ? ` · ${summary.study.curriculumTitle}` : ""}
              </Text>
              <TouchableOpacity onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: summary.study!.lessonId } } as any)} style={{ marginTop: 6 }}>
                <Text style={styles.linkText}>Open Lesson →</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.emptyText}>No Study Workspace lesson was linked to this Gathering.</Text>
          )}
        </View>

        {/* Prayer — aggregate counts only, family-visible requests only.
            An answered prayer's own text is shown only because its author
            explicitly marked it answered — never inferred. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prayer</Text>
          {summary.prayer.requestCount === 0 ? (
            <Text style={styles.emptyText}>No prayer requests were shared during this Gathering.</Text>
          ) : (
            <>
              <Text style={styles.bodyText}>{summary.prayer.requestCount} request{summary.prayer.requestCount === 1 ? "" : "s"} shared · {summary.prayer.contributorCount} participant{summary.prayer.contributorCount === 1 ? "" : "s"}</Text>
              <Text style={styles.bodyText}>{summary.prayer.scriptureLinkedCount} linked to Scripture · {summary.prayer.answeredCount} marked answered</Text>
              {summary.prayer.answeredPrayers.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  {summary.prayer.answeredPrayers.map((p) => (
                    <Text key={p.id} style={styles.bodyText}>✓ {p.content} — Answered</Text>
                  ))}
                </View>
              )}
              <TouchableOpacity onPress={() => router.push({ pathname: "/family/prayer", params: { familyId } } as any)} style={{ marginTop: 6 }}>
                <Text style={styles.linkText}>View Prayer →</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Media */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Media</Text>
          {summary.media.items.length === 0 ? (
            <Text style={styles.emptyText}>No media was played during this Gathering.</Text>
          ) : (
            summary.media.items.map((m) => (
              <Text key={`${m.provider}:${m.id}`} style={styles.bodyText}>• {providerLabel(m.provider)}</Text>
            ))
          )}
        </View>

        {/* Share / Discussion — aggregate counts only, no message content, no AI summarization */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Share</Text>
          {summary.share.messageCount === 0 ? (
            <Text style={styles.emptyText}>No messages were shared during this Gathering.</Text>
          ) : (
            <Text style={styles.bodyText}>{summary.share.messageCount} message{summary.share.messageCount === 1 ? "" : "s"} · {summary.share.contributorCount} participant{summary.share.contributorCount === 1 ? "" : "s"}</Text>
          )}
        </View>

        {/* Notes — never expose personal note content */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
          {summary.notes.authorCount === 0 ? (
            <Text style={styles.emptyText}>No notes were taken during this Gathering.</Text>
          ) : (
            <Text style={styles.bodyText}>{summary.notes.authorCount} participant{summary.notes.authorCount === 1 ? "" : "s"} took notes</Text>
          )}
        </View>

        {/* Participants */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Participants</Text>
          {summary.participants.length === 0 ? (
            <Text style={styles.emptyText}>No participant records for this Gathering.</Text>
          ) : (
            summary.participants.map((p) => <Text key={p.userId} style={styles.bodyText}>• {p.name}</Text>)
          )}
        </View>

        {/* Session Timeline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session Timeline</Text>
          {summary.timeline.length === 0 ? (
            <Text style={styles.emptyText}>No timeline events were recorded for this Gathering.</Text>
          ) : (
            summary.timeline.map((e, i) => (
              <Text key={i} style={styles.bodyText}>
                {formatTime(e.at)} — {(TIMELINE_LABEL[e.type] ?? (() => e.type))(e.data)}
              </Text>
            ))
          )}
        </View>

        {/* Continuity Notes — the Guide's optional "next time we should..."
            note (Stage 2). Manually written, never AI-generated, and
            deliberately separate from Guide's Summary above: this one
            looks forward, that one looks back. */}
        <EditableNoteSection
          title="Continuity Notes"
          value={summary.continuityNotes}
          placeholder="Next time we should..."
          emptyText="No continuity notes for this Gathering."
          addLinkText="+ Add a note for next time"
          canEdit={canEditGuideSummary}
          styles={styles}
          colors={c}
          onSave={saveContinuityNotes}
        />
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 12 },
    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 4 },
    sectionTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
    overviewLine: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    bodyText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19 },
    linkText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    textArea: {
      minHeight: 90, backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", textAlignVertical: "top",
    },
    editRow: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 10 },
    primaryBtnSmall: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
    primaryBtnSmallText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtnSmall: { borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
    secondaryBtnSmallText: { color: c.accentGreen, fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
