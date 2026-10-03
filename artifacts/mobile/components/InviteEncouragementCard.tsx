import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, Image } from "react-native";
import { STAGE_IMAGES } from "@/constants/stages";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { shareInviteLink } from "@/lib/sharing";
import {
  type Encouragement, type SnoozeOption, SNOOZE_LABELS,
  isEligible, pickEncouragement, recordVisit, recordShown, recordRemindLater, recordInviteShared,
} from "@/lib/inviteEncouragement";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Shows at most once per eligibility window (see lib/inviteEncouragement.ts).
// Always offers both actions: Invite a Peer, and Remind Me Later — which sets
// a real snooze, it does not just hide the card for this render.
export function InviteEncouragementCard({ modulesCompleted }: { modulesCompleted: number }) {
  const { profile } = useAuth();
  const { getMyInviteLink } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();

  const [message, setMessage] = useState<Encouragement | null>(null);
  const [visible, setVisible] = useState(false);
  const [choosingSnooze, setChoosingSnooze] = useState(false);
  const [busy, setBusy] = useState(false);
  const decidedForUser = useRef<string | null>(null);

  // Decide once per Home mount per user. Eligibility uses the state as it
  // was BEFORE this visit, then the visit and the impression are recorded.
  useEffect(() => {
    const userId = profile?.id;
    if (!userId || decidedForUser.current === userId) return;
    decidedForUser.current = userId;
    void (async () => {
      const prior = await recordVisit(userId);
      const grainCount = profile?.grainCount ?? 0;
      if (!isEligible(prior, grainCount)) return;
      setMessage(pickEncouragement({
        state: prior, grainCount, modulesCompleted, accountCreatedAt: profile?.createdAt ?? null,
      }));
      setVisible(true);
      await recordShown(userId);
    })();
  }, [profile?.id, profile?.grainCount, profile?.createdAt, modulesCompleted]);

  if (!visible || !message || !profile?.id) return null;

  async function handleInvite() {
    if (!profile?.id) return;
    if (!profile.username) {
      showAlert("Set a username first", "Add a username so your invite link can point to you.");
      return;
    }
    setBusy(true);
    try {
      const inviteLink = await getMyInviteLink();
      if (!inviteLink) { showAlert("Couldn't get your invite link", "Please try again."); return; }
      const shared = await shareInviteLink({ username: profile.username, inviteLink });
      if (shared) {
        await recordInviteShared(profile.id);
        setVisible(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSnooze(option: SnoozeOption) {
    if (!profile?.id) return;
    await recordRemindLater(profile.id, option);
    setVisible(false);
  }

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.headerRow}>
        {/* The Sprout growth-stage photo — an existing asset, no new imagery. */}
        <Image source={STAGE_IMAGES[1]} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{message.title} 🌱</Text>
          <Text style={styles.body}>{message.body}</Text>
        </View>
      </View>

      {choosingSnooze ? (
        <View>
          <Text style={styles.snoozeLabel}>Remind me…</Text>
          <View style={styles.snoozeRow}>
            {(Object.keys(SNOOZE_LABELS) as SnoozeOption[]).map((opt) => (
              <TouchableOpacity key={opt} style={styles.snoozeChip} onPress={() => { void handleSnooze(opt); }}>
                <Text style={styles.snoozeChipText}>{SNOOZE_LABELS[opt]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => setChoosingSnooze(false)} style={{ alignSelf: "center", marginTop: 8 }}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => { void handleInvite(); }} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="person-add-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Invite a Peer</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setChoosingSnooze(true)} disabled={busy} activeOpacity={0.85}>
            <Text style={styles.secondaryBtnText}>Remind Me Later</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity onPress={() => router.push("/connect/invite" as any)} style={{ alignSelf: "center", marginTop: 10 }}>
        <Text style={styles.linkText}>What is an Electronic Evangelist?</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: "rgba(224,164,65,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
      padding: 16, marginBottom: 16,
    },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
    image: { width: 72, height: 72, borderRadius: 14 },
    title: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
    body: { fontSize: 14, color: c.textDark, opacity: 0.85, lineHeight: 20, fontFamily: "Inter_400Regular" },
    actions: { flexDirection: "row", gap: 10 },
    primaryBtn: {
      flex: 1, flexDirection: "row", gap: 6, backgroundColor: c.accentGreen, borderRadius: 12, height: 44,
      alignItems: "center", justifyContent: "center",
    },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    secondaryBtn: {
      flex: 1, borderRadius: 12, height: 44, alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: c.borderBeige,
    },
    secondaryBtnText: { color: c.textDark, fontWeight: "600", fontSize: 14, fontFamily: "Inter_600SemiBold" },
    snoozeLabel: { fontSize: 13, color: c.textMuted, marginBottom: 8, fontFamily: "Inter_500Medium" },
    snoozeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    snoozeChip: { borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 14, paddingVertical: 9 },
    snoozeChipText: { color: c.textDark, fontSize: 13, fontFamily: "Inter_500Medium" },
    linkText: { color: c.accentGreen, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  });
}
