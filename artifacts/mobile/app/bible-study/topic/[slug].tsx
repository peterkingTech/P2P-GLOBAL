import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { getTopic, type PrayerTopicDetail } from "@/lib/prayerTopicsApi";
import { topicPassageRoute } from "@/lib/bibleStudy";
import { AppButton, IconButton } from "@/components/ui";

// One Scripture topic (Bible Study → Explore Scripture by Topic): the
// editorially curated references for the topic, each opened in context in the
// P2P Bible reader. References only — the text is read in the reader from the
// licensed translations. Reading here never changes Pray the Word progress.

export default function BibleTopicScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useLayout();
  const [topic, setTopic] = useState<PrayerTopicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!slug) return;
    setError(null);
    getTopic(String(slug)).then(setTopic).catch((e) => setError(e?.message ?? "This topic couldn't load."));
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const refs = [...(topic?.scriptures ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }, centeredMaxWidth(contentMaxWidth)]}>
        <View style={s.header}>
          <IconButton icon="arrow-back" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/bible-study" as any))} color={colors.textDark} style={{ marginLeft: -10 }} />
          <Text style={[s.title, { flex: 1 }]} accessibilityRole="header" numberOfLines={2}>{topic?.title ?? "Topic"}</Text>
        </View>
        {error ? (
          <View style={{ gap: 8 }}>
            <Text style={s.meta}>{error}</Text>
            <AppButton label="Try again" onPress={load} variant="tertiary" />
          </View>
        ) : !topic ? <ActivityIndicator color={colors.accentGreen} accessibilityLabel="Loading topic" />
          : (
            <>
              {topic.description ? <Text style={s.body}>{topic.description}</Text> : null}
              {refs.length === 0 ? <Text style={s.meta}>No passages are listed for this topic yet.</Text> : refs.map((r) => {
                const route = topicPassageRoute(r);
                return (
                  <TouchableOpacity key={r.id} style={s.ref} disabled={!route} onPress={() => route && router.push(route as any)}
                    accessibilityRole="button" accessibilityLabel={`Read ${r.referenceDisplay} in context`} accessibilityState={{ disabled: !route }}>
                    <Ionicons name="book-outline" size={18} color={colors.accentGreen} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.refTitle}>{r.referenceDisplay}</Text>
                      {r.role === "core" ? <Text style={s.kicker}>Key passage</Text> : null}
                      {r.editorialNote ? <Text style={s.meta}>{r.editorialNote}</Text> : null}
                    </View>
                    {route ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { paddingHorizontal: 16, gap: 10 },
    header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
    back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -10 },
    title: { fontSize: 24, lineHeight: 30, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 15, lineHeight: 22, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 4 },
    meta: { fontSize: 12, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    kicker: { fontSize: 11, color: c.amber, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    ref: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    refTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    retry: { minHeight: 44, justifyContent: "center" },
    retryText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
