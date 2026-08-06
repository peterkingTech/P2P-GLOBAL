import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// Where a peer guide sees which of their active disciples have completed
// the Core Curriculum and writes/sends each one a completion letter.
// Reached from the Connect hub's "Completion Letters" tile.

interface Graduate {
  id: string;
  fullName: string;
  photoUrl: string | null;
  completedAt: string;
  letterStatus: "not_started" | "draft" | "sent";
}

export default function GraduatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();

  const [graduates, setGraduates] = useState<Graduate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data: links } = await supabase
        .from("p2p_discipleship_links")
        .select("disciple_id")
        .eq("mentor_id", profile.id)
        .eq("active", true);
      const discipleIds = (links ?? []).map((l: any) => l.disciple_id as string);
      if (discipleIds.length === 0) {
        setGraduates([]);
        return;
      }

      const { data: profiles } = await supabase
        .from("p2p_profiles")
        .select("id, full_name, photo_url, curriculum_completed_at")
        .in("id", discipleIds)
        .not("curriculum_completed_at", "is", null);

      const { data: letters } = await supabase
        .from("p2p_completion_letters")
        .select("learner_id, is_draft")
        .eq("peer_guide_id", profile.id);
      const letterByLearner = new Map((letters ?? []).map((l: any) => [l.learner_id as string, l.is_draft as boolean]));

      const rows: Graduate[] = ((profiles ?? []) as any[]).map((p) => ({
        id: p.id,
        fullName: p.full_name ?? "A disciple",
        photoUrl: p.photo_url ?? null,
        completedAt: p.curriculum_completed_at,
        letterStatus: !letterByLearner.has(p.id) ? "not_started" : letterByLearner.get(p.id) ? "draft" : "sent",
      }));
      rows.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
      setGraduates(rows);
    } catch {
      setGraduates([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const topPad = insets.top;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Completion Letters</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
        ) : graduates.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="leaf-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyStateText}>None of your disciples have completed the Core Curriculum yet.</Text>
          </View>
        ) : (
          graduates.map((g) => (
            <TouchableOpacity
              key={g.id}
              style={styles.graduateCard}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: "/write-completion-letter", params: { learnerId: g.id } } as any)}
            >
              {g.photoUrl ? (
                <Image source={{ uri: g.photoUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{g.fullName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.learnerName}>{g.fullName}</Text>
                <Text style={styles.learnerMeta}>
                  Completed {new Date(g.completedAt).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
                </Text>
              </View>
              <View style={[styles.statusPill, g.letterStatus === "sent" && styles.statusPillSent]}>
                <Text style={[styles.statusPillText, g.letterStatus === "sent" && styles.statusPillTextSent]}>
                  {g.letterStatus === "sent" ? "Sent" : g.letterStatus === "draft" ? "Draft saved" : "Write a letter"}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, gap: 12 },
  headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  scroll: { padding: 20, gap: 12 },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 12 },
  emptyStateText: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },

  graduateCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 16, padding: 14, marginBottom: 12,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  learnerName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  learnerMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(224,164,65,0.15)" },
  statusPillText: { fontSize: 11, fontWeight: "600", color: colors.amber, fontFamily: "Inter_600SemiBold" },
  statusPillSent: { backgroundColor: "rgba(29,158,117,0.15)" },
  statusPillTextSent: { color: colors.accentGreen },
});