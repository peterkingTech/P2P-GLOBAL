import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

interface MyCircle {
  id: string;
  name: string;
  planId: string | null;
  curriculumId: string | null;
  currentLessonId: string | null;
  status: string;
  memberCount: number;
  leaderName: string;
  sessions: { scheduledAt: string | null; sessionStatus: string }[];
}

export default function MyCirclesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [circles, setCircles] = useState<MyCircle[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const apiUrl = getApiUrl();
      const allRes = await fetch(`${apiUrl}/circles?status=forming,active,completed`);
      const all = (await allRes.json()) as (MyCircle & { id: string })[];
      // Filter to circles this user is an active member of, by checking each
      // circle's detail — small N in practice (a user is in a handful of
      // circles at most), so this is simpler than a dedicated "my circles" endpoint.
      const details = await Promise.all(
        all.map((c) => fetch(`${apiUrl}/circles/${c.id}`).then((r) => r.json()).catch(() => null))
      );
      const mine = details.filter(
        (d) => d && Array.isArray(d.members) && d.members.some((m: { userId: string }) => m.userId === profile.id)
      );
      setCircles(mine);
    } catch {
      setCircles([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const topPad = insets.top;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>My Circles</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.primaryActionBtn} onPress={() => router.push("/circles/create" as any)}>
            <Ionicons name="add-circle-outline" size={16} color="#fff" />
            <Text style={styles.primaryActionText}>Create Circle</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryActionBtn} onPress={() => router.push("/circles/discover" as any)}>
            <Ionicons name="search" size={16} color={colors.accentGreen} />
            <Text style={styles.secondaryActionText}>Find a Circle</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
        ) : circles.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyStateText}>You're not part of any circles yet. Create one or find one to join.</Text>
          </View>
        ) : (
          circles.map((c) => {
            const nextSession = c.sessions.find((s) => s.sessionStatus === "scheduled" && s.scheduledAt);
            return (
              <TouchableOpacity key={c.id} style={styles.circleCard} activeOpacity={0.88} onPress={() => router.push(`/circles/${c.id}` as any)}>
                <View style={styles.circleIconWrap}>
                  <Ionicons name="people-circle" size={26} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.circleName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.circleMeta}>{c.memberCount} member{c.memberCount === 1 ? "" : "s"} · Led by {c.leaderName}</Text>
                  {nextSession?.scheduledAt ? (
                    <Text style={styles.circleNextSession}>Next session: {new Date(nextSession.scheduledAt).toLocaleDateString()}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    scroll: { padding: 20 },
    actionsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
    primaryActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accentGreen, borderRadius: 14, paddingVertical: 13 },
    primaryActionText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 14, paddingVertical: 13 },
    secondaryActionText: { color: c.accentGreen, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    emptyState: { alignItems: "center", paddingVertical: 40, gap: 12 },
    emptyStateText: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", paddingHorizontal: 20, lineHeight: 19 },
    circleCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 10 },
    circleIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
    circleName: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    circleMeta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },
    circleNextSession: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_500Medium", marginTop: 3 },
  });
}
