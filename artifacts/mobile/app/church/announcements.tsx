import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Image } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchAnnouncement, ChurchAnnouncementType } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const TYPE_LABELS: Record<ChurchAnnouncementType, string> = {
  general: "General", bible_study: "Bible Study", discipleship: "Discipleship", prayer: "Prayer",
  learning_goal: "Learning Goal", study_plan: "Study Plan", event: "Event", important: "Important",
  reminder: "Reminder", other: "Other",
};

export default function ChurchAnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchLeader, getAnnouncements, createAnnouncement, pinAnnouncement } = useData();
  const [announcements, setAnnouncements] = useState<ChurchAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    setAnnouncements(await getAnnouncements(userChurch.id));
    setLoading(false);
  }, [userChurch, getAnnouncements]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handlePost() {
    if (!userChurch || !title.trim() || !body.trim()) return;
    setPosting(true);
    const { error } = await createAnnouncement(userChurch.id, { title: title.trim(), body: body.trim() });
    setPosting(false);
    if (error) { Alert.alert("Couldn't post announcement", error); return; }
    setTitle(""); setBody(""); setComposerOpen(false);
    load();
  }

  function handleLongPress(a: ChurchAnnouncement) {
    if (!isChurchLeader || !userChurch) return;
    Alert.alert(a.title, undefined, [
      {
        text: a.isPinned ? "Unpin" : "Pin", onPress: async () => {
          await pinAnnouncement(userChurch.id, a.id, !a.isPinned);
          load();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.title}>Announcements</Text>
        {isChurchLeader ? (
          <TouchableOpacity onPress={() => router.push("/church/settings/announcements" as any)}>
            <Ionicons name="settings-outline" size={20} color={colors.textDark} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
      </View>

      {isChurchLeader && (
        <TouchableOpacity style={styles.createBtn} onPress={() => setComposerOpen(true)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.createBtnText}>New Announcement</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <FlatList
          data={announcements}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No announcements yet.{"\n"}When your church leadership posts something, it'll show up here.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.card, item.isPinned && styles.cardPinned, item.isFeatured && styles.cardFeatured]} onLongPress={() => handleLongPress(item)}>
              <View style={styles.cardTopRow}>
                {item.isFeatured && <Text style={styles.featuredBadge}>⭐ FEATURED</Text>}
                <Text style={styles.typeTag}>{TYPE_LABELS[item.announcementType] ?? "General"}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.isPinned ? "📌 " : ""}{item.title}</Text>
              <Text style={styles.cardBody}>{item.body}</Text>
              {item.imageUrl && <Image source={{ uri: item.imageUrl }} style={styles.cardImage} resizeMode="cover" />}
              {item.videoUrl && (
                <View style={styles.videoBadgeRow}>
                  <Ionicons name="videocam" size={14} color={colors.textMid} />
                  <Text style={styles.cardMeta}>Video attached</Text>
                </View>
              )}
              <Text style={styles.cardMeta}>
                Posted by {item.authorName ?? "Church leadership"} · {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New Announcement</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.textMuted} />
            <TextInput style={[styles.input, styles.textArea]} value={body} onChangeText={setBody} placeholder="Message" placeholderTextColor={colors.textMuted} multiline />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setComposerOpen(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalPostBtn} onPress={handlePost} disabled={posting || !title.trim() || !body.trim()}>
                {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalPostBtnText}>Post</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.accentGreen, borderRadius: 10, height: 42, marginHorizontal: 16,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14 },
  cardPinned: { borderColor: colors.accentGreen, borderWidth: 1.5 },
  cardFeatured: { borderColor: "#D97706", borderWidth: 1.5 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  featuredBadge: { fontSize: 10, fontWeight: "700", color: "#D97706", fontFamily: "Inter_700Bold" },
  typeTag: {
    fontSize: 10, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold",
    backgroundColor: colors.lightCream, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cardBody: { fontSize: 13, color: colors.textMid, marginTop: 4, lineHeight: 19, fontFamily: "Inter_400Regular" },
  cardImage: { width: "100%", height: 160, borderRadius: 10, marginTop: 8, backgroundColor: colors.lightCream },
  videoBadgeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 8, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, marginBottom: 6, fontFamily: "Inter_700Bold" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  modalCancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center" },
  modalCancelBtnText: { color: colors.textMid, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  modalPostBtn: { flex: 1, backgroundColor: colors.accentGreen, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center" },
  modalPostBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});