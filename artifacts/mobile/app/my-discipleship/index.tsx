import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

// My Discipleship — the personal discipleship command center. This screen is
// almost entirely a consolidation of infrastructure that already works
// elsewhere: My Peer Guide / My Disciples (moved from connect/index.tsx,
// which no longer shows them — see that file's own comment), Kingdom Impact
// (moved wholesale from progress.tsx, same RPCs, same numbers — My Progress
// no longer shows it), and link-outs to Requests/Confirmations/Completion
// Letters/Forest/Fruit, which stay as their own screens per the product
// decision to consolidate the dashboard, not re-implement every detail
// screen inside it.

interface MyPeerGuide {
  peerGuideId: string; peerGuideName: string; peerGuideUsername: string | null;
  peerGuidePhotoUrl: string | null; peerGuideCountry: string | null;
}
interface MyDisciple {
  discipleId: string; discipleName: string; discipleUsername: string | null;
  disciplePhotoUrl: string | null; discipleCountry: string | null;
  currentModuleNumber: number | null; totalModules: number | null;
  lastActiveAt: string | null; isWilting: boolean;
}

interface DashboardData {
  lessonsCompleted: number; modulesCompleted: number; plansCompleted: number;
  assignmentsSubmitted: number; reflectionsAnswered: number;
  currentStreakDays: number; totalDaysActive: number;
  peerSessionsHeld: number; peersEncouraged: number;
  prayersOfferedForOthers: number; scriptureReferencesOpened: number;
  activeMentees: number; menteesModuleComplete: number; menteesGraduated: number;
  generationalDepth: number; countriesReached: number;
  fruitsTotal: number; fruitsByCategory: Record<string, number>;
  mostRecentFruit: { fruitKey: string; name: string; icon: string; awardedAt: string } | null;
  nextFruitProgress: { fruitKey: string; name: string; icon: string; current: number; required: number } | null;
  kingdomPlansCompleted: number; mountainsTouched: string[];
}
interface TimelineData {
  firstLesson: { label: string; at: string | null };
  firstModule: { label: string; at: string | null };
  firstMentee: { label: string; at: string | null };
  firstFruit: { label: string; at: string | null };
}

const CATEGORY_LABEL: Record<string, string> = {
  personal_growth: "Personal Growth", community: "Community", multiplication: "Multiplication",
  faithfulness: "Faithfulness", kingdom_influence: "Kingdom Influence", special: "Special", legendary: "Legendary",
};
const SEVEN_MOUNTAINS = ["Marketplace", "Education", "Government", "Media", "Innovation", "Family", "Church"];

function timeAgo(iso: string | null): string {
  if (!iso) return "never active";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
}

function StatRow({ label, value, s }: { label: string; value: number | string; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.statRow}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function MountainsGrid({ touched, s, c }: { touched: string[]; s: ReturnType<typeof makeStyles>; c: AppColors }) {
  const touchedSet = new Set(touched);
  return (
    <View style={s.mountainsGrid}>
      {SEVEN_MOUNTAINS.map((name) => {
        const isTouched = touchedSet.has(name);
        return (
          <View key={name} style={[s.mountainTile, isTouched && s.mountainTileTouched]}>
            <Ionicons name="triangle" size={16} color={isTouched ? "#fff" : c.textMuted} />
            <Text style={[s.mountainTileText, isTouched && s.mountainTileTextTouched]}>{name}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SectionCard({ title, children, s }: { title: string; children: React.ReactNode; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MyPeerGuideCard({ guide, s, c }: { guide: MyPeerGuide; s: ReturnType<typeof makeStyles>; c: AppColors }) {
  const router = useRouter();
  const [messaging, setMessaging] = useState(false);

  async function handleMessage() {
    setMessaging(true);
    try {
      const { data: convId, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: guide.peerGuideId });
      if (error || !convId) { showAlert("Can't message this user", "Please try again."); return; }
      router.push(`/messages/${convId}` as any);
    } finally {
      setMessaging(false);
    }
  }

  return (
    <View style={s.relationshipCard}>
      <View style={s.relationshipHeaderRow}>
        {guide.peerGuidePhotoUrl ? (
          <Image source={{ uri: guide.peerGuidePhotoUrl }} style={s.relationshipAvatar} />
        ) : (
          <View style={[s.relationshipAvatar, s.relationshipAvatarFallback]}>
            <Text style={s.relationshipAvatarInitial}>{guide.peerGuideName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.relationshipLabel}>MY PEER GUIDE</Text>
          <Text style={s.relationshipName}>{guide.peerGuideName}</Text>
          <Text style={s.relationshipSub}>Your Peer Guide{guide.peerGuideCountry ? ` · ${guide.peerGuideCountry}` : ""}</Text>
        </View>
      </View>
      <View style={s.relationshipActionsRow}>
        <TouchableOpacity style={s.relationshipActionBtn} onPress={handleMessage} disabled={messaging}>
          {messaging ? <ActivityIndicator size="small" color={c.accentGreen} /> : (
            <><Ionicons name="chatbubble-outline" size={14} color={c.accentGreen} /><Text style={s.relationshipActionText}>Message</Text></>
          )}
        </TouchableOpacity>
        {guide.peerGuideUsername && (
          <TouchableOpacity style={s.relationshipActionBtn} onPress={() => router.push(`/profile/${guide.peerGuideUsername}` as any)}>
            <Ionicons name="person-outline" size={14} color={c.accentGreen} />
            <Text style={s.relationshipActionText}>View Profile</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function MyDisciplesSection({ disciples, s, c }: { disciples: MyDisciple[]; s: ReturnType<typeof makeStyles>; c: AppColors }) {
  const router = useRouter();
  const [messagingId, setMessagingId] = useState<string | null>(null);

  async function handleMessage(discipleId: string) {
    setMessagingId(discipleId);
    try {
      const { data: convId, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: discipleId });
      if (error || !convId) { showAlert("Can't message this user", "Please try again."); return; }
      router.push(`/messages/${convId}` as any);
    } finally {
      setMessagingId(null);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      {disciples.map((d) => (
        <TouchableOpacity
          key={d.discipleId}
          style={s.relationshipCard}
          activeOpacity={0.85}
          onPress={() => router.push(`/my-discipleship/disciple/${d.discipleId}` as any)}
        >
          <View style={s.relationshipHeaderRow}>
            {d.disciplePhotoUrl ? (
              <Image source={{ uri: d.disciplePhotoUrl }} style={s.relationshipAvatar} />
            ) : (
              <View style={[s.relationshipAvatar, s.relationshipAvatarFallback]}>
                <Text style={s.relationshipAvatarInitial}>{d.discipleName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.relationshipLabel}>MY DISCIPLE</Text>
              <Text style={s.relationshipName}>{d.discipleName}</Text>
              <Text style={s.relationshipSub}>Someone I'm guiding{d.discipleCountry ? ` · ${d.discipleCountry}` : ""}</Text>
            </View>
          </View>
          <View style={s.discipleProgressRow}>
            {d.currentModuleNumber && d.totalModules ? (
              <Text style={s.discipleProgressText}>Kingdom School · Module {d.currentModuleNumber} of {d.totalModules}</Text>
            ) : null}
            <Text style={[s.discipleProgressText, d.isWilting && s.discipleProgressWarn]}>
              Last active: {timeAgo(d.lastActiveAt)}{d.isWilting ? " · Check in" : ""}
            </Text>
          </View>
          <View style={s.relationshipActionsRow}>
            <TouchableOpacity style={s.relationshipActionBtn} onPress={() => handleMessage(d.discipleId)} disabled={messagingId === d.discipleId}>
              {messagingId === d.discipleId ? <ActivityIndicator size="small" color={c.accentGreen} /> : (
                <><Ionicons name="chatbubble-outline" size={14} color={c.accentGreen} /><Text style={s.relationshipActionText}>Message</Text></>
              )}
            </TouchableOpacity>
            {d.discipleUsername && (
              <TouchableOpacity style={s.relationshipActionBtn} onPress={() => router.push(`/profile/${d.discipleUsername}` as any)}>
                <Ionicons name="person-outline" size={14} color={c.accentGreen} />
                <Text style={s.relationshipActionText}>View Profile</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function MyDiscipleshipScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { pendingConfirmationCount } = useData();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [loading, setLoading] = useState(true);
  const [myPeerGuide, setMyPeerGuide] = useState<MyPeerGuide | null>(null);
  const [myDisciples, setMyDisciples] = useState<MyDisciple[]>([]);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  const [impactData, setImpactData] = useState<DashboardData | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const apiUrl = getApiUrl();
    await Promise.all([
      fetch(`${apiUrl}/discipleship/my-peer-guide/${profile.id}`)
        .then((r) => r.json())
        .then((data) => setMyPeerGuide(data?.peerGuideId ? data : null))
        .catch(() => setMyPeerGuide(null)),
      fetch(`${apiUrl}/discipleship/${profile.id}/disciples`)
        .then((r) => r.json())
        .then((data) => setMyDisciples(Array.isArray(data) ? data : []))
        .catch(() => setMyDisciples([])),
      fetch(`${apiUrl}/discipleship/pending-requests/${profile.id}`)
        .then((r) => r.json())
        .then((data) => setPendingRequestCount(Array.isArray(data) ? data.length : 0))
        .catch(() => setPendingRequestCount(0)),
    ]);
    setLoading(false);
  }, [profile?.id]);

  const loadImpact = useCallback(async () => {
    if (!profile?.id) return;
    setImpactLoading(true);
    const [{ data: dash }, { data: tl }] = await Promise.all([
      supabase.rpc("p2p_get_growth_dashboard", { p_user_id: profile.id }),
      supabase.rpc("p2p_get_activity_timeline", { p_user_id: profile.id }),
    ]);
    setImpactData(dash as DashboardData);
    setTimeline(tl as TimelineData);
    setImpactLoading(false);
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); loadImpact(); }, [load, loadImpact]));

  const timelineEvents = timeline
    ? [timeline.firstLesson, timeline.firstModule, timeline.firstMentee, timeline.firstFruit]
        .filter((e) => e.at)
        .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())
    : [];

  const isFirstTime = !loading && !myPeerGuide && myDisciples.length === 0 && pendingRequestCount === 0;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Discipleship</Text>
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.heroSub}>Walk with others. Help them grow. Multiply what God is doing through you.</Text>

        {loading ? (
          <View style={s.impactLoading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : isFirstTime ? (
          <View style={s.firstTimeCard}>
            <Text style={s.firstTimeTitle}>You were never meant to walk alone, and you don't have to grow alone.</Text>
            {[
              "Find a Peer Guide",
              "Grow through Kingdom School",
              "Walk with someone else",
              "Help them grow",
              "Multiply what you've received",
            ].map((step, i) => (
              <View key={step} style={s.firstTimeStepRow}>
                <View style={s.firstTimeStepDot}><Text style={s.firstTimeStepNum}>{i + 1}</Text></View>
                <Text style={s.firstTimeStepText}>{step}</Text>
              </View>
            ))}
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.push("/connect/smart-match" as any)}>
              <Text style={s.primaryBtnText}>Find a Peer Guide</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── My Peer Guide ── */}
            <Text style={s.sectionHeader}>My Peer Guide</Text>
            {myPeerGuide ? (
              <MyPeerGuideCard guide={myPeerGuide} s={s} c={colors} />
            ) : (
              <View style={s.emptyCard}>
                <Text style={s.emptyCardText}>You don't have a Peer Guide yet. You don't have to walk alone — choose someone to walk with you.</Text>
                <View style={s.emptyCardActions}>
                  <TouchableOpacity style={s.primaryBtnSmall} onPress={() => router.push("/connect/smart-match" as any)}>
                    <Text style={s.primaryBtnSmallText}>Find a Peer Guide</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.secondaryBtnSmall} onPress={() => router.push("/connect/by-username?type=peer_guide" as any)}>
                    <Text style={s.secondaryBtnSmallText}>Choose Someone I Know</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── My Disciples ── */}
            <Text style={s.sectionHeader}>My Disciples</Text>
            <Text style={s.sectionSub}>People you're walking with.</Text>
            {myDisciples.length > 0 ? (
              <MyDisciplesSection disciples={myDisciples} s={s} c={colors} />
            ) : (
              <View style={s.emptyCard}>
                <Text style={s.emptyCardText}>Your discipleship journey is beginning.</Text>
                <TouchableOpacity style={s.primaryBtnSmall} onPress={() => router.push("/connect/smart-match" as any)}>
                  <Text style={s.primaryBtnSmallText}>Walk With Someone</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── My Relationships: requests/confirmations/letters ── */}
            <Text style={s.sectionHeader}>My Relationships</Text>
            <TouchableOpacity style={s.linkRow} onPress={() => router.push("/peer-guide-requests" as any)}>
              <Ionicons name="people-circle-outline" size={20} color={colors.primaryGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.linkRowTitle}>Pending Requests</Text>
                <Text style={s.linkRowSub}>{pendingRequestCount > 0 ? "People who want you to guide them." : "No requests right now."}</Text>
              </View>
              {pendingRequestCount > 0 && (
                <View style={s.linkRowBadge}><Text style={s.linkRowBadgeText}>{pendingRequestCount}</Text></View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={s.linkRow} onPress={() => router.push("/confirmations" as any)}>
              <Ionicons name="checkmark-done-circle-outline" size={20} color={colors.primaryGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.linkRowTitle}>Pending Confirmations</Text>
                <Text style={s.linkRowSub}>Confirm encouragement, prayer &amp; peer sessions.</Text>
              </View>
              {pendingConfirmationCount > 0 && (
                <View style={s.linkRowBadge}><Text style={s.linkRowBadgeText}>{pendingConfirmationCount}</Text></View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            {profile?.isPeerGuideEligible && (
              <TouchableOpacity style={s.linkRow} onPress={() => router.push("/graduates" as any)}>
                <Ionicons name="mail-open-outline" size={20} color={colors.primaryGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={s.linkRowTitle}>Completion Letters</Text>
                  <Text style={s.linkRowSub}>Write a letter for disciples who finished the Core Curriculum.</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {/* ── My Learning ── */}
            <Text style={s.sectionHeader}>My Learning</Text>
            <TouchableOpacity style={s.linkRow} onPress={() => router.push("/(tabs)/learn" as any)}>
              <Ionicons name="school-outline" size={20} color={colors.primaryGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.linkRowTitle}>Kingdom School</Text>
                <Text style={s.linkRowSub}>Continue your current lesson.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={s.linkRow} onPress={() => router.push("/fruit" as any)}>
              <Ionicons name="flower-outline" size={20} color={colors.primaryGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.linkRowTitle}>Fruit</Text>
                <Text style={s.linkRowSub}>The observable outcomes of your growth and service.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={s.linkRow} onPress={() => router.push("/call/history" as any)}>
              <Ionicons name="time-outline" size={20} color={colors.primaryGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.linkRowTitle}>Sessions</Text>
                <Text style={s.linkRowSub}>Your call and Study Together session history.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            {/* ── My Generational Forest ── */}
            <Text style={s.sectionHeader}>My Generational Forest</Text>
            <TouchableOpacity style={s.linkRow} onPress={() => router.push("/forest" as any)}>
              <Ionicons name="git-branch-outline" size={20} color={colors.primaryGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.linkRowTitle}>View My Forest</Text>
                <Text style={s.linkRowSub}>Your discipleship lineage across the nations.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}

        {/* ── Kingdom Impact — moved here verbatim from My Progress ── */}
        <Text style={s.sectionHeader}>Kingdom Impact</Text>
        {impactLoading || !impactData ? (
          <View style={s.impactLoading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <>
            <Text style={s.intro}>
              Not a leaderboard — a reflection of the fruit and influence God is growing through your journey.
            </Text>

            <SectionCard title="📚 Learning Activity" s={s}>
              <StatRow label="Lessons Completed" value={impactData.lessonsCompleted} s={s} />
              <StatRow label="Modules Completed" value={impactData.modulesCompleted} s={s} />
              <StatRow label="Plans Completed" value={impactData.plansCompleted} s={s} />
              <StatRow label="Assignments Submitted" value={impactData.assignmentsSubmitted} s={s} />
              <StatRow label="Reflections Answered" value={impactData.reflectionsAnswered} s={s} />
              <StatRow label="Current Learning Streak" value={`${impactData.currentStreakDays} day${impactData.currentStreakDays === 1 ? "" : "s"}`} s={s} />
              <StatRow label="Total Days Active" value={impactData.totalDaysActive} s={s} />
            </SectionCard>

            <SectionCard title="🤝 Community Activity" s={s}>
              <StatRow label="Peer Sessions Held" value={impactData.peerSessionsHeld} s={s} />
              <StatRow label="Peers Encouraged" value={impactData.peersEncouraged} s={s} />
              <StatRow label="Prayers Offered for Others" value={impactData.prayersOfferedForOthers} s={s} />
              <StatRow label="Scripture References Opened" value={impactData.scriptureReferencesOpened} s={s} />
            </SectionCard>

            <SectionCard title="🌾 Multiplication Activity" s={s}>
              <StatRow label="Active Disciples" value={impactData.activeMentees} s={s} />
              <StatRow label="Disciples Who Completed a Module" value={impactData.menteesModuleComplete} s={s} />
              <StatRow label="Disciples Who Graduated" value={impactData.menteesGraduated} s={s} />
              <StatRow label="Generational Depth" value={impactData.generationalDepth} s={s} />
              <StatRow label="Countries Reached" value={impactData.countriesReached} s={s} />
            </SectionCard>

            <SectionCard title="🍇 Fruit" s={s}>
              <StatRow label="Total Fruits Earned" value={impactData.fruitsTotal} s={s} />
              {Object.entries(impactData.fruitsByCategory).map(([cat, count]) => (
                <StatRow key={cat} label={CATEGORY_LABEL[cat] ?? cat} value={count} s={s} />
              ))}
              {impactData.mostRecentFruit && (
                <TouchableOpacity style={s.fruitLink} onPress={() => router.push(`/fruit/${impactData.mostRecentFruit!.fruitKey}` as any)}>
                  <Text style={s.fruitLinkIcon}>{impactData.mostRecentFruit.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.fruitLinkLabel}>Most Recently Earned</Text>
                    <Text style={s.fruitLinkName}>{impactData.mostRecentFruit.name}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {impactData.nextFruitProgress && (
                <View style={s.nextFruitBlock}>
                  <Text style={s.fruitLinkLabel}>Next Fruit You're Close To</Text>
                  <View style={s.fruitLink}>
                    <Text style={s.fruitLinkIcon}>{impactData.nextFruitProgress.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.fruitLinkName}>{impactData.nextFruitProgress.name}</Text>
                      <View style={s.impactProgressTrack}>
                        <View style={[s.impactProgressFill, { width: `${Math.min(100, (impactData.nextFruitProgress.current / impactData.nextFruitProgress.required) * 100)}%` }]} />
                      </View>
                      <Text style={s.impactProgressLabel}>{impactData.nextFruitProgress.current} of {impactData.nextFruitProgress.required}</Text>
                    </View>
                  </View>
                </View>
              )}
            </SectionCard>

            <SectionCard title="🌍 Kingdom Influence" s={s}>
              <StatRow label="Kingdom Plans Completed" value={impactData.kingdomPlansCompleted} s={s} />
              <Text style={[s.statLabel, { marginTop: 10, marginBottom: 8 }]}>Mountains Touched</Text>
              <MountainsGrid touched={impactData.mountainsTouched} s={s} c={colors} />
            </SectionCard>

            {timelineEvents.length > 0 && (
              <SectionCard title="🕊 Discipleship Journey" s={s}>
                {timelineEvents.map((e, i) => (
                  <View key={i} style={s.timelineRow}>
                    <View style={s.timelineDotCol}>
                      <View style={s.timelineDot} />
                      {i < timelineEvents.length - 1 && <View style={s.timelineLine} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 16 }}>
                      <Text style={s.timelineLabel}>{e.label}</Text>
                      <Text style={s.timelineDate}>
                        {new Date(e.at!).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                      </Text>
                    </View>
                  </View>
                ))}
              </SectionCard>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { paddingHorizontal: 16, paddingTop: 16 },
    heroSub: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 20 },

    sectionHeader: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10, marginTop: 24 },
    sectionSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: -6, marginBottom: 10 },

    firstTimeCard: {
      backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige,
      padding: 20, gap: 14, marginTop: 8,
    },
    firstTimeTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 23 },
    firstTimeStepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    firstTimeStepDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    firstTimeStepNum: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    firstTimeStepText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", flex: 1 },

    primaryBtn: { backgroundColor: c.primaryGreen, borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 6 },
    primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

    emptyCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, gap: 12, marginBottom: 10,
    },
    emptyCardText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    emptyCardActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    primaryBtnSmall: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: "flex-start" },
    primaryBtnSmallText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtnSmall: { borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: "flex-start" },
    secondaryBtnSmallText: { color: c.accentGreen, fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

    relationshipCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 4,
    },
    relationshipHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
    relationshipAvatar: { width: 44, height: 44, borderRadius: 22 },
    relationshipAvatarFallback: { backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    relationshipAvatarInitial: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
    relationshipLabel: { fontSize: 10, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    relationshipName: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 2 },
    relationshipSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    discipleProgressRow: { gap: 2, marginBottom: 10 },
    discipleProgressText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    discipleProgressWarn: { color: c.amber, fontFamily: "Inter_600SemiBold" },
    relationshipActionsRow: { flexDirection: "row", gap: 10 },
    relationshipActionBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 10,
    },
    relationshipActionText: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },

    linkRow: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 10,
    },
    linkRowTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    linkRowSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    linkRowBadge: {
      backgroundColor: "#C0392B", borderRadius: 9, minWidth: 18, height: 18,
      alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
    },
    linkRowBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },

    impactLoading: { paddingVertical: 30, alignItems: "center" },
    intro: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 14, fontStyle: "italic" },

    sectionCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16,
    },
    sectionTitle: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 12 },

    statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7 },
    statLabel: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", flex: 1 },
    statValue: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },

    fruitLink: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderBeige },
    fruitLinkIcon: { fontSize: 26 },
    fruitLinkLabel: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
    fruitLinkName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    nextFruitBlock: { marginTop: 4 },
    impactProgressTrack: { height: 4, backgroundColor: c.progressTrack, borderRadius: 2, marginTop: 6, overflow: "hidden" },
    impactProgressFill: { height: "100%", backgroundColor: c.accentGreen, borderRadius: 2 },
    impactProgressLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    timelineRow: { flexDirection: "row", gap: 12 },
    timelineDotCol: { alignItems: "center", width: 16 },
    timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentGreen, marginTop: 4 },
    timelineLine: { flex: 1, width: 1, backgroundColor: c.borderBeige, marginTop: 2 },
    timelineLabel: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    timelineDate: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

    mountainsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    mountainTile: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: c.cardBeige, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige,
      paddingHorizontal: 10, paddingVertical: 7,
    },
    mountainTileTouched: { backgroundColor: c.amber, borderColor: c.amber },
    mountainTileText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    mountainTileTextTouched: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  });
}