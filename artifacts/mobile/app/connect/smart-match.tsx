import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";

// Peer Guide specific matching — replaces the old generic gift/country
// smart-match with a real eligibility + scoring flow against
// GET /discipleship/find-peer-guide/:userId (see discipleship.ts).

interface Candidate {
  id: string;
  fullName: string;
  photoUrl: string | null;
  country: string | null;
  contentLanguage: string | null;
  modulesCompleted: number;
  activeMenteeCount: number;
  maxMentees: number;
  score: number;
  reasons: string[];
}

type Screen = "intro" | "results" | "sent";

export default function SmartMatch() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  const [screen, setScreen] = useState<Screen>("intro");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [sentToName, setSentToName] = useState<string | null>(null);

  async function findMatch() {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/discipleship/find-peer-guide/${profile.id}`);
      const data = (await res.json()) as Candidate[];
      setCandidates(Array.isArray(data) ? data : []);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
      setScreen("results");
    }
  }

  async function connect(candidate: Candidate) {
    if (!profile?.id) return;
    setConnecting(candidate.id);
    try {
      await fetch(`${getApiUrl()}/discipleship/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId: profile.id, peerGuideId: candidate.id }),
      });
      setSentToName(candidate.fullName);
      setScreen("sent");
    } catch {
      // Best-effort — stay on the results screen so they can try another candidate.
    } finally {
      setConnecting(null);
    }
  }

  const topPad = insets.top;

  return (
    <>
      <Stack.Screen options={{ title: "Find a Peer Guide", headerBackTitle: "Back" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: topPad + 20, paddingHorizontal: 20, paddingBottom: insets.bottom + 60 }}
        showsVerticalScrollIndicator={false}
      >
        {screen === "intro" && (
          <View style={styles.introWrap}>
            <View style={styles.introIconRing}>
              <Ionicons name="compass" size={30} color={colors.primaryGreen} />
            </View>
            <Text style={styles.title}>Find Your Peer Guide</Text>
            <Text style={styles.subtitle}>
              Your peer guide is someone one step ahead of you on the journey — ready to walk with you through every lesson.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={findMatch} disabled={loading} activeOpacity={0.85}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Find My Match</Text>}
            </TouchableOpacity>
          </View>
        )}

        {screen === "results" && (
          <View>
            <Text style={styles.title}>Your Matches</Text>
            {candidates.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="hourglass-outline" size={28} color={colors.accentGreen} />
                <Text style={styles.emptyText}>
                  We couldn't find an available peer guide right now. You've been added to the waitlist — we'll notify
                  you the moment someone becomes available. You can begin Module 1 on your own in the meantime.
                </Text>
              </View>
            ) : (
              <>
                {candidates.length < 3 && (
                  <View style={styles.noticeCard}>
                    <Ionicons name="information-circle-outline" size={18} color={colors.amber} />
                    <Text style={styles.noticeText}>
                      We are still finding the best match for you. We will notify you when someone becomes available.
                    </Text>
                  </View>
                )}
                <View style={{ gap: 12 }}>
                  {candidates.map((c) => (
                    <View key={c.id} style={styles.candidateCard}>
                      <View style={styles.candidateHeader}>
                        {c.photoUrl ? (
                          <Image source={{ uri: c.photoUrl }} style={styles.candidateAvatar} />
                        ) : (
                          <View style={[styles.candidateAvatar, styles.candidateAvatarPlaceholder]}>
                            <Text style={styles.candidateAvatarInitial}>{c.fullName.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.candidateName}>{c.fullName}</Text>
                          <Text style={styles.candidateMeta}>
                            {c.country ?? "Location not set"} · {c.contentLanguage?.toUpperCase() ?? "—"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.statRow}>
                        <Text style={styles.statItem}>{c.modulesCompleted} modules completed</Text>
                        <Text style={styles.statItem}>{c.activeMenteeCount}/{c.maxMentees} mentees</Text>
                      </View>

                      {c.reasons.length > 0 && (
                        <View style={styles.reasonsRow}>
                          {c.reasons.map((r) => (
                            <View key={r} style={styles.reasonPill}>
                              <Text style={styles.reasonPillText}>{r}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      <TouchableOpacity
                        style={styles.connectBtn}
                        onPress={() => connect(c)}
                        disabled={connecting === c.id}
                        activeOpacity={0.85}
                      >
                        {connecting === c.id ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.connectBtnText}>Connect</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {screen === "sent" && (
          <View style={styles.introWrap}>
            <View style={styles.introIconRing}>
              <Ionicons name="paper-plane" size={28} color={colors.primaryGreen} />
            </View>
            <Text style={styles.title}>Request Sent</Text>
            <Text style={styles.subtitle}>Your request has been sent to {sentToName}.</Text>
            <Text style={styles.subtitle}>They will respond within 48 hours.</Text>
            <Text style={styles.subtitleMuted}>While you wait, you can begin Module 1 on your own.</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  introWrap: { alignItems: "center", paddingTop: 40 },
  introIconRing: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(29,158,117,0.1)",
    borderWidth: 1.5, borderColor: "rgba(29,158,117,0.25)", alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 10 },
  subtitle: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, marginBottom: 6 },
  subtitleMuted: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center", marginTop: 12 },
  primaryBtn: {
    backgroundColor: colors.primaryGreen, borderRadius: 14, height: 52, paddingHorizontal: 32,
    alignItems: "center", justifyContent: "center", marginTop: 24, minWidth: 200,
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  emptyCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 24, alignItems: "center", gap: 12, marginTop: 12,
  },
  emptyText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  noticeCard: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "rgba(186,117,23,0.08)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(186,117,23,0.2)",
    padding: 12, marginBottom: 14,
  },
  noticeText: { flex: 1, fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },

  candidateCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 16,
  },
  candidateHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  candidateAvatar: { width: 52, height: 52, borderRadius: 26 },
  candidateAvatarPlaceholder: { backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  candidateAvatarInitial: { color: "#fff", fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  candidateName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  candidateMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

  statRow: { flexDirection: "row", gap: 16, marginBottom: 10 },
  statItem: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  reasonsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  reasonPill: { backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  reasonPillText: { fontSize: 11, color: colors.primaryGreen, fontFamily: "Inter_500Medium" },

  connectBtn: {
    backgroundColor: colors.primaryGreen, borderRadius: 12, height: 44, alignItems: "center", justifyContent: "center",
  },
  connectBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});