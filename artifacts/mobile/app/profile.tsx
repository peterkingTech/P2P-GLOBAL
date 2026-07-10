import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAuth, SpiritualGift } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { HelpButton } from "@/components/HelpButton";
import { Avatar } from "@/components/Avatar";
import SkillsMultiSelect from "@/components/SkillsMultiSelect";
import { skillLabel } from "@/constants/skillsTaxonomy";
import colors from "@/constants/colors";
import "@/lib/i18n";

const ALL_GIFTS: { key: SpiritualGift; label: string; icon: string }[] = [
  { key: "teaching", label: "Teaching", icon: "school" },
  { key: "evangelism", label: "Evangelism", icon: "megaphone" },
  { key: "mercy", label: "Mercy", icon: "heart" },
  { key: "leadership", label: "Leadership", icon: "trending-up" },
  { key: "intercession", label: "Intercession", icon: "radio" },
  { key: "hospitality", label: "Hospitality", icon: "home" },
  { key: "giving", label: "Giving", icon: "gift" },
  { key: "prophecy", label: "Prophecy", icon: "eye" },
];

const STRUGGLE_CATEGORIES = [
  { value: "addiction", label: "Addiction" },
  { value: "mental_health", label: "Mental Health" },
  { value: "relationships", label: "Relationships" },
  { value: "faith", label: "Faith Struggles" },
  { value: "other", label: "Other" },
];

const GIFT_LABELS: Record<string, string> = {
  teaching: "Teaching",
  evangelism: "Evangelism",
  mercy: "Mercy",
  leadership: "Leadership",
  intercession: "Intercession",
  hospitality: "Hospitality",
  giving: "Giving",
  prophecy: "Prophecy",
};

const ADMIN_ROLES = new Set(["church_leader", "regional_admin", "moderator", "super_admin"]);

const PROFILE_ROWS = [
  { key: "messages", labelKey: "profile.messages", icon: "chatbubbles-outline" as const, route: "/messages" as const },
  { key: "peers", labelKey: "profile.peers", icon: "people-outline" as const, route: "/connect" as const },
  { key: "groups", labelKey: "profile.peerGroups", icon: "people-circle-outline" as const, route: "/connect/groups" as const },
  { key: "notes", labelKey: "profile.notes", icon: "document-text-outline" as const, route: "/notes" as const },
  { key: "highlights", labelKey: "profile.highlights", icon: "bookmark-outline" as const, route: "/highlights" as const },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, signOut, updateProfile } = useAuth();
  const { submitHelpRequest } = useData();
  const { t } = useTranslation();

  const [reachOutOpen, setReachOutOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [giftsOpen, setGiftsOpen] = useState(false);
  const [selectedGifts, setSelectedGifts] = useState<SpiritualGift[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [savingGifts, setSavingGifts] = useState(false);

  function openGiftsModal() {
    setSelectedGifts((profile?.gifts as SpiritualGift[] | undefined) ?? []);
    setGiftsOpen(true);
  }

  function toggleGift(gift: SpiritualGift) {
    setSelectedGifts((prev) =>
      prev.includes(gift) ? prev.filter((g) => g !== gift) : [...prev, gift]
    );
  }

  async function handleSaveGifts() {
    setSavingGifts(true);
    const err = await updateProfile({ gifts: selectedGifts });
    setSavingGifts(false);
    if (!err) setGiftsOpen(false);
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  }

  function openReachOut() {
    setCategory(null);
    setNote("");
    setSubmitted(false);
    setReachOutOpen(true);
  }

  async function handleReachOutSubmit() {
    setSubmitting(true);
    const err = await submitHelpRequest({ tier: "struggling", category, note: note.trim() || null });
    setSubmitting(false);
    if (!err) setSubmitted(true);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("profile.title")}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar & Name */}
        <View style={styles.avatarSection}>
          <Avatar photoUrl={profile?.avatarUrl} name={profile?.displayName} size={80} borderWidth={3} style={styles.avatarCircle} />
          <View style={styles.nameRow}>
            <Text style={styles.displayName}>{profile?.displayName ?? "Anonymous"}</Text>
            <HelpButton variant="inline" />
          </View>
          <Text style={styles.email}>{profile?.email ?? ""}</Text>

          <View style={styles.locationRow}>
            {profile?.role && <Text style={styles.locationText}>{t("profile.calledIn")}: {profile.role.replace(/_/g, " ")}</Text>}
          </View>
          {(profile?.skills?.length ?? 0) > 0 && (
            <View style={styles.locationRow}>
              <Text style={styles.locationText}>
                Serving in: {profile!.skills.slice(0, 2).map(skillLabel).join(", ")}
                {profile!.skills.length > 2 ? ` +${profile!.skills.length - 2}` : ""}
              </Text>
            </View>
          )}
          {(profile?.city || profile?.country) && (
            <View style={styles.locationRow}>
              {profile?.city && <Text style={styles.locationText}>{profile.city}</Text>}
              {profile?.city && profile?.country && <Text style={styles.locationText}> · </Text>}
              {profile?.country && <Text style={styles.locationText}>{profile.country}</Text>}
            </View>
          )}
          {profile?.bio ? <Text style={styles.bioText}>{profile.bio}</Text> : null}
        </View>

        {/* Stats */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.growthLevel ?? 0}</Text>
            <Text style={styles.statLabel}>{t("profile.growthLevel")}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.gifts?.length ?? 0}</Text>
            <Text style={styles.statLabel}>{t("profile.gifts")}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.servantScore ?? 0}</Text>
            <Text style={styles.statLabel}>{t("profile.servantScore")}</Text>
          </View>
        </View>

        {/* Peers / Groups / Notes / Highlights */}
        <View style={styles.rowsList}>
          {PROFILE_ROWS.map((row) => (
            <TouchableOpacity
              key={row.key}
              style={styles.fullRow}
              activeOpacity={0.8}
              onPress={() => router.push(row.route)}
            >
              <Ionicons name={row.icon} size={20} color={colors.accentGreen} />
              <Text style={styles.fullRowLabel}>{t(row.labelKey)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Spiritual Gifts */}
        <Text style={styles.sectionTitle}>{t("profile.spiritualGifts")}</Text>
        <View style={styles.giftsRow}>
          {(profile?.gifts ?? []).map((gift) => (
            <View key={gift} style={styles.giftChip}>
              <Text style={styles.giftChipText}>{GIFT_LABELS[gift] ?? gift}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.addGiftChip} activeOpacity={0.8} onPress={openGiftsModal}>
            <Ionicons name="add" size={14} color={colors.accentGreen} />
            <Text style={styles.addGiftChipText}>{t("profile.add")}</Text>
          </TouchableOpacity>
        </View>

        {/* Skills */}
        <Text style={styles.sectionTitle}>Skills</Text>
        <View style={styles.giftsRow}>
          {(profile?.skills ?? []).map((skill) => (
            <View key={skill} style={styles.giftChip}>
              <Text style={styles.giftChipText}>{skillLabel(skill)}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.addGiftChip} activeOpacity={0.8} onPress={() => setSkillsOpen(true)}>
            <Ionicons name="add" size={14} color={colors.accentGreen} />
            <Text style={styles.addGiftChipText}>{t("profile.add")}</Text>
          </TouchableOpacity>
        </View>

        {/* Peer Guide dashboard (conditional) */}
        {profile?.role === "peer_guide" && (
          <TouchableOpacity style={styles.dashboardRow} activeOpacity={0.85} onPress={() => router.push("/admin/registrations")}>
            <Ionicons name="compass-outline" size={18} color={colors.primaryGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dashboardTitle}>{t("profile.peerGuideDashboard")}</Text>
              <Text style={styles.dashboardSub}>Manage the disciples and groups you lead</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
          </TouchableOpacity>
        )}

        {/* Admin dashboard (conditional) */}
        {profile?.role && ADMIN_ROLES.has(profile.role) && (
          <TouchableOpacity style={styles.dashboardRow} activeOpacity={0.85} onPress={() => router.push("/admin/team")}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primaryGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dashboardTitle}>{t("profile.adminDashboard")}</Text>
              <Text style={styles.dashboardSub}>Curriculum, registrations, help requests & team</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
          </TouchableOpacity>
        )}

        {/* Settings */}
        <Text style={styles.sectionTitle}>{t("profile.account")}</Text>
        <View style={styles.settingsList}>
          {[
            { icon: "create-outline", label: t("profile.editProfile") },
            { icon: "notifications-outline", label: t("profile.notifications") },
            { icon: "language-outline", label: t("profile.language") },
            { icon: "shield-outline", label: t("profile.privacy") },
          ].map((item) => (
            <TouchableOpacity key={item.label} style={styles.settingsRow} activeOpacity={0.8} onPress={() => router.push("/settings")}>
              <Ionicons name={item.icon as any} size={20} color={colors.textMid} />
              <Text style={styles.settingsLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t("profile.support")}</Text>
        <TouchableOpacity style={styles.reachOutBtn} onPress={openReachOut} activeOpacity={0.85}>
          <Ionicons name="hand-left-outline" size={18} color={colors.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reachOutTitle}>{t("profile.imStruggling")}</Text>
            <Text style={styles.reachOutSub}>Reach out privately for support and follow-up</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color="#B91C1C" />
          <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={reachOutOpen} animationType="slide" transparent onRequestClose={() => setReachOutOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Reach Out</Text>
              <TouchableOpacity onPress={() => setReachOutOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            {submitted ? (
              <View style={{ paddingVertical: 20, alignItems: "center", gap: 10 }}>
                <Ionicons name="checkmark-circle" size={36} color={colors.accentGreen} />
                <Text style={styles.sheetBody}>
                  Thank you for reaching out. A counselor will follow up with you personally.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetBody}>
                  This is a private, lower-key way to ask for support. Someone from our team will
                  follow up with you personally — this isn't urgent, so there's no rush.
                </Text>
                <Text style={styles.fieldLabel}>Category (optional)</Text>
                <View style={styles.categoryRow}>
                  {STRUGGLE_CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c.value}
                      style={[styles.categoryChip, category === c.value && styles.categoryChipActive]}
                      onPress={() => setCategory(category === c.value ? null : c.value)}
                    >
                      <Text style={[styles.categoryChipText, category === c.value && styles.categoryChipTextActive]}>
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>In your own words (optional)</Text>
                <TextInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Share as much or as little as you'd like..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={4}
                />
                <TouchableOpacity style={styles.submitReachOutBtn} onPress={handleReachOutSubmit} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.submitReachOutText}>Send</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={giftsOpen} animationType="slide" transparent onRequestClose={() => setGiftsOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t("profile.spiritualGifts")}</Text>
              <TouchableOpacity onPress={() => setGiftsOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetBody}>
                Select the gifts you believe God has given you.
              </Text>
              <View style={styles.giftGrid}>
                {ALL_GIFTS.map((gift) => {
                  const selected = selectedGifts.includes(gift.key);
                  return (
                    <TouchableOpacity
                      key={gift.key}
                      style={[styles.giftCard, selected && styles.giftCardSelected]}
                      onPress={() => toggleGift(gift.key)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={gift.icon as any}
                        size={22}
                        color={selected ? "#fff" : colors.accentGreen}
                      />
                      <Text style={[styles.giftCardLabel, selected && styles.giftCardLabelSelected]}>
                        {gift.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={styles.submitReachOutBtn} onPress={handleSaveGifts} disabled={savingGifts}>
                {savingGifts ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitReachOutText}>Save</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <SkillsMultiSelect
        visible={skillsOpen}
        initialSelected={profile?.skills ?? []}
        onClose={() => setSkillsOpen(false)}
        onSave={async (selected) => {
          await updateProfile({ skills: selected });
          setSkillsOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  reachOutBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 24,
  },
  reachOutTitle: { fontSize: 15, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  reachOutSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.lightCream,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "85%",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  closeBtn: { padding: 4 },
  sheetBody: { fontSize: 14, color: colors.textMid, lineHeight: 20, marginBottom: 12, fontFamily: "Inter_400Regular" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, marginBottom: 8, marginTop: 8, fontFamily: "Inter_600SemiBold" },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  categoryChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: "rgba(29,158,117,0.06)", borderWidth: 1, borderColor: colors.borderBeige,
  },
  categoryChipActive: { backgroundColor: "rgba(29,158,117,0.15)", borderColor: colors.accentGreen },
  categoryChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  categoryChipTextActive: { color: colors.accentGreen, fontWeight: "600" },
  giftGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  giftCard: {
    width: "47%", flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(29,158,117,0.06)", borderRadius: 12,
    borderWidth: 1, borderColor: colors.borderBeige, padding: 12,
  },
  giftCardSelected: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  giftCardLabel: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  giftCardLabelSelected: { color: "#fff" },
  noteInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 12, minHeight: 90, textAlignVertical: "top",
    color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  submitReachOutBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 12, height: 46,
    alignItems: "center", justifyContent: "center", marginTop: 16,
  },
  submitReachOutText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(29,158,117,0.15)",
    borderWidth: 3, borderColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  avatarInitial: { fontSize: 32, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  displayName: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  email: { fontSize: 13, color: colors.textMuted, marginTop: 4, fontFamily: "Inter_400Regular" },
  bioText: { fontSize: 13, color: colors.textMid, marginTop: 10, textAlign: "center", lineHeight: 18, fontFamily: "Inter_400Regular", paddingHorizontal: 12 },
  locationRow: { flexDirection: "row", marginTop: 6 },
  locationText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  statsCard: {
    flexDirection: "row",
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 28, justifyContent: "space-around", alignItems: "center",
  },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 16, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1, height: 32, backgroundColor: colors.borderBeige },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  rowsList: { gap: 10, marginBottom: 28 },
  fullRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige, padding: 14,
  },
  fullRowLabel: { flex: 1, fontSize: 15, color: colors.textDark, fontFamily: "Inter_500Medium" },
  giftsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28, alignItems: "center" },
  giftChip: {
    backgroundColor: "rgba(29,158,117,0.1)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
  },
  giftChipText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  addGiftChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.accentGreen,
  },
  addGiftChipText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  dashboardRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(29,158,117,0.25)", padding: 14, marginBottom: 16,
  },
  dashboardTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  dashboardSub: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  settingsList: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    overflow: "hidden", marginBottom: 24,
  },
  settingsRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  settingsLabel: { flex: 1, fontSize: 15, color: colors.textDark, fontFamily: "Inter_400Regular" },
  signOutBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(185,28,28,0.08)",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(185,28,28,0.2)",
    height: 48,
  },
  signOutText: { fontSize: 15, color: "#B91C1C", fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
