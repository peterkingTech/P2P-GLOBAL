import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, supabase } from "@/contexts/AuthContext";
import {
  useData,
  KingdomSchoolStatus,
  KINGDOM_SCHOOL_STATUS_LABELS,
  getModuleProgressCounts,
  getFoundationProgress,
  getKingdomSchoolStatus,
  Church,
  GroveData,
  ChurchAnnouncement,
} from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { STAGES, STAGE_IMAGES, getStageFromPoints } from "@/constants/stages";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import LivingTree from "@/components/LivingTree";
import { InviteCard } from "@/components/InviteCard";

function ProgressRing({ pct, size = 56, strokeWidth = 6, color, track }: { pct: number; size?: number; strokeWidth?: number; color: string; track: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        rotation={-90}
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  );
}

function KingdomSchoolCard({ status, pct, onPress }: { status: KingdomSchoolStatus; pct: number; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isFull = status === "foundation_complete" || status === "guiding_others";

  return (
    <TouchableOpacity style={styles.ksCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.ksHeaderRow}>
        <Text style={styles.ksHeading}>Kingdom School</Text>
        <View style={[styles.ksPill, isFull && styles.ksPillGold]}>
          <Text style={[styles.ksPillText, isFull && styles.ksPillTextGold]}>{KINGDOM_SCHOOL_STATUS_LABELS[status]}</Text>
        </View>
      </View>

      {status === "exploring" && (
        <View style={styles.ksBodyRow}>
          <Text style={styles.ksTitle}>Begin your Kingdom School journey</Text>
          <View style={styles.ksBtn}>
            <Text style={styles.ksBtnText}>Start</Text>
          </View>
        </View>
      )}

      {status === "enrolled" && (
        <View style={styles.ksBodyRow}>
          <Text style={styles.ksTitle}>You have begun — keep going</Text>
          <View style={styles.ksBtn}>
            <Text style={styles.ksBtnText}>Continue</Text>
          </View>
        </View>
      )}

      {status === "in_progress" && (
        <View style={styles.ksBodyRow}>
          <View style={styles.ksRingWrap}>
            <ProgressRing pct={pct} color={colors.accentGreen} track={colors.progressTrack} />
            <View style={styles.ksRingCenter}>
              <Text style={styles.ksRingPct}>{pct}%</Text>
            </View>
          </View>
          <Text style={styles.ksTitle}>Keep building your foundation</Text>
        </View>
      )}

      {isFull && (
        <View style={styles.ksBodyRow}>
          <View style={styles.ksTreeRing}>
            <Ionicons name="leaf" size={24} color="#fff" />
            {status === "guiding_others" && (
              <View style={styles.ksBranchBadge}>
                <Ionicons name="git-branch" size={10} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.ksTitle}>
            {status === "guiding_others" ? "Foundation Complete · Guiding Others" : "Foundation Complete"}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

interface FirstRecommendation {
  id: string;
  title: string;
  coverImageUrl: string | null;
  colorTheme: string;
}

// One-time "based on your goals" card — shown once after onboarding
// (Prompt 6), dismissed via AsyncStorage flag once the user starts the
// plan or taps "Not now", never shown again after that.
function FirstRecommendationCard({ rec, onStart, onSeeAll, onDismiss, colors }: {
  rec: FirstRecommendation; onStart: () => void; onSeeAll: () => void; onDismiss: () => void; colors: any;
}) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.recCard}>
      <TouchableOpacity style={styles.recDismissBtn} onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.recEyebrow}>Based on your goals, we recommend starting with:</Text>
      <View style={styles.recBodyRow}>
        <View style={[styles.recThumb, { backgroundColor: `${rec.colorTheme}1A` }]}>
          <Ionicons name="book-outline" size={20} color={rec.colorTheme} />
        </View>
        <Text style={styles.recTitle} numberOfLines={2}>{rec.title}</Text>
      </View>
      <View style={styles.recActionsRow}>
        <TouchableOpacity style={styles.recStartBtn} onPress={onStart}>
          <Text style={styles.recStartBtnText}>Start this Elective</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSeeAll}>
          <Text style={styles.recSeeAllText}>See all recommendations</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Surfaces an unresponded Elijah Protocol pastoral-care message (see
// GET /pastoral-care/pending/:userId). This app has no push-notification
// tap-routing infrastructure, so this Home-screen card — not a notification
// tap — is the real way a returning user reaches elijah-response.tsx.
function ElijahCheckInCard({ onPress, colors }: { onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.elijahIconWrap}>
        <Ionicons name="leaf-outline" size={20} color={colors.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.elijahTitle}>We noticed you have been quiet</Text>
        <Text style={styles.elijahSub}>Tap to see a gentle word — no pressure.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.amber} />
    </TouchableOpacity>
  );
}

// One-time card set by completion.tsx's Phase4Commission the moment a user
// becomes peer-guide eligible (see guideInvitationPending:<userId> in
// AsyncStorage) — shown once, then cleared, never re-shown after that.
function PeerGuideAlertCard({ count, onPress, colors }: { count: number; onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.elijahIconWrap}>
        <Text style={{ fontSize: 16 }}>📞</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.elijahTitle}>{count} disciple{count === 1 ? "" : "s"} could use a check-in</Text>
        <Text style={styles.elijahSub}>Tap to see who, and call them.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.amber} />
    </TouchableOpacity>
  );
}

function UnreadMessagesCard({ count, preview, onPress, colors }: { count: number; preview: string | null; onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.elijahIconWrap}>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accentGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.elijahTitle}>{count} unread {count === 1 ? "message" : "messages"}</Text>
        {preview && <Text style={styles.elijahSub} numberOfLines={1}>{preview}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.accentGreen} />
    </TouchableOpacity>
  );
}

function GuideInvitationCard({ onFind, onDismiss, colors }: { onFind: () => void; onDismiss: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.guideInviteCard}>
      <TouchableOpacity style={styles.recDismissBtn} onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
      <Text style={styles.guideInviteTitle}>Someone is waiting for a guide like you.</Text>
      <Text style={styles.guideInviteSub}>Ready to meet them?</Text>
      <TouchableOpacity style={styles.guideInviteBtn} onPress={onFind} activeOpacity={0.85}>
        <Text style={styles.guideInviteBtnText}>Find Someone to Guide</Text>
      </TouchableOpacity>
    </View>
  );
}

// Leader with a joined church — full grove summary.
function GroveHomeCard({ church, grove, memberCount, onPress, colors }: {
  church: Church; grove: GroveData | null; memberCount: number; onPress: () => void; colors: AppColors;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.churchCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.churchCardTopRow}>
        <Text style={{ fontSize: 20 }}>⛪</Text>
        <Text style={styles.churchCardName} numberOfLines={1}>{church.name}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
      <Text style={styles.churchCardLocation}>
        {[church.city, church.country].filter(Boolean).join(" · ")}{memberCount ? ` · ${memberCount} members` : ""}
      </Text>
      {grove && (
        <View style={styles.groveStatsRow}>
          <Text style={styles.groveStatText}>🟢 {grove.activeLearners} active</Text>
          <Text style={styles.groveStatText}>📖 {grove.lessonsThisWeek} this week</Text>
        </View>
      )}
      {grove && grove.inactiveMembers > 0 && (
        <Text style={styles.groveAttentionText}>⚠️ {grove.inactiveMembers} need attention</Text>
      )}
      <Text style={styles.churchCardCta}>Dashboard →</Text>
    </TouchableOpacity>
  );
}

// Ministry leader without a church yet — compact registration prompt.
function RegisterChurchPromptCard({ onPress, colors }: { onPress: () => void; colors: AppColors }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.churchCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.churchCardTopRow}>
        <Text style={{ fontSize: 20 }}>⛪</Text>
        <Text style={styles.churchCardName}>Register your church</Text>
      </View>
      <Text style={styles.churchCardLocation}>
        Bring your congregation onto P2P Global — completely free.
      </Text>
      <Text style={styles.churchCardCta}>Register →</Text>
    </TouchableOpacity>
  );
}

