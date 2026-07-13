import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

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
    setLoading(false);
  }, [getDiscoverablePeers, getGroups, getPrayerWallPosts]);

  useEffect(() => { load(); }, [load]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const cards = [
    { key: "peers", icon: "people-outline" as const, title: "Discoverable Peers", count: peerCount, sub: "Believers ready to connect with you", route: "/connect/discover" as const },
    { key: "groups", icon: "people-circle-outline" as const, title: "Peer Groups", count: groupCount, sub: "Study groups you can join", route: "/connect/groups" as const },
    { key: "smart-match", icon: "sparkles-outline" as const, title: "Smart Match", count: null, sub: "Let us pair you with a study partner", route: "/connect/smart-match" as const },
    { key: "wall", icon: "hand-left-outline" as const, title: "Prayer Wall", count: wallCount, sub: "Requests and testimonies across nations", route: "/(tabs)/prayer" as const },
    { key: "countries", icon: "earth-outline" as const, title: "Countries Reached", count: forestStats.countriesReached.length, sub: "Nations touched through your network", route: "/living-tree" as const },
    { key: "missions", icon: "flag-outline" as const, title: "Missions", count: missions.length, sub: "Unreached peoples to pray for", route: "/(tabs)/missions" as const },
  ];

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' } : { flex: 1 }}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>Discover</Text>
        <Text style={styles.headerSub}>Find peers, groups, and ways to connect</Text>
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
        </ScrollView>
      )}
      </View>
    </View>
  );
}
