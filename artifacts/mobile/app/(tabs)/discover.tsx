import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, TextInput, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { InviteCard } from "@/components/InviteCard";
import { CircleCard } from "@/components/CircleCard";

interface DiscoverCircleSummary {
  id: string;
  name: string;
  memberCount: number;
  maxMembers: number;
  leaderName: string;
  isFeatured: boolean;
}

interface LiveRoomSummary {
  id: string;
  name: string;
  hostName: string;
  currentParticipants: number;
  category: string | null;
  speakingMode: "open" | "structured";
}

// P2P Global Search — one result shape shared across every searchable
// domain (routes/search.ts). Deliberately minimal: only what's needed to
// show and navigate to a result, never private fields.
interface GlobalSearchResult { type: string; id: string; title: string; subtitle?: string | null; category?: string | null; route: string }
interface GlobalSearchGroup { type: string; label: string; results: GlobalSearchResult[] }

const SEARCH_RESULT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  person: "person-outline", curriculum: "school-outline", plan: "school-outline",
  prayer_topic: "hand-left-outline", prayer_path: "hand-left-outline",
  mission_field: "flag-outline", mission_story: "flag-outline",
  kingdom_story: "book-outline", kingdom_win: "sparkles-outline",
};

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    headerTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    headerSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: 20, gap: 12 },
    card: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 14,
    },
    iconWrap: {
      width: 42, height: 42, borderRadius: 12,
      backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center",
    },
    cardTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSub: { fontSize: 12, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    countPill: {
      backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
    },
    countText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },

    sectionHeading: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },

    searchBar: {
      flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12,
    },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", padding: 0 },
    searchEmpty: { padding: 40, alignItems: "center", gap: 14 },
    searchEmptyTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    searchEmptySub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
    searchEmptyBtn: { borderWidth: 1, borderColor: c.accentGreen, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
    searchEmptyBtnText: { color: c.accentGreen, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    searchResultRow: {
      flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.borderBeige, padding: 12, marginBottom: 10,
    },
    searchAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
    searchAvatarText: { fontSize: 15, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    searchResultUsername: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    searchResultMeta: { fontSize: 12, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    connectBtn: { backgroundColor: c.accentGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
    connectBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

    liveSectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    liveSectionHeading: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    liveSectionAction: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    liveEmptyCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14, marginBottom: 16 },
    liveEmptyText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    liveRoomCard: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: "rgba(220,38,38,0.25)", padding: 14, marginBottom: 10,
    },
    liveRoomTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    liveRoomName: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", flexShrink: 1 },
    liveRoomCategoryPill: { backgroundColor: c.borderBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
    liveRoomCategoryText: { fontSize: 10, fontWeight: "600", color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    liveRoomMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },
    joinRoomBtn: { backgroundColor: "#DC2626", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
    joinRoomBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    seeAllRoomsText: { fontSize: 12, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold", textAlign: "center", marginBottom: 16 },
    circleCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 10,
    },
    circleCardName: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    circleCardMeta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },
    circlesActionsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    circlePrimaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accentGreen, borderRadius: 12, paddingVertical: 11 },
    circlePrimaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    circleSecondaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 11 },
    circleSecondaryBtnText: { color: c.accentGreen, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}

export default function DiscoverTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { getDiscoverablePeers, getGroups, getPrayerWallPosts, forestStats, missions, userChurch } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { isTablet } = useLayout();

  const [loading, setLoading] = useState(true);
  const [peerCount, setPeerCount] = useState(0);
  const [groupCount, setGroupCount] = useState(0);
  const [wallCount, setWallCount] = useState(0);
  const [circles, setCircles] = useState<DiscoverCircleSummary[]>([]);
  const [liveRooms, setLiveRooms] = useState<LiveRoomSummary[]>([]);
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchGroups, setSearchGroups] = useState<GlobalSearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P2P Global Search — the SAME search field, extended from people-only
  // (/profiles/search) into a single bounded multi-domain call
  // (routes/search.ts). Debounce (300ms) and minimum query length (2)
  // unchanged from the original people-search implementation.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchGroups([]); setSearching(false); return; }
    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch(`${getApiUrl()}/search?q=${encodeURIComponent(q)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const body = await res.json();
        setSearchGroups(res.ok ? body.groups ?? [] : []);
      } catch {
        setSearchGroups([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  const totalSearchResults = searchGroups.reduce((sum, g) => sum + g.results.length, 0);

  const loadLiveRooms = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/calls/rooms`);
      setLiveRooms(await res.json());
    } catch {
      setLiveRooms([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [peers, groups, posts] = await Promise.all([
      getDiscoverablePeers(),
      getGroups(),
      getPrayerWallPosts("recent"),
      loadLiveRooms(),
    ]);
    setPeerCount(peers.length);
    setGroupCount(groups.length);
    setWallCount(posts.length);
    try {
      const res = await fetch(`${getApiUrl()}/circles?status=forming,active`);
      const data = (await res.json()) as DiscoverCircleSummary[];
      const sorted = Array.isArray(data) ? [...data].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured)) : [];
      setCircles(sorted.slice(0, 4));
    } catch {
      setCircles([]);
    }
    setLoading(false);
  }, [getDiscoverablePeers, getGroups, getPrayerWallPosts, loadLiveRooms]);

  useEffect(() => { load(); }, [load]);

  // Live-updated LIVE NOW section — new rooms opening/closing or their
  // participant counts changing over time.
  useEffect(() => {
    const channel = supabase
      .channel("discover_break_rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "p2p_break_rooms" }, () => { loadLiveRooms(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadLiveRooms]);

  async function joinRoom(roomId: string) {
    if (!profile?.id || joiningRoomId) return;
    setJoiningRoomId(roomId);
    router.push({ pathname: "/call/room" as any, params: { roomId } });
    setJoiningRoomId(null);
  }

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const cards = [
    { key: "peers", icon: "people-outline" as const, title: t("discover.discoverablePeers"), count: peerCount, sub: t("discover.discoverablePeersSub"), route: "/connect/discover" as const },
    { key: "groups", icon: "people-circle-outline" as const, title: t("discover.peerGroups"), count: groupCount, sub: t("discover.peerGroupsSub"), route: "/connect/groups" as const },
    { key: "smart-match", icon: "sparkles-outline" as const, title: t("discover.smartMatch"), count: null, sub: t("discover.smartMatchSub"), route: "/connect/smart-match" as const },
    { key: "wall", icon: "hand-left-outline" as const, title: t("discover.prayerWall"), count: wallCount, sub: t("discover.prayerWallSub"), route: "/(tabs)/prayer" as const },
    { key: "countries", icon: "earth-outline" as const, title: t("discover.countriesReached"), count: forestStats.countriesReached.length, sub: t("discover.countriesReachedSub"), route: "/living-tree" as const },
    { key: "missions", icon: "flag-outline" as const, title: t("discover.missions"), count: missions.length, sub: t("discover.missionsSub"), route: "/(tabs)/missions" as const },
    { key: "kingdom-stories", icon: "book-outline" as const, title: t("discover.kingdomStories"), count: null, sub: t("discover.kingdomStoriesSub"), route: "/kingdom-stories" as const },
  ];

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' } : { flex: 1 }}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>{t("discover.title")}</Text>
        <Text style={styles.headerSub}>{t("discover.subtitle")}</Text>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search P2P"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {searchQuery.trim().length >= 2 ? (
        searching ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : totalSearchResults === 0 ? (
          <View style={styles.searchEmpty}>
            <Text style={styles.searchEmptyTitle}>No results for "{searchQuery.trim()}"</Text>
            <Text style={styles.searchEmptySub}>Try another search, or check the spelling.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}>
            {searchGroups.map((group) => (
              <View key={group.type} style={{ marginBottom: 18 }}>
                <Text style={styles.sectionHeading}>{group.label}</Text>
                {group.results.map((r) => (
                  <TouchableOpacity key={`${r.type}-${r.id}`} style={styles.searchResultRow} activeOpacity={0.8} onPress={() => router.push(r.route as any)}>
                    <View style={styles.searchAvatar}>
                      <Ionicons name={SEARCH_RESULT_ICONS[r.type] ?? "search-outline"} size={18} color={colors.accentGreen} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchResultUsername} numberOfLines={1}>{r.title}</Text>
                      {(!!r.subtitle || !!r.category) && (
                        <Text style={styles.searchResultMeta} numberOfLines={1}>{[r.category, r.subtitle].filter(Boolean).join(" · ")}</Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        )
      ) : loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.liveSectionHeaderRow}>
            <Text style={styles.liveSectionHeading}>🔴 LIVE NOW</Text>
            <TouchableOpacity onPress={() => router.push("/call/create-room" as any)}>
              <Text style={styles.liveSectionAction}>+ Start a Room</Text>
            </TouchableOpacity>
          </View>
          {liveRooms.length === 0 ? (
            <View style={styles.liveEmptyCard}>
              <Text style={styles.liveEmptyText}>No rooms are live right now — be the first to start one.</Text>
            </View>
          ) : (
            <>
              {(showAllRooms ? liveRooms : liveRooms.slice(0, 3)).map((r) => (
                <View key={r.id} style={styles.liveRoomCard}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.liveRoomTitleRow}>
                      <Text style={styles.liveRoomName} numberOfLines={1}>{r.name}</Text>
                      {!!r.category && (
                        <View style={styles.liveRoomCategoryPill}>
                          <Text style={styles.liveRoomCategoryText} numberOfLines={1}>{r.category}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.liveRoomMeta}>
                      Hosted by {r.hostName} · {r.currentParticipants} listening{r.speakingMode === "structured" ? " · Structured" : ""}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.joinRoomBtn} onPress={() => joinRoom(r.id)} disabled={joiningRoomId === r.id}>
                    <Text style={styles.joinRoomBtnText}>Join</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {liveRooms.length > 3 && (
                <TouchableOpacity onPress={() => setShowAllRooms((v) => !v)}>
                  <Text style={styles.seeAllRoomsText}>{showAllRooms ? "Show fewer rooms" : `See all ${liveRooms.length} rooms`}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {cards.map((c) => (
            <TouchableOpacity key={c.key} style={styles.card} activeOpacity={0.85} onPress={() => router.push(c.route as any)}>
              <View style={styles.iconWrap}>
                <Ionicons name={c.icon} size={22} color={colors.accentGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardSub}>{c.sub}</Text>
              </View>
              {c.count !== null && (
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{c.count}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </TouchableOpacity>
          ))}

          <Text style={styles.sectionHeading}>Peer Circles</Text>
          <View style={styles.circlesActionsRow}>
            <TouchableOpacity style={styles.circlePrimaryBtn} onPress={() => router.push("/circles/create" as any)}>
              <Ionicons name="add-circle-outline" size={15} color="#fff" />
              <Text style={styles.circlePrimaryBtnText}>Start a Circle</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleSecondaryBtn} onPress={() => router.push("/circles/discover" as any)}>
              <Ionicons name="search" size={15} color={colors.accentGreen} />
              <Text style={styles.circleSecondaryBtnText}>Find a Circle</Text>
            </TouchableOpacity>
          </View>
          {circles.map((c) => (
            <CircleCard
              key={c.id}
              name={c.name}
              leaderName={c.leaderName}
              memberCount={c.memberCount}
              maxMembers={c.maxMembers}
              onPress={() => router.push(`/circles/${c.id}` as any)}
            />
          ))}

          <Text style={styles.sectionHeading}>⛪ Churches on P2P Global</Text>
          {profile?.isMinistryLeader && !userChurch && (
            <TouchableOpacity style={styles.circlePrimaryBtn} onPress={() => router.push("/church/register" as any)}>
              <Ionicons name="add-circle-outline" size={15} color="#fff" />
              <Text style={styles.circlePrimaryBtnText}>Register Your Church — Free</Text>
            </TouchableOpacity>
          )}
          {!userChurch && (
            <TouchableOpacity style={styles.circleCard} activeOpacity={0.85} onPress={() => router.push("/church/join" as any)}>
              <Text style={styles.circleCardName}>Join Your Church Grove</Text>
              <Text style={styles.circleCardMeta}>Has your church registered on P2P Global? Join with their invite code.</Text>
            </TouchableOpacity>
          )}
          {userChurch && (
            <TouchableOpacity style={styles.circleCard} activeOpacity={0.85} onPress={() => router.push("/church" as any)}>
              <Text style={styles.circleCardName}>My Church</Text>
              <Text style={styles.circleCardMeta}>{userChurch.name}</Text>
            </TouchableOpacity>
          )}

          <InviteCard label="🌾 Plant a grain — invite someone to P2P Global" buttonText="Share your invite link" />
        </ScrollView>
      )}
      </View>
    </View>
  );
}