// Regular member who has joined a church — light, less prominent card.
function MemberChurchCard({ church, announcement, onPress, colors }: {
  church: Church; announcement: ChurchAnnouncement | null; onPress: () => void; colors: AppColors;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.churchCardCompact} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.churchCardTopRow}>
        <Text style={{ fontSize: 16 }}>⛪</Text>
        <Text style={styles.churchCardNameCompact} numberOfLines={1}>{church.name}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
      <Text style={styles.churchCardLocationCompact}>
        {[church.city, church.country].filter(Boolean).join(", ")}
      </Text>
      {announcement && (
        <Text style={styles.churchCardAnnouncement} numberOfLines={1}>📌 {announcement.title}</Text>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20 },

    greetingRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16,
    },
    greeting: { fontSize: 20, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    greetingSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    prayingBtn: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: "rgba(224,164,65,0.12)",
      borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
      alignItems: "center", justifyContent: "center",
    },

    treeCard: {
      borderRadius: 18,
      overflow: "hidden",
      height: 220,
      marginBottom: 12,
      position: "relative",
    },
    treePhoto: { width: "100%", height: "100%" },
    treePhotoFallback: {
      width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: c.card,
    },
    stageOverlay: {
      position: "absolute",
      bottom: 14,
      left: 14,
      backgroundColor: "rgba(0,0,0,0.48)",
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    stageOverlayText: {
      color: "#fff",
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
    },
    stageOfText: {
      color: "rgba(255,255,255,0.75)",
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      marginTop: 1,
    },
    arrowOverlay: {
      position: "absolute",
      top: 14,
      right: 14,
      backgroundColor: "rgba(0,0,0,0.35)",
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },

    progressWrap: { marginBottom: 20, gap: 5 },
    progressLabelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    progressToward: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
    progressPct: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    progressBarBg: { height: 5, backgroundColor: c.progressTrack, borderRadius: 3 },
    progressBarFill: { height: 5, backgroundColor: c.progressFill, borderRadius: 3 },
    progressHint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    forestLinkRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 20, marginTop: 12, backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 14, paddingVertical: 12,
    },
    forestLinkText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold", flex: 1 },

    churchCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16, gap: 6,
    },
    churchCardTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    churchCardName: { flex: 1, fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    churchCardLocation: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    groveStatsRow: { flexDirection: "row", gap: 14, marginTop: 2 },
    groveStatText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    groveAttentionText: { fontSize: 12, color: c.amber, fontFamily: "Inter_500Medium" },
    churchCardCta: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", alignSelf: "flex-end", marginTop: 2 },

    churchCardCompact: {
      backgroundColor: c.cardBeige, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 16, gap: 4,
    },
    churchCardNameCompact: { flex: 1, fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    churchCardLocationCompact: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    churchCardAnnouncement: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 2 },

    verseCard: {
      backgroundColor: c.cardBeige,
      borderRadius: 16, borderWidth: 1, borderColor: c.warmBeige,
      padding: 16, marginBottom: 16,
    },
    verseHeader: { flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 10 },
    verseLabel: { fontSize: 12, color: c.amber, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    verseText: {
      fontSize: 14, color: c.textDark, lineHeight: 22,
      fontStyle: "italic", fontFamily: "Inter_400Regular", marginBottom: 8,
    },
    verseRef: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },

    ksCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16,
    },
    ksHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    ksHeading: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    ksPill: { backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    ksPillGold: { backgroundColor: "rgba(224,164,65,0.18)" },
    ksPillText: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    ksPillTextGold: { color: c.upperRoomAmber },
    ksBodyRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    ksTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    ksBtn: { backgroundColor: c.accentGreen, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
    ksBtnText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    ksRingWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
    ksRingCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
    ksRingPct: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    ksTreeRing: {
      width: 48, height: 48, borderRadius: 24, backgroundColor: c.upperRoomAmber,
      alignItems: "center", justifyContent: "center", position: "relative",
    },
    ksBranchBadge: {
      position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9,
      backgroundColor: c.primaryGreen, borderWidth: 2, borderColor: c.card,
      alignItems: "center", justifyContent: "center",
    },

    recCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1.5, borderColor: c.accentGreen,
      padding: 16, marginBottom: 16, position: "relative",
    },
    recDismissBtn: { position: "absolute", top: 10, right: 10, padding: 4 },
    recEyebrow: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginBottom: 10, paddingRight: 20 },
    recBodyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    recThumb: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    recTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    recActionsRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 },
    recStartBtn: { backgroundColor: c.accentGreen, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
    recStartBtnText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    recSeeAllText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },

    elijahCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: "rgba(224,164,65,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
      padding: 14, marginBottom: 16,
    },
    elijahIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(224,164,65,0.15)", alignItems: "center", justifyContent: "center" },
    elijahTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    elijahSub: { fontSize: 12, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },

    guideInviteCard: {
      backgroundColor: "#0B1F19", borderRadius: 16, padding: 16, marginBottom: 16, position: "relative",
    },
    guideInviteTitle: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", paddingRight: 20 },
    guideInviteSub: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular", marginTop: 4 },
    guideInviteBtn: { backgroundColor: c.upperRoomAmber, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, alignSelf: "flex-start", marginTop: 14 },
    guideInviteBtnText: { fontSize: 13, fontWeight: "700", color: "#0B1F19", fontFamily: "Inter_700Bold" },

    evalCard: {
      backgroundColor: "rgba(224,164,65,0.1)",
      borderRadius: 14, borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
      padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12,
    },
    evalIconWrap: { position: "relative" },
    evalBadge: {
      position: "absolute", top: -6, right: -8,
      backgroundColor: "#C0392B", borderRadius: 9,
      minWidth: 18, height: 18, paddingHorizontal: 4,
      alignItems: "center", justifyContent: "center",
    },
    evalBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
    evalTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    evalSub: { fontSize: 12, color: c.textMid, marginTop: 2, fontFamily: "Inter_400Regular" },

    sectionTitle: {
      fontSize: 16, fontWeight: "700", color: c.textDark,
      fontFamily: "Inter_700Bold", marginBottom: 12,
    },
    moreList: { gap: 10 },
    moreTile: {
      backgroundColor: c.cardBeige, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
    },
    moreTileIcon: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: "rgba(29,158,117,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    moreTileLabel: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    moreTileSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  });
}

