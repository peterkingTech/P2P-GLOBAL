import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Linking, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { getTestimony, type PrayerTestimony } from "@/lib/prayerTestimonyApi";
import TestimonyVideoPlayer from "@/components/TestimonyVideoPlayer";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Real growth actions only — never likes/followers/viral ranking (Stage 6
// instruction). Each row navigates to an EXISTING system; nothing here is
// a new feature. "Encourage" is hidden for anonymous testimonies and for
// the viewer's own — there's no one to address it to in either case.
export default function TestimonyDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { reportContent } = useData();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [testimony, setTestimony] = useState<PrayerTestimony | null>(null);
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try { setTestimony(await getTestimony(id)); } finally { setLoading(false); }
    })();
  }, [id]);

  function handleReport() {
    if (!testimony) return;
    Alert.alert(
      "Report this testimony?",
      "A moderator will review it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report", style: "destructive",
          onPress: async () => {
            const err = await reportContent("prayer_testimony", testimony.id, "Reported from testimony feed");
            showAlert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
          },
        },
      ]
    );
  }

  async function handleEncourage() {
    if (!testimony) return;
    setMessaging(true);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: testimony.userId });
      if (error || !data) {
        showAlert("Can't message yet", "You can message peers once you share a study group together, or once they've reached out for help.");
        return;
      }
      router.push(`/messages/${data}` as any);
    } finally {
      setMessaging(false);
    }
  }

  const scriptureRef = (() => {
    const ref = testimony?.scriptureReference as { reference?: string } | null;
    return ref?.reference ?? null;
  })();

  if (loading) {
    return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  }
  if (!testimony) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <Text style={styles.notFound}>This testimony isn't available.</Text>
      </View>
    );
  }

  const isOwn = testimony.userId === profile?.id;
  const canEncourage = !isOwn && !testimony.isAnonymous;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerType}>{testimony.testimonyType === "answered_prayer" ? "Answered Prayer" : "Growth Testimony"}</Text>
        {!isOwn ? (
          <TouchableOpacity onPress={handleReport} accessibilityLabel="Report" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="flag-outline" size={18} color={c.textMuted} />
          </TouchableOpacity>
        ) : <View style={{ width: 18 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.title}>{testimony.title}</Text>
        <Text style={styles.author}>{testimony.isAnonymous ? "Anonymous" : testimony.authorName ?? "A peer"}</Text>

        {testimony.mediaType === "video" && testimony.mediaPath && (
          <View style={{ marginTop: 14 }}>
            <TestimonyVideoPlayer mediaPath={testimony.mediaPath} durationSeconds={testimony.mediaDurationSeconds} />
          </View>
        )}

        <Text style={styles.body}>{testimony.testimonyText}</Text>

        {scriptureRef && (
          <TouchableOpacity
            style={styles.scriptureRow}
            onPress={() => Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(scriptureRef)}`)}
          >
            <Ionicons name="book" size={14} color={c.accentGreen} />
            <Text style={styles.scriptureText}>{scriptureRef}</Text>
            <Ionicons name="open-outline" size={13} color={c.accentGreen} />
          </TouchableOpacity>
        )}

        <View style={styles.actionsWrap}>
          <Text style={styles.actionsTitle}>What would you like to do?</Text>
          <TouchableOpacity style={styles.actionRow} onPress={() => router.push("/prayer/pray-with-me" as any)}>
            <Ionicons name="hand-left-outline" size={18} color={c.accentGreen} />
            <Text style={styles.actionText}>Pray</Text>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionRow} onPress={() => router.push("/curriculum" as any)}>
            <Ionicons name="book-outline" size={18} color={c.accentGreen} />
            <Text style={styles.actionText}>Study</Text>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionRow} onPress={() => router.push("/my-discipleship/journey" as any)}>
            <Ionicons name="leaf-outline" size={18} color={c.accentGreen} />
            <Text style={styles.actionText}>Set a Growth Step</Text>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
          {canEncourage && (
            <TouchableOpacity style={styles.actionRow} onPress={handleEncourage} disabled={messaging}>
              {messaging ? <ActivityIndicator size="small" color={c.accentGreen} /> : <Ionicons name="heart-outline" size={18} color={c.accentGreen} />}
              <Text style={styles.actionText}>Encourage {testimony.authorName ?? "them"}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionRow} onPress={() => router.push("/connect/discover" as any)}>
            <Ionicons name="people-outline" size={18} color={c.accentGreen} />
            <Text style={styles.actionText}>Find a Peer</Text>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center" },
    notFound: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    headerType: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    title: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    author: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 4 },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 21, marginTop: 16 },
    scriptureRow: {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
      backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 14,
    },
    scriptureText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    actionsWrap: { gap: 10, marginTop: 28 },
    actionsTitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
    actionRow: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1,
      borderColor: c.borderBeige, borderRadius: 12, padding: 14,
    },
    actionText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
