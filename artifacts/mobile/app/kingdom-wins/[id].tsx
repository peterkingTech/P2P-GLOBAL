import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Linking, Share, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import {
  getKingdomWin, reactToKingdomWin, unreactToKingdomWin,
  KINGDOM_CATEGORY_LABELS, type KingdomWin, type KingdomReactionType,
} from "@/lib/kingdomWinsApi";
import { getScriptureReference, type ScriptureReference } from "@/lib/prayerTopicsApi";
import KingdomWinVideoPlayer from "@/components/KingdomWinVideoPlayer";
import SignedPhotoView from "@/components/SignedPhotoView";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const REACTIONS: { key: KingdomReactionType; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { key: "praying", icon: "hand-left-outline", label: "Pray" },
  { key: "amen", icon: "hand-right-outline", label: "Amen" },
  { key: "encourage", icon: "chatbubble-outline", label: "Encourage" },
];

export default function KingdomWinDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { reportContent } = useData();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState<KingdomWin | null>(null);
  const [scripture, setScripture] = useState<ScriptureReference | null>(null);
  const [reacting, setReacting] = useState<KingdomReactionType | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const e = await getKingdomWin(id);
        setEntry(e);
        if (e.scriptureReferenceId) getScriptureReference(e.scriptureReferenceId).then(setScripture).catch(() => {});
      } catch (err: any) {
        showAlert("Couldn't open this story", err.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function handleReact(reactionType: KingdomReactionType) {
    if (!entry) return;
    setReacting(reactionType);
    try {
      const hasReacted = entry.myReactions?.includes(reactionType);
      const result = hasReacted ? await unreactToKingdomWin(entry.id, reactionType) : await reactToKingdomWin(entry.id, reactionType);
      setEntry({ ...entry, reactionCounts: result.reactionCounts, myReactions: result.myReactions });
    } catch (e: any) {
      showAlert("Couldn't record that", e.message ?? "Please try again.");
    } finally {
      setReacting(null);
    }
  }

  async function handleShare() {
    if (!entry) return;
    try { await Share.share({ message: `${entry.title}\n\n${entry.body}` }); } catch { /* user cancelled */ }
  }

  function handleReport() {
    if (!entry) return;
    Alert.alert("Report this story?", "A moderator will review it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report", style: "destructive",
        onPress: async () => {
          const errMsg = await reportContent("kingdom_win", entry.id, "Reported from Kingdom Wins");
          showAlert(errMsg ? "Couldn't send report" : "Reported", errMsg || "A moderator will review this.");
        },
      },
    ]);
  }

  if (loading) return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  if (!entry) return <View style={[styles.screen, styles.centerFill]}><Text style={styles.emptyText}>This story isn't available.</Text></View>;

  const isOwn = entry.authorId === profile?.id;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerType}>{entry.entryType === "testimony" ? "Testimony" : "Kingdom Win"}</Text>
        {!isOwn ? (
          <TouchableOpacity onPress={handleReport} accessibilityLabel="Report" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="flag-outline" size={18} color={c.textMuted} />
          </TouchableOpacity>
        ) : <View style={{ width: 18 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.title}>{entry.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.categoryText}>{KINGDOM_CATEGORY_LABELS[entry.category]}</Text>
          <Text style={styles.dotSep}>·</Text>
          <Text style={styles.authorText}>{entry.isAnonymous ? "Anonymous" : entry.authorName ?? "A peer"}</Text>
        </View>

        {entry.mediaType === "video" && entry.mediaPath && <View style={{ marginTop: 14 }}><KingdomWinVideoPlayer mediaPath={entry.mediaPath} /></View>}
        {entry.mediaType === "photo" && entry.mediaPath && <View style={{ marginTop: 14 }}><SignedPhotoView bucket="kingdom-wins-media" path={entry.mediaPath} /></View>}

        <Text style={styles.body}>{entry.body}</Text>
        {!!entry.lessonLearned && (
          <View style={styles.lessonBox}>
            <Text style={styles.lessonLabel}>What I learned</Text>
            <Text style={styles.lessonText}>{entry.lessonLearned}</Text>
          </View>
        )}

        {scripture && (
          <TouchableOpacity style={styles.scriptureRow} onPress={() => Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(scripture.referenceDisplay)}`)}>
            <Ionicons name="book" size={14} color={c.accentGreen} />
            <Text style={styles.scriptureText}>{scripture.referenceDisplay}</Text>
            <Ionicons name="open-outline" size={13} color={c.accentGreen} />
          </TouchableOpacity>
        )}

        <View style={styles.reactionsRow}>
          {REACTIONS.map((r) => {
            const active = entry.myReactions?.includes(r.key);
            const count = entry.reactionCounts?.[r.key] ?? 0;
            return (
              <TouchableOpacity key={r.key} style={[styles.reactionBtn, active && styles.reactionBtnActive]} onPress={() => handleReact(r.key)} disabled={reacting === r.key}>
                {reacting === r.key ? <ActivityIndicator size="small" color={c.accentGreen} /> : (
                  <>
                    <Ionicons name={r.icon} size={16} color={active ? c.accentGreen : c.textMuted} />
                    <Text style={[styles.reactionText, active && styles.reactionTextActive]}>{r.label}{count > 0 ? ` (${count})` : ""}</Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={styles.reactionBtn} onPress={handleShare}>
            <Ionicons name="share-outline" size={16} color={c.textMuted} />
            <Text style={styles.reactionText}>Share</Text>
          </TouchableOpacity>
        </View>

        {entry.prayer2RequestId && (
          <View style={styles.connectionNote}>
            <Ionicons name="link" size={13} color={c.accentGreen} />
            <Text style={styles.connectionNoteText}>This story is connected to a real answered prayer.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
    headerType: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    title: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    categoryText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    dotSep: { color: c.textMuted },
    authorText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 21, marginTop: 16 },
    lessonBox: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginTop: 14, gap: 4 },
    lessonLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    lessonText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    scriptureRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 14 },
    scriptureText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    reactionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 22 },
    reactionBtn: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
    reactionBtnActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    reactionText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    reactionTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    connectionNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16 },
    connectionNoteText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  });
}