export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { dailyVerse, isLoading, refreshData, pendingEvaluations, modules, treeData, forestStats, totalUnreadCount, mostRecentUnread, userChurch, isChurchLeader, churchMemberCount, getGroveData, getAnnouncements } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const { modulesStarted, modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  const foundationPct = getFoundationProgress(modulesCompleted, totalModules);
  // No persistent "active mentee" relationship exists yet — see the same
  // note in learn.tsx; always false until a real peer-guide/mentee tracking
  // system is built.
  const kingdomSchoolStatus = getKingdomSchoolStatus(modulesStarted, modulesCompleted, totalModules, false);

  const [firstRecommendation, setFirstRecommendation] = useState<FirstRecommendation | null>(null);
  const [pendingElijahCheckIn, setPendingElijahCheckIn] = useState(false);
  const [pendingGuideAlertCount, setPendingGuideAlertCount] = useState(0);
  const [showGuideInvitation, setShowGuideInvitation] = useState(false);
  const [treePhotoFailed, setTreePhotoFailed] = useState(false);
  const [homeGroveData, setHomeGroveData] = useState<GroveData | null>(null);
  const [homeChurchAnnouncement, setHomeChurchAnnouncement] = useState<ChurchAnnouncement | null>(null);

  // Case 1 (leader with a joined church) needs grove stats for the summary card.
  useEffect(() => {
    if (!isChurchLeader || !userChurch) { setHomeGroveData(null); return; }
    let cancelled = false;
    getGroveData(userChurch.id).then((data) => { if (!cancelled) setHomeGroveData(data); });
    return () => { cancelled = true; };
  }, [isChurchLeader, userChurch, getGroveData]);

  // Case 3 (regular member in a church) needs the latest announcement.
  useEffect(() => {
    if (isChurchLeader || !userChurch) { setHomeChurchAnnouncement(null); return; }
    let cancelled = false;
    getAnnouncements(userChurch.id).then((list) => { if (!cancelled) setHomeChurchAnnouncement(list[0] ?? null); });
    return () => { cancelled = true; };
  }, [isChurchLeader, userChurch, getAnnouncements]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    AsyncStorage.getItem(`guideInvitationPending:${profile.id}`).then((v) => {
      if (!cancelled && v) setShowGuideInvitation(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [profile?.id]);

  const dismissGuideInvitation = useCallback(async () => {
    setShowGuideInvitation(false);
    if (profile?.id) await AsyncStorage.removeItem(`guideInvitationPending:${profile.id}`);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/pastoral-care/pending/${profile.id}`);
        const data = await res.json();
        if (!cancelled) setPendingElijahCheckIn(!!data);
      } catch {
        // Not critical — the card simply doesn't show this load.
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  // Pending "please check in" alerts for this user as a PEER GUIDE (not the
  // Elijah card above, which is for THEIR own inactivity) — same
  // no-push-tap-routing reasoning, surfaced as a Home card instead.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/pastoral-care/guide-alerts/${profile.id}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setPendingGuideAlertCount(data.length);
      } catch {
        // Not critical — the card simply doesn't show this load.
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      const dismissedKey = `firstRecommendationDismissed:${profile.id}`;
      const dismissed = await AsyncStorage.getItem(dismissedKey);
      if (dismissed || cancelled) return;
      try {
        const res = await fetch(`${getApiUrl()}/plans/recommended/${profile.id}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setFirstRecommendation({ id: data[0].id, title: data[0].title, coverImageUrl: data[0].coverImageUrl ?? null, colorTheme: data[0].colorTheme ?? "#1D9E75" });
        }
      } catch {
        // No recommendation available yet — not an error state, just nothing to show.
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  const dismissRecommendation = useCallback(async () => {
    setFirstRecommendation(null);
    if (profile?.id) await AsyncStorage.setItem(`firstRecommendationDismissed:${profile.id}`, "true");
  }, [profile?.id]);

  const startRecommendation = useCallback(async () => {
    if (!firstRecommendation) return;
    const planId = firstRecommendation.id;
    await dismissRecommendation();
    if (!profile?.id) { router.push(`/plan/${planId}` as any); return; }
    const { data } = await supabase.from("p2p_plan_enrollments").select("id").eq("user_id", profile.id).eq("plan_id", planId).maybeSingle();
    if (data) router.push(`/plan/${planId}` as any);
    else router.push(`/plans/pre-plan-questions?planId=${planId}` as any);
  }, [firstRecommendation, profile?.id, router, dismissRecommendation]);

  const firstName = profile?.displayName?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? t("home.goodMorning") : hour < 17 ? t("home.goodAfternoon") : t("home.goodEvening");
  const greeting = firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;

  const growthPoints = profile?.growthLevel ?? 0;
  const stageIndex = getStageFromPoints(growthPoints);
  const stage = STAGES[stageIndex];
  const nextStage = STAGES[stageIndex + 1] ?? null;
  const progressPct = nextStage
    ? Math.round(
        ((growthPoints - stage.unlockPoints) /
          (nextStage.unlockPoints - stage.unlockPoints)) *
          100
      )
    : 100;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 }, isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' as any, width: '100%' }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refreshData}
          tintColor={colors.accentGreen}
        />
      }
    >
      {/* Greeting */}
      <View style={styles.greetingRow}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.greetingSub}>{t("home.continueGrowth")}</Text>
        </View>
        <TouchableOpacity
          style={styles.prayingBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/prayer");
          }}
        >
          <Ionicons name="radio" size={18} color={colors.upperRoomAmber} />
        </TouchableOpacity>
      </View>

      {/* Living Tree — growth photo card (falls back to the SVG tree if the
          image fails to load, e.g. offline) */}
      <TouchableOpacity
        style={[styles.treeCard, isTablet && { height: 260 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/living-tree");
        }}
        activeOpacity={0.9}
      >
        {!treePhotoFailed ? (
          <Image
            source={STAGE_IMAGES[stageIndex]}
            style={styles.treePhoto}
            resizeMode="cover"
            onError={() => setTreePhotoFailed(true)}
          />
        ) : treeData ? (
          <View style={styles.treePhotoFallback}>
            <LivingTree treeData={treeData} userId={profile?.id} compact />
          </View>
        ) : (
          <ActivityIndicator color={colors.accentGreen} />
        )}
        <View style={styles.stageOverlay}>
          <Text style={styles.stageOverlayText}>{stage.emoji} {stage.name}</Text>
          <Text style={styles.stageOfText}>{t("home.stageOf", { stage: stageIndex + 1 })}</Text>
        </View>
        <View style={styles.arrowOverlay}>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </View>
      </TouchableOpacity>

      {/* Progress bar under photo */}
      <View style={styles.progressWrap}>
        <View style={styles.progressLabelRow}>
          {nextStage ? (
            <Text style={styles.progressToward}>
              {t("home.growingToward")} {nextStage.emoji} {nextStage.name}
            </Text>
          ) : (
            <Text style={styles.progressToward}>{t("home.forestReached")}</Text>
          )}
          <Text style={styles.progressPct}>{progressPct}%</Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progressPct}%` as any }]} />
        </View>
        {nextStage && (
          <Text style={styles.progressHint}>
            {t("home.morePoints", { points: nextStage.unlockPoints - growthPoints, name: nextStage.name })}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={styles.forestLinkRow}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/forest" as any); }}
        activeOpacity={0.85}
      >
        <Text style={styles.forestLinkText}>
          🌳 View My Forest — {1 + forestStats.totalDisciples} tree{1 + forestStats.totalDisciples === 1 ? "" : "s"}, {forestStats.countriesReached.length} nation{forestStats.countriesReached.length === 1 ? "" : "s"}
        </Text>
        <Ionicons name="chevron-forward" size={15} color={colors.primaryGreen} />
      </TouchableOpacity>

      {/* Church Discipleship Portal — completely free, no tiers. Only shown
          when relevant: leaders get a prominent dashboard/register prompt,
          regular members in a church get a light card, everyone else sees
          nothing (church tools aren't relevant to them). */}
      {isChurchLeader && userChurch && (
        <GroveHomeCard
          church={userChurch}
          grove={homeGroveData}
          memberCount={churchMemberCount}
          colors={colors}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/church/grove" as any); }}
        />
      )}
      {profile?.isMinistryLeader && !userChurch && (
        <RegisterChurchPromptCard
          colors={colors}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/church/register" as any); }}
        />
      )}
      {!profile?.isMinistryLeader && userChurch && (
        <MemberChurchCard
          church={userChurch}
          announcement={homeChurchAnnouncement}
          colors={colors}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/church" as any); }}
        />
      )}

      {/* Elijah Protocol check-in, if pastoral care has flagged one */}
      {pendingElijahCheckIn && (
        <ElijahCheckInCard
          colors={colors}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/elijah-response" as any);
          }}
        />
      )}

      {/* Unread messages preview */}
      {totalUnreadCount > 0 && (
        <UnreadMessagesCard
          count={totalUnreadCount}
          preview={mostRecentUnread?.lastMessage ?? null}
          colors={colors}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/messages" as any);
          }}
        />
      )}

      {/* Pending peer-guide check-in alerts (someone else needs a call) */}
      {pendingGuideAlertCount > 0 && (
        <PeerGuideAlertCard
          count={pendingGuideAlertCount}
          colors={colors}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/pastoral-alert" as any);
          }}
        />
      )}

      {/* One-time invitation to guide, shown right after becoming peer-guide eligible */}
      {showGuideInvitation && (
        <GuideInvitationCard
          colors={colors}
          onFind={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            dismissGuideInvitation();
            router.push("/connect/smart-match" as any);
          }}
          onDismiss={dismissGuideInvitation}
        />
      )}

      {/* Kingdom School status */}
      <KingdomSchoolCard
        status={kingdomSchoolStatus}
        pct={foundationPct}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/(tabs)/learn");
        }}
      />

      {/* First recommendation (one-time, based on onboarding goals) */}
      {firstRecommendation && (
        <FirstRecommendationCard
          rec={firstRecommendation}
          onStart={startRecommendation}
          onSeeAll={() => { dismissRecommendation(); router.push("/plans?tab=find" as any); }}
          onDismiss={dismissRecommendation}
          colors={colors}
        />
      )}

      {/* Daily Verse */}
      {dailyVerse && (
        <View style={styles.verseCard}>
          <View style={styles.verseHeader}>
            <Ionicons name="bookmark" size={14} color={colors.amber} />
            <Text style={styles.verseLabel}>{t("home.dailyWord")}</Text>
          </View>
          <Text style={styles.verseText}>"{dailyVerse.text}"</Text>
          <Text style={styles.verseRef}>— {dailyVerse.ref}</Text>
        </View>
      )}

      {/* Evaluations waiting */}
      {pendingEvaluations.length > 0 && (
        <TouchableOpacity
          style={styles.evalCard}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/evaluations");
          }}
          activeOpacity={0.85}
        >
          <View style={styles.evalIconWrap}>
            <Ionicons name="people-circle" size={22} color={colors.upperRoomAmber} />
            <View style={styles.evalBadge}>
              <Text style={styles.evalBadgeText}>{pendingEvaluations.length}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.evalTitle}>{t("home.evaluationsWaiting")}</Text>
            <Text style={styles.evalSub}>
              {t("home.disciplesNeedReview", { count: pendingEvaluations.length })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.amber} />
        </TouchableOpacity>
      )}

      {/* Invite — only once they have something real to invite people into */}
      {modulesCompleted >= 1 && (
        <InviteCard
          label="Know someone who would benefit from Kingdom School?"
          buttonText="Invite them →"
        />
      )}

      {/* More */}
      <Text style={styles.sectionTitle}>{t("home.more")}</Text>
      <View style={styles.moreList}>
        {[
          { icon: "leaf", label: t("home.livingTree"), sub: t("home.livingTreeSub"), route: "/living-tree" },
          { icon: "people", label: t("home.peerReview"), sub: t("home.peerReviewSub"), route: "/evaluations" },
          { icon: "stats-chart", label: t("home.myProgress"), sub: t("home.myProgressSub"), route: "/progress" },
          { icon: "people", label: t("home.peerConnect"), sub: t("home.peerConnectSub"), route: "/connect" },
          { icon: "people-circle", label: t("home.myDiscipleship"), sub: t("home.myDiscipleshipSub"), route: "/my-discipleship" },
          { icon: "person-circle", label: t("home.myProfile"), sub: t("home.myProfileSub"), route: "/profile" },
          ...(profile?.role && profile.role !== "student"
            ? [{ icon: "settings", label: t("home.admin"), sub: t("home.adminSub"), route: "/admin/curriculum" }]
            : []),
        ].map((item) => (
          <TouchableOpacity
            key={item.label}
            style={styles.moreTile}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.8}
          >
            <View style={styles.moreTileIcon}>
              <Ionicons name={item.icon as any} size={18} color={colors.accentGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.moreTileLabel}>{item.label}</Text>
              <Text style={styles.moreTileSub}>{item.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
