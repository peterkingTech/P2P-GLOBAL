import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
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

    liveSectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    liveSectionHeading: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    liveSectionAction: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    liveEmptyCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14, marginBottom: 16 },
    liveEmptyText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    liveRoomCard: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: "rgba(220,38,38,0.25)", padding: 14, marginBottom: 10,
    },
    liveRoomName: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
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
  const { getDiscoverablePeers, getGroups, getPrayerWallPosts, forestStats, missions } = useData();
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
  ];

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' } : { flex: 1 }}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>{t("discover.title")}</Text>
        <Text style={styles.headerSub}>{t("discover.subtitle")}</Text>
      </View>

      {loading ? (
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
                    <Text style={styles.liveRoomName} numberOfLines={1}>{r.name}</Text>
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
            <TouchableOpacity key={c.key} style={styles.card} activeOpacity={0.85} onPress={() => router.push(c.route)}>
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
            <TouchableOpacity key={c.id} style={styles.circleCard} activeOpacity={0.85} onPress={() => router.push(`/circles/${c.id}` as any)}>
              <Text style={styles.circleCardName}>{c.name}</Text>
              <Text style={styles.circleCardMeta}>Led by {c.leaderName} · {c.memberCount}/{c.maxMembers} members</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      </View>
    </View>
  );
}
