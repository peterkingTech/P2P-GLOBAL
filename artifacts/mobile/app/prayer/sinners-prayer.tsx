import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

const PRAYER_LINES = [
  "Lord Jesus, I come to You just as I am.",
  "I confess that I have sinned and fallen short of Your glory.",
  "I believe You died for my sins and rose from the dead.",
  "I ask You to forgive me and come into my heart.",
  "I surrender my life to You today.",
  "Thank You for saving me.",
  "Amen.",
];

export default function SinnersPrayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [prayed, setPrayed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [affirmed, setAffirmed] = useState(false);

  async function logPrivately() {
    if (!profile?.id) return;
    await supabase.from("p2p_prayer_journal").insert({
      user_id: profile.id,
      prayer_text: "I prayed the prayer of commitment.",
      category: "sinners_prayer",
    });
  }

  async function handlePrayed() {
    setPrayed(true);
    await logPrivately();
    setAsking(true);
  }

  async function respondToPeerGuideAsk(tellPeerGuide: boolean) {
    setAsking(false);
    if (tellPeerGuide && profile?.id) {
      setNotifying(true);
      try {
        await fetch(`${getApiUrl()}/prayers/sinners-prayer/notify-peer-guide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: profile.id }),
        });
      } catch {
        // Non-critical — the moment is already logged privately either way.
      } finally {
        setNotifying(false);
      }
    }
    setAffirmed(true);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {affirmed ? (
          <View style={styles.affirmationWrap}>
            <View style={styles.doveRing}>
              <Ionicons name="sparkles" size={30} color="#fff" />
            </View>
            <Text style={styles.affirmationTitle}>Welcome to the family of God.</Text>
            <Text style={styles.affirmationSub}>Your journey begins now.</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
              <Text style={styles.doneBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.iconRing}>
              <Ionicons name="sparkles-outline" size={30} color={colors.upperRoomAmber} />
            </View>
            <Text style={styles.title}>Begin with Jesus</Text>
            <Text style={styles.subtitle}>A prayer of commitment and surrender</Text>

            <View style={styles.prayerCard}>
              {PRAYER_LINES.map((line, i) => (
                <Text key={i} style={styles.prayerLine}>{line}</Text>
              ))}
            </View>

            {!prayed && (
              <TouchableOpacity style={styles.prayedBtn} onPress={handlePrayed} activeOpacity={0.85}>
                <Text style={styles.prayedBtnText}>I prayed this prayer</Text>
              </TouchableOpacity>
            )}

            {asking && (
              <View style={styles.askCard}>
                <Text style={styles.askText}>Would you like to tell your peer guide about this moment?</Text>
                <View style={styles.askRow}>
                  <TouchableOpacity style={styles.askNoBtn} onPress={() => respondToPeerGuideAsk(false)} disabled={notifying}>
                    <Text style={styles.askNoText}>No thanks</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.askYesBtn} onPress={() => respondToPeerGuideAsk(true)} disabled={notifying}>
                    {notifying ? <ActivityIndicator color="#100B06" size="small" /> : <Text style={styles.askYesText}>Yes, tell them</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.upperRoomBg },
    headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
    scroll: { paddingHorizontal: 24, alignItems: "center" },
    iconRing: {
      width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(224,164,65,0.12)",
      borderWidth: 1.5, borderColor: "rgba(224,164,65,0.3)", alignItems: "center", justifyContent: "center", marginBottom: 20,
    },
    title: { fontSize: 24, fontWeight: "700", color: c.upperRoomCream, fontFamily: "Inter_700Bold", textAlign: "center" },
    subtitle: { fontSize: 14, color: c.upperRoomMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6, marginBottom: 28 },
    prayerCard: {
      backgroundColor: c.upperRoomCard, borderRadius: 18, borderWidth: 1, borderColor: c.upperRoomBorder,
      padding: 24, gap: 14, width: "100%",
    },
    prayerLine: { fontSize: 16, color: c.upperRoomCream, fontFamily: "Inter_400Regular", lineHeight: 26, textAlign: "center" },
    prayedBtn: { backgroundColor: c.upperRoomAmber, borderRadius: 14, height: 54, alignItems: "center", justifyContent: "center", marginTop: 28, width: "100%" },
    prayedBtnText: { color: "#100B06", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
    askCard: { backgroundColor: c.upperRoomCard, borderRadius: 16, borderWidth: 1, borderColor: c.upperRoomBorder, padding: 20, marginTop: 20, width: "100%" },
    askText: { fontSize: 14, color: c.upperRoomCream, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 21, marginBottom: 16 },
    askRow: { flexDirection: "row", gap: 10 },
    askNoBtn: { flex: 1, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    askNoText: { color: c.upperRoomMuted, fontSize: 13, fontFamily: "Inter_500Medium" },
    askYesBtn: { flex: 1, backgroundColor: c.upperRoomAmber, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    askYesText: { color: "#100B06", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    affirmationWrap: { alignItems: "center", paddingTop: 60 },
    doveRing: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.upperRoomAmber, alignItems: "center", justifyContent: "center", marginBottom: 24 },
    affirmationTitle: { fontSize: 22, fontWeight: "700", color: c.upperRoomCream, fontFamily: "Inter_700Bold", textAlign: "center" },
    affirmationSub: { fontSize: 14, color: c.upperRoomMuted, fontFamily: "Inter_400Regular", marginTop: 8, textAlign: "center" },
    doneBtn: { backgroundColor: c.upperRoomAmber, borderRadius: 14, paddingHorizontal: 32, height: 50, alignItems: "center", justifyContent: "center", marginTop: 32 },
    doneBtnText: { color: "#100B06", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
