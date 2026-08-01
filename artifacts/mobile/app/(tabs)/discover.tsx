import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
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
  const { getDiscoverablePeers, getGroups, getPrayerWallPosts, forestStats, missions } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { isTablet } = useLayout();

  const [loading, setLoading] = useState(true);
  const [peerCount, setPeerCount] = useState(0);
  const [groupCount, setGroupCount] = useState(0);
  const [wallCount, setWallCount] = useState(0);
  const [circles, setCircles] = useState<DiscoverCircleSummary[]>([]);
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setLoading(true);
    const [peers, groups, posts] = await Promise.all([
      getDiscoverablePeers(),
      getGroups(),
      getPrayerWallPosts("recent"),
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
  }, [getDiscoverablePeers, getGroups, getPrayerWallPosts]);

  useEffect(() => { load(); }, [load]);

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
