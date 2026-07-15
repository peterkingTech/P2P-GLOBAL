import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Switch,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  useData,
  PrayerWallPost,
  PrayerWallComment,
  PrayerWallPostType,
  PrayerWallVisibility,
} from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

function flagEmoji(code?: string | null): string {
  if (!code || code.length !== 2) return "🌍";
  const upper = code.toUpperCase();
  const codePoints = [...upper].map((c) => 127397 + c.charCodeAt(0));
  try {
    return String.fromCodePoint(...codePoints);
  } catch {
    return "🌍";
  }
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function CommentsPanel({ postId }: { postId: string }) {
  const { getComments, addComment } = useData();
  const [comments, setComments] = useState<PrayerWallComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setLoading(true);
    setComments(await getComments(postId));
    setLoading(false);
  }, [postId, getComments]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!text.trim()) return;
    setPosting(true);
    const err = await addComment(postId, text.trim());
    setPosting(false);
    if (!err) {
      setText("");
      await load();
    }
  }

  return (
    <View style={styles.commentsPanel}>
      {loading ? (
        <ActivityIndicator color={colors.upperRoomAmber} size="small" />
      ) : comments.length === 0 ? (
        <Text style={styles.commentEmpty}>{t("prayer.noComments")}</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.commentRow}>
            <Text style={styles.commentName}>{c.userName || t("prayer.aBeliever")}</Text>
            <Text style={styles.commentBody}>{c.body}</Text>
          </View>
        ))
      )}
      <View style={styles.commentInputRow}>
        <TextInput
          style={styles.commentInput}
          value={text}
          onChangeText={setText}
          placeholder={t("prayer.writeComment")}
          placeholderTextColor={colors.upperRoomMuted}
        />
        <TouchableOpacity onPress={submit} disabled={posting || !text.trim()} style={styles.commentSendBtn}>
          {posting ? (
            <ActivityIndicator size="small" color={colors.upperRoomAmber} />
          ) : (
            <Ionicons name="send" size={16} color={colors.upperRoomAmber} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PostCard({
  item,
  onReact,
  onAnswer,
  onTestify,
  onReport,
}: {
  item: PrayerWallPost;
  onReact: (id: string, type: "praying" | "amen") => void;
  onAnswer: (id: string) => void;
  onTestify: (post: PrayerWallPost) => void;
  onReport: (post: PrayerWallPost) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const [showComments, setShowComments] = useState(false);
  const isTestimony = item.postType === "testimony";

  return (
    <View style={[styles.prayerCard, isTestimony && styles.testimonyCard]}>
      <View style={styles.prayerHeader}>
        <View style={styles.prayerAvatar}>
          <Text style={styles.prayerAvatarText}>{item.isAnonymous ? "?" : (item.userName || "?").charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.prayerName}>{item.userName || t("prayer.aBeliever")}</Text>
            <Text style={styles.flag}>{flagEmoji(item.nationCode)}</Text>
            {item.visibility === "peer_group" && (
              <Ionicons name="people" size={12} color={colors.upperRoomMuted} />
            )}
          </View>
          <Text style={styles.prayerMeta}>
            {timeAgo(item.createdAt)} · {isTestimony ? t("prayer.testimony") : item.status === "answered" ? t("prayer.answered") : t("prayer.request")}
          </Text>
        </View>
        {isTestimony && <Ionicons name="sparkles" size={18} color={colors.upperRoomAmber} />}
        <TouchableOpacity style={styles.reportBtn} onPress={() => onReport(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="flag-outline" size={15} color={colors.upperRoomMuted} />
        </TouchableOpacity>
      </View>

      {item.answeredFromPost && (
        <View style={styles.answeredFromBox}>
          <Ionicons name="return-down-forward" size={12} color={colors.upperRoomMuted} />
          <Text style={styles.answeredFromText} numberOfLines={2}>
            {t("prayer.inAnswerTo")} "{item.answeredFromPost.body}"
          </Text>
        </View>
      )}

      <Text style={styles.prayerText}>{item.body}</Text>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.reactBtn, item.myReactions.includes("praying") && styles.reactBtnActive]}
          onPress={() => {
            if (!item.myReactions.includes("praying")) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onReact(item.id, "praying");
            }
          }}
        >
          <Ionicons name="hand-left" size={14} color={item.myReactions.includes("praying") ? colors.upperRoomAmber : colors.upperRoomMuted} />
          <Text style={[styles.reactBtnText, item.myReactions.includes("praying") && styles.reactBtnTextActive]}>
            {t("prayer.prayingCount", { count: item.prayingCount })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.reactBtn, item.myReactions.includes("amen") && styles.reactBtnActive]}
          onPress={() => {
            if (!item.myReactions.includes("amen")) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onReact(item.id, "amen");
            }
          }}
        >
          <Ionicons name="checkmark-circle" size={14} color={item.myReactions.includes("amen") ? colors.upperRoomAmber : colors.upperRoomMuted} />
          <Text style={[styles.reactBtnText, item.myReactions.includes("amen") && styles.reactBtnTextActive]}>
            {t("prayer.amenCount", { count: item.amenCount })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reactBtn} onPress={() => setShowComments((s) => !s)}>
          <Ionicons name="chatbubble-outline" size={14} color={colors.upperRoomMuted} />
          <Text style={styles.reactBtnText}>{item.commentCount}</Text>
        </TouchableOpacity>
      </View>

      {!isTestimony && item.status === "open" && (
        <View style={styles.answerRow}>
          <TouchableOpacity style={styles.answerBtn} onPress={() => onAnswer(item.id)}>
            <Text style={styles.answerBtnText}>{t("prayer.markAnswered")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.testifyBtn} onPress={() => onTestify(item)}>
            <Text style={styles.testifyBtnText}>{t("prayer.shareTestimony")}</Text>
          </TouchableOpacity>
        </View>
      )}
      {!isTestimony && item.status === "answered" && (
        <TouchableOpacity style={styles.testifyBtnFull} onPress={() => onTestify(item)}>
          <Ionicons name="sparkles-outline" size={14} color={colors.upperRoomAmber} />
          <Text style={styles.testifyBtnText}>{t("prayer.shareHowGodAnswered")}</Text>
        </TouchableOpacity>
      )}

      {showComments && <CommentsPanel postId={item.id} />}
    </View>
  );
}

export default function PrayerTab() {
  const insets = useSafeAreaInsets();
  const { getPrayerWallPosts, createPrayerWallPost, reactToPost, markPostAnswered, reportContent } = useData();
  const { t } = useTranslation();

  const [section, setSection] = useState<"wall" | "private">("wall");
  const [tab, setTab] = useState<"recent" | "engaged">("recent");
  const [posts, setPosts] = useState<PrayerWallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [postType, setPostType] = useState<PrayerWallPostType>("request");
  const [body, setBody] = useState("");
  const [nationCode, setNationCode] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [visibility, setVisibility] = useState<PrayerWallVisibility>("global");
  const [answeredFromPostId, setAnsweredFromPostId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { isTablet } = useLayout();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const load = useCallback(async (which: "recent" | "engaged") => {
    setLoading(true);
    setPosts(await getPrayerWallPosts(which));
    setLoading(false);
  }, [getPrayerWallPosts]);

  useEffect(() => { load(tab); }, [tab, load]);

  const visiblePosts = posts.filter((p) =>
    section === "private" ? p.visibility === "peer_group" : p.visibility === "global"
  );

  async function handleReact(id: string, type: "praying" | "amen") {
    setPosts((prev) => prev.map((p) => p.id === id
      ? {
          ...p,
          myReactions: [...p.myReactions, type],
          prayingCount: type === "praying" ? p.prayingCount + 1 : p.prayingCount,
          amenCount: type === "amen" ? p.amenCount + 1 : p.amenCount,
        }
      : p
    ));
    await reactToPost(id, type);
  }

  async function handleAnswer(id: string) {
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: "answered" } : p));
    await markPostAnswered(id);
  }

  function handleReport(post: PrayerWallPost) {
    Alert.alert(
      t("prayer.reportTitle"),
      t("prayer.reportMessage"),
      [
        { text: t("prayer.cancel"), style: "cancel" },
        {
          text: t("prayer.report"),
          style: "destructive",
          onPress: async () => {
            const err = await reportContent("prayer_post", post.id, "Reported from prayer wall");
            Alert.alert(err ? t("prayer.couldntSendReport") : t("prayer.reported"), err || t("prayer.reportedMessage"));
          },
        },
      ]
    );
  }

  function handleTestify(post: PrayerWallPost) {
    setPostType("testimony");
    setAnsweredFromPostId(post.id);
    setBody("");
    setNationCode(post.nationCode || "");
    setShowForm(true);
  }

  function openNewPost() {
    setPostType("request");
    setAnsweredFromPostId(null);
    setBody("");
    setNationCode("");
    setVisibility(section === "private" ? "peer_group" : "global");
    setShowForm((s) => !s);
  }

  async function handleSubmit() {
    if (!body.trim()) return;
    setSubmitting(true);
    const err = await createPrayerWallPost({
      postType,
      nationCode: nationCode.trim() ? nationCode.trim().slice(0, 2).toUpperCase() : null,
      body: body.trim(),
      isAnonymous,
      visibility,
      answeredFromPostId,
    });
    setSubmitting(false);
    if (!err) {
      setBody("");
      setNationCode("");
      setAnsweredFromPostId(null);
      setShowForm(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load(tab);
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.container, { paddingTop: topPad }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' } : { flex: 1 }}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <View>
          <Text style={styles.headerTitle}>{t("prayer.title")}</Text>
          <Text style={styles.headerSub}>{t("prayer.subtitle")}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openNewPost}>
          <Ionicons name={showForm ? "close" : "add"} size={22} color={colors.upperRoomCream} />
        </TouchableOpacity>
      </View>

      <View style={styles.segmentRow}>
        <TouchableOpacity style={[styles.segmentBtn, section === "wall" && styles.segmentBtnActive]} onPress={() => setSection("wall")}>
          <Text style={[styles.segmentText, section === "wall" && styles.segmentTextActive]}>{t("prayer.wall")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentBtn, section === "private" && styles.segmentBtnActive]} onPress={() => setSection("private")}>
          <Text style={[styles.segmentText, section === "private" && styles.segmentTextActive]}>{t("prayer.private")}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === "recent" && styles.tabBtnActive]} onPress={() => setTab("recent")}>
          <Text style={[styles.tabBtnText, tab === "recent" && styles.tabBtnTextActive]}>{t("prayer.recent")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === "engaged" && styles.tabBtnActive]} onPress={() => setTab("engaged")}>
          <Text style={[styles.tabBtnText, tab === "engaged" && styles.tabBtnTextActive]}>{t("prayer.mostEngaged")}</Text>
        </TouchableOpacity>
      </View>

      {showForm && (
        <View style={styles.form}>
          <View style={styles.typeToggleRow}>
            <TouchableOpacity
              style={[styles.typeToggle, postType === "request" && styles.typeToggleActive]}
              onPress={() => setPostType("request")}
              disabled={!!answeredFromPostId}
            >
              <Text style={[styles.typeToggleText, postType === "request" && styles.typeToggleTextActive]}>{t("prayer.prayerRequest")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeToggle, postType === "testimony" && styles.typeToggleActive]}
              onPress={() => setPostType("testimony")}
            >
              <Text style={[styles.typeToggleText, postType === "testimony" && styles.typeToggleTextActive]}>{t("prayer.testimony")}</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.formInput}
            value={body}
            onChangeText={setBody}
            placeholder={postType === "testimony" ? t("prayer.shareAnsweredPlaceholder") : t("prayer.sharePrayerPlaceholder")}
            placeholderTextColor={colors.upperRoomMuted}
            multiline
            numberOfLines={3}
          />
          <TextInput
            style={[styles.formInput, { marginTop: 8 }]}
            value={nationCode}
            onChangeText={setNationCode}
            placeholder={t("prayer.nationCodePlaceholder")}
            placeholderTextColor={colors.upperRoomMuted}
            autoCapitalize="characters"
            maxLength={2}
          />

          <View style={styles.visibilityRow}>
            <TouchableOpacity
              style={[styles.visBtn, visibility === "global" && styles.visBtnActive]}
              onPress={() => setVisibility("global")}
            >
              <Ionicons name="earth" size={14} color={visibility === "global" ? colors.upperRoomAmber : colors.upperRoomMuted} />
              <Text style={[styles.visBtnText, visibility === "global" && styles.visBtnTextActive]}>{t("prayer.global")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.visBtn, visibility === "peer_group" && styles.visBtnActive]}
              onPress={() => setVisibility("peer_group")}
            >
              <Ionicons name="people" size={14} color={visibility === "peer_group" ? colors.upperRoomAmber : colors.upperRoomMuted} />
              <Text style={[styles.visBtnText, visibility === "peer_group" && styles.visBtnTextActive]}>{t("prayer.myPeerGroup")}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.anonRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="eye-off-outline" size={16} color={colors.upperRoomAmber} />
              <Text style={styles.anonLabel}>{t("prayer.postAnonymously")}</Text>
            </View>
            <Switch
              value={isAnonymous}
              onValueChange={setIsAnonymous}
              trackColor={{ false: colors.upperRoomBorder, true: colors.upperRoomAmber }}
              thumbColor={colors.upperRoomCream}
            />
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} activeOpacity={0.85} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#100B06" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>
                {postType === "testimony" ? t("prayer.shareTestimony") : t("prayer.submitRequest")}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.upperRoomAmber} />
        </View>
      ) : (
        <FlatList
          data={visiblePosts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PostCard item={item} onReact={handleReact} onAnswer={handleAnswer} onTestify={handleTestify} onReport={handleReport} />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="radio-outline" size={40} color={colors.upperRoomBorder} />
              <Text style={styles.emptyText}>
                {section === "private" ? t("prayer.noPrivatePosts") : t("prayer.noPostsYet")}
              </Text>
            </View>
          }
        />
      )}
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.upperRoomBg },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.upperRoomBorder,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: c.upperRoomCream, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, color: c.upperRoomMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  addBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "rgba(224,164,65,0.15)",
    borderWidth: 1, borderColor: c.upperRoomBorder,
    alignItems: "center", justifyContent: "center",
  },
  segmentRow: {
    flexDirection: "row", marginHorizontal: 16, marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12,
    borderWidth: 1, borderColor: c.upperRoomBorder, padding: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentBtnActive: { backgroundColor: "rgba(224,164,65,0.18)" },
  segmentText: { fontSize: 13, fontWeight: "600", color: c.upperRoomMuted, fontFamily: "Inter_600SemiBold" },
  segmentTextActive: { color: c.upperRoomAmber },
  tabRow: {
    flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.upperRoomBorder,
  },
  tabBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: c.upperRoomBorder,
  },
  tabBtnActive: { backgroundColor: "rgba(224,164,65,0.15)", borderColor: c.upperRoomAmber },
  tabBtnText: { fontSize: 13, fontWeight: "600", color: c.upperRoomMuted, fontFamily: "Inter_600SemiBold" },
  tabBtnTextActive: { color: c.upperRoomAmber },
  form: {
    margin: 16,
    padding: 14,
    backgroundColor: c.upperRoomCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.upperRoomBorder,
  },
  typeToggleRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  typeToggle: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: c.upperRoomBorder,
  },
  typeToggleActive: { backgroundColor: "rgba(224,164,65,0.15)", borderColor: c.upperRoomAmber },
  typeToggleText: { fontSize: 12, fontWeight: "600", color: c.upperRoomMuted, fontFamily: "Inter_600SemiBold" },
  typeToggleTextActive: { color: c.upperRoomAmber },
  formInput: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: c.upperRoomBorder,
    borderRadius: 10, padding: 12,
    color: c.upperRoomCream, fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  visibilityRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  visBtn: {
    flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    paddingVertical: 8, borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: c.upperRoomBorder,
  },
  visBtnActive: { backgroundColor: "rgba(224,164,65,0.15)", borderColor: c.upperRoomAmber },
  visBtnText: { fontSize: 12, color: c.upperRoomMuted, fontFamily: "Inter_500Medium" },
  visBtnTextActive: { color: c.upperRoomAmber, fontWeight: "600" },
  anonRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 12, padding: 10, borderRadius: 10,
    backgroundColor: "rgba(224,164,65,0.08)", borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
  },
  anonLabel: { fontSize: 12, color: c.upperRoomCream, fontFamily: "Inter_500Medium", flex: 1 },
  submitBtn: {
    backgroundColor: c.upperRoomAmber,
    borderRadius: 10, height: 44,
    alignItems: "center", justifyContent: "center", marginTop: 12,
  },
  submitBtnText: { color: "#100B06", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 14, paddingTop: 10 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { color: c.upperRoomMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
  prayerCard: {
    backgroundColor: c.upperRoomCard,
    borderRadius: 14, borderWidth: 1, borderColor: c.upperRoomBorder,
    padding: 14, marginBottom: 10,
  },
  testimonyCard: { borderColor: "rgba(224,164,65,0.4)" },
  prayerHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  reportBtn: { padding: 2 },
  prayerAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(224,164,65,0.15)",
    borderWidth: 1, borderColor: c.upperRoomBorder,
    alignItems: "center", justifyContent: "center",
  },
  prayerAvatarText: { fontSize: 14, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold" },
  prayerName: { fontSize: 13, fontWeight: "600", color: c.upperRoomCream, fontFamily: "Inter_600SemiBold" },
  flag: { fontSize: 13 },
  prayerMeta: { fontSize: 11, color: c.upperRoomMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  answeredFromBox: {
    flexDirection: "row", gap: 6, alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 8, marginBottom: 8,
  },
  answeredFromText: { fontSize: 11, color: c.upperRoomMuted, fontFamily: "Inter_400Regular", flex: 1, fontStyle: "italic" },
  prayerText: { fontSize: 14, color: c.upperRoomCream, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: 12, opacity: 0.9 },
  actionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  reactBtn: {
    flexDirection: "row", gap: 6, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: c.upperRoomBorder,
  },
  reactBtnActive: { backgroundColor: "rgba(224,164,65,0.12)", borderColor: "rgba(224,164,65,0.3)" },
  reactBtnText: { fontSize: 12, color: c.upperRoomMuted, fontFamily: "Inter_500Medium" },
  reactBtnTextActive: { color: c.upperRoomAmber },
  answerRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  answerBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: c.upperRoomBorder,
  },
  answerBtnText: { fontSize: 12, fontWeight: "600", color: c.upperRoomCream, fontFamily: "Inter_600SemiBold" },
  testifyBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
    backgroundColor: "rgba(224,164,65,0.12)", borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
  },
  testifyBtnFull: {
    flexDirection: "row", gap: 6, justifyContent: "center",
    marginTop: 10, paddingVertical: 8, borderRadius: 8, alignItems: "center",
    backgroundColor: "rgba(224,164,65,0.12)", borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
  },
  testifyBtnText: { fontSize: 12, fontWeight: "600", color: c.upperRoomAmber, fontFamily: "Inter_600SemiBold" },
  commentsPanel: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.upperRoomBorder, paddingTop: 10, gap: 8 },
  commentEmpty: { fontSize: 12, color: c.upperRoomMuted, fontFamily: "Inter_400Regular" },
  commentRow: { gap: 2 },
  commentName: { fontSize: 11, fontWeight: "600", color: c.upperRoomAmber, fontFamily: "Inter_600SemiBold" },
  commentBody: { fontSize: 13, color: c.upperRoomCream, fontFamily: "Inter_400Regular" },
  commentInputRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  commentInput: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: c.upperRoomBorder,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: c.upperRoomCream, fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  commentSendBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  });
}