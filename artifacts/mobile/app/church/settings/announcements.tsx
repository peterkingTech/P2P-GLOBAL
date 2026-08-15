import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform, Modal, FlatList, Image, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useData, ChurchAnnouncement, ChurchAnnouncementType } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const TYPE_OPTIONS: { value: ChurchAnnouncementType; label: string }[] = [
  { value: "general", label: "General" }, { value: "bible_study", label: "Bible Study" },
  { value: "discipleship", label: "Discipleship" }, { value: "prayer", label: "Prayer" },
  { value: "learning_goal", label: "Learning Goal" }, { value: "study_plan", label: "Study Plan" },
  { value: "event", label: "Event" }, { value: "important", label: "Important" },
  { value: "reminder", label: "Reminder" }, { value: "other", label: "Other" },
];
const STATUS_COLORS: Record<string, string> = {
  draft: colors.textMuted, scheduled: "#D97706", published: colors.accentGreen, archived: colors.textMuted,
};
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 90;

export default function ChurchAnnouncementsManagementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { supabase } = useAuth();
  const { userChurch, isChurchLeader, getAnnouncements, createAnnouncement, updateAnnouncement } = useData();
  const [items, setItems] = useState<ChurchAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [announcementType, setAnnouncementType] = useState<ChurchAnnouncementType>("general");
  const [announcementTypeOther, setAnnouncementTypeOther] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [scheduleLater, setScheduleLater] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    setItems(await getAnnouncements(userChurch.id, true));
    setLoading(false);
  }, [userChurch, getAnnouncements]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function resetForm() {
    setTitle(""); setBody(""); setAnnouncementType("general"); setAnnouncementTypeOther("");
    setImageUrl(null); setVideoUrl(null); setScheduleLater(false); setPublishAt(""); setExpiresAt(""); setIsFeatured(false);
  }

  async function handlePickMedia() {
    if (!userChurch) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please allow photo library access to attach media."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.8, videoMaxDuration: MAX_VIDEO_SECONDS });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_MEDIA_BYTES) { Alert.alert("File too large", "Please choose a file under 25MB."); return; }
    if (asset.type === "video" && asset.duration && asset.duration / 1000 > MAX_VIDEO_SECONDS) {
      Alert.alert("Video too long", `Please choose a video under ${MAX_VIDEO_SECONDS} seconds.`);
      return;
    }
    setUploadingMedia(true);
    try {
      const ext = asset.uri.split(".").pop()?.toLowerCase() ?? (asset.type === "video" ? "mp4" : "jpg");
      const isVideo = asset.type === "video";
      const path = `${userChurch.id}/announcements/${Date.now()}/media.${ext}`;
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const contentType = isVideo ? `video/${ext === "mov" ? "quicktime" : ext}` : `image/${ext === "jpg" ? "jpeg" : ext}`;
      const { error } = await supabase.storage.from("church-media").upload(path, arrayBuffer, { contentType, upsert: true });
      if (error) { Alert.alert("Upload failed", error.message); return; }
      const { data } = supabase.storage.from("church-media").getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      if (isVideo) { setVideoUrl(url); setImageUrl(null); } else { setImageUrl(url); setVideoUrl(null); }
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handlePost() {
    if (!userChurch || !title.trim() || !body.trim()) return;
    if (scheduleLater && !publishAt.trim()) { Alert.alert("Choose a publish date"); return; }
    setPosting(true);
    const { error } = await createAnnouncement(userChurch.id, {
      title: title.trim(), body: body.trim(),
      announcementType, announcementTypeOther: announcementType === "other" ? announcementTypeOther.trim() : undefined,
      imageUrl: imageUrl ?? undefined, videoUrl: videoUrl ?? undefined,
      publishAt: scheduleLater ? new Date(publishAt).toISOString() : undefined,
      expiresAt: expiresAt.trim() ? new Date(expiresAt).toISOString() : undefined,
      isFeatured,
    });
    setPosting(false);
    if (error) { Alert.alert("Couldn't post announcement", error); return; }
    resetForm(); setComposerOpen(false); load();
  }

  async function handleArchive(item: ChurchAnnouncement) {
    if (!userChurch) return;
    const err = await updateAnnouncement(userChurch.id, item.id, { status: "archived" });
    if (err) Alert.alert("Couldn't archive", err);
    else load();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Announcements</Text>
      </View>

      {!isChurchLeader ? (
        <View style={styles.content}><Text style={styles.lockedText}>Only church leadership can manage announcements.</Text></View>
      ) : (
        <>
          <TouchableOpacity style={styles.createBtn} onPress={() => setComposerOpen(true)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.createBtnText}>New Announcement</Text>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(a) => a.id}
              contentContainerStyle={styles.content}
              ListEmptyComponent={<Text style={styles.emptyText}>No announcements yet.{"\n"}Your church's latest updates will appear here.</Text>}
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] }]}>{item.status.toUpperCase()}</Text>
                    {item.isFeatured && <Text style={styles.featuredBadge}>⭐ Featured</Text>}
                  </View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardBody} numberOfLines={2}>{item.body}</Text>
                  <Text style={styles.cardMeta}>
                    {item.status === "scheduled" && item.publishAt ? `Publishes ${new Date(item.publishAt).toLocaleString()}` : new Date(item.createdAt).toLocaleDateString()}
                  </Text>
                  {item.status !== "archived" && (
                    <TouchableOpacity onPress={() => handleArchive(item)}><Text style={styles.archiveText}>Archive</Text></TouchableOpacity>
                  )}
                </View>
              )}
            />
          )}
        </>
      )}

      <Modal visible={composerOpen} animationType="slide" transparent onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalSheet} contentContainerStyle={{ gap: 10 }}>
            <Text style={styles.modalTitle}>New Announcement</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.textMuted} />
            <TextInput style={[styles.input, styles.textArea]} value={body} onChangeText={setBody} placeholder="Message" placeholderTextColor={colors.textMuted} multiline />

            <TouchableOpacity style={styles.pickerBtn} onPress={() => setTypePickerOpen(true)}>
              <Text style={styles.pickerBtnText}>{TYPE_OPTIONS.find((t) => t.value === announcementType)?.label}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            {announcementType === "other" && (
              <TextInput style={styles.input} value={announcementTypeOther} onChangeText={setAnnouncementTypeOther} placeholder="Example: Weekly Discipleship Challenge" placeholderTextColor={colors.textMuted} />
            )}

            <TouchableOpacity style={styles.mediaBtn} onPress={handlePickMedia} disabled={uploadingMedia}>
              {uploadingMedia ? <ActivityIndicator color={colors.accentGreen} /> : (
                <>
                  <Ionicons name="attach" size={16} color={colors.accentGreen} />
                  <Text style={styles.mediaBtnText}>{imageUrl || videoUrl ? "Replace media" : "Add Image or Video"}</Text>
                </>
              )}
            </TouchableOpacity>
            {imageUrl && <Image source={{ uri: imageUrl }} style={styles.mediaPreview} />}
            {videoUrl && <View style={styles.videoAttachedRow}><Ionicons name="videocam" size={16} color={colors.textMid} /><Text style={styles.helperText}>Video attached</Text></View>}

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Feature this announcement</Text>
              <Switch value={isFeatured} onValueChange={setIsFeatured} trackColor={{ true: colors.accentGreen }} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Schedule for later</Text>
              <Switch value={scheduleLater} onValueChange={setScheduleLater} trackColor={{ true: colors.accentGreen }} />
            </View>
            {scheduleLater && (
              <TextInput style={styles.input} value={publishAt} onChangeText={setPublishAt} placeholder="Publish at (YYYY-MM-DD HH:MM)" placeholderTextColor={colors.textMuted} />
            )}
            <TextInput style={styles.input} value={expiresAt} onChangeText={setExpiresAt} placeholder="Expires (optional, YYYY-MM-DD)" placeholderTextColor={colors.textMuted} />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setComposerOpen(false); resetForm(); }}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalPostBtn} onPress={handlePost} disabled={posting || !title.trim() || !body.trim()}>
                {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalPostBtnText}>{scheduleLater ? "Schedule" : "Publish"}</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={typePickerOpen} animationType="slide" transparent onRequestClose={() => setTypePickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setTypePickerOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Announcement Type</Text>
            <FlatList data={TYPE_OPTIONS} keyExtractor={(o) => o.value} renderItem={({ item }) => (
              <TouchableOpacity style={styles.optionRow} onPress={() => { setAnnouncementType(item.value); setTypePickerOpen(false); }}>
                <Text style={styles.optionRowText}>{item.label}</Text>
              </TouchableOpacity>
            )} />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { padding: 16, paddingBottom: 60, gap: 10 },
  lockedText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.accentGreen, borderRadius: 10, height: 44, marginHorizontal: 16, marginTop: 16,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, lineHeight: 20, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  statusBadge: { fontSize: 10, fontWeight: "700", color: "#fff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, fontFamily: "Inter_700Bold" },
  featuredBadge: { fontSize: 11, color: "#D97706", fontWeight: "700", fontFamily: "Inter_700Bold" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cardBody: { fontSize: 13, color: colors.textMid, marginTop: 4, fontFamily: "Inter_400Regular" },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 8, fontFamily: "Inter_400Regular" },
  archiveText: { fontSize: 12, color: "#B91C1C", marginTop: 8, fontFamily: "Inter_500Medium" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "85%" },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, marginBottom: 6, fontFamily: "Inter_700Bold" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12,
  },
  pickerBtnText: { color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
  mediaBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  mediaBtnText: { color: colors.accentGreen, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  mediaPreview: { width: "100%", height: 140, borderRadius: 10, backgroundColor: colors.card },
  videoAttachedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  helperText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleLabel: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 10, marginBottom: 20 },
  modalCancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center" },
  modalCancelBtnText: { color: colors.textMid, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  modalPostBtn: { flex: 1, backgroundColor: colors.accentGreen, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center" },
  modalPostBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  optionRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  optionRowText: { color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
});