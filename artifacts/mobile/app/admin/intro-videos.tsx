// Admin Centre → About P2P videos (brief §7): the review status of every language asset of the 11 introduction
// videos — subtitles, on-screen text and voice-over. A translation or a generated voice is never published by
// itself: a reviewer approves (super_admin, admin_content, admin_translation), then a content administrator
// publishes (super_admin, admin_content). The server enforces the roles and the order (routes/introVideos.ts);
// this screen only shows what it allows. Needs migration 260 to record decisions — until then it is read-only.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { apiRequest } from "@/lib/apiClient";
import { useAdminContentWidth } from "@/lib/adminLayout";
import { LANGUAGE_DISPLAY, type SupportedLanguage } from "@/lib/i18n";

type Kind = "subtitles" | "overlays" | "audio";
interface Row { videoId: string; language: string; subtitles: string; overlays: string; audio: string }
interface Status { reviewEnabled: boolean; mediaReady: boolean; languages: string[]; videos: { id: string; title: string }[]; rows: Row[] }

const KIND_LABEL: Record<Kind, string> = { subtitles: "Subtitles", overlays: "On-screen text", audio: "Voice-over" };
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", translated: "Translated", audio_generated: "Audio generated", awaiting_review: "Awaiting review",
  approved: "Approved", published: "Published", withdrawn: "Withdrawn",
};
const NEXT: Record<string, { to: string; label: string }[]> = {
  translated: [{ to: "awaiting_review", label: "Send for review" }],
  audio_generated: [{ to: "awaiting_review", label: "Send for review" }],
  awaiting_review: [{ to: "approved", label: "Approve" }, { to: "translated", label: "Needs changes" }],
  approved: [{ to: "published", label: "Publish" }, { to: "awaiting_review", label: "Back to review" }],
  published: [{ to: "withdrawn", label: "Withdraw" }],
  withdrawn: [{ to: "published", label: "Publish again" }],
  not_started: [],
};

export default function IntroVideosAdmin() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const width = useAdminContentWidth();
  const router = useRouter();
  const [data, setData] = useState<Status | null>(null);
  const [lang, setLang] = useState<string>("de");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiRequest<Status>("/intro-videos/admin/status").then(setData).catch((e) => setMsg((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);

  const change = async (videoId: string, kind: Kind, to: string) => {
    setBusy(true);
    try {
      await apiRequest("/intro-videos/admin/status", { method: "POST", body: JSON.stringify({ videoId, language: lang, kind, status: to }) });
      setMsg(`${videoId} · ${KIND_LABEL[kind]}: ${STATUS_LABEL[to]}`); await load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };

  const name = (code: string) => { const d = LANGUAGE_DISPLAY[code as SupportedLanguage]; return d ? `${d.flag} ${d.label}` : code; };
  const rows = (data?.rows ?? []).filter((r) => r.language === lang);

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { width }]}>
      <Stack.Screen options={{ title: "About P2P videos" }} />
      <Text style={s.h1}>About P2P videos — languages</Text>
      <Text style={s.p}>Each language has three parts per video. Members see a part only when it is Published. Translations made by machine or AI, and generated voices, must be reviewed by a person before they are approved. Scripture is quoted only from a real Bible translation, with its credit.</Text>
      {data && !data.reviewEnabled ? <Text style={s.warn}>Read-only: recording review decisions needs migration 260 (proposed, not applied).</Text> : null}
      {data && !data.mediaReady ? <Text style={s.warn}>The video files are not hosted yet (INTRO_VIDEOS_MEDIA_URL is not set) — members cannot play them.</Text> : null}
      {msg ? <Text style={s.msg}>{msg}</Text> : null}
      <AppButton label="Preview the library with unpublished languages" icon="eye-outline" variant="secondary" onPress={() => router.push("/about-p2p?preview=1" as any)} style={{ alignSelf: "flex-start", marginBottom: 12 }} />

      <ChipRow accessibilityLabel="Language" single>
        {(data?.languages ?? []).map((code) => <FilterChip key={code} label={name(code)} selected={lang === code} onPress={() => setLang(code)} />)}
      </ChipRow>

      {rows.map((r) => {
        const title = data!.videos.find((v) => v.id === r.videoId)?.title ?? r.videoId;
        return (
          <View key={r.videoId} style={s.card}>
            <Text style={s.title}>{r.videoId} · {title}</Text>
            {(["subtitles", "overlays", "audio"] as Kind[]).map((k) => (
              <View key={k} style={s.line}>
                <Text style={s.kind}>{KIND_LABEL[k]}</Text>
                <Text style={[s.status, r[k] === "published" && { color: c.accentGreen }, r[k] === "awaiting_review" && { color: c.amber }]}>{STATUS_LABEL[r[k]] ?? r[k]}</Text>
                <View style={s.actions}>
                  {data!.reviewEnabled && lang !== "en" ? (NEXT[r[k]] ?? []).map((n) => (
                    <Pressable key={n.to} disabled={busy} onPress={() => change(r.videoId, k, n.to)} style={s.action} accessibilityRole="button">
                      <Text style={s.actionText}>{n.label}</Text>
                    </Pressable>
                  )) : null}
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.lightCream },
  content: { alignSelf: "center", padding: 20, paddingTop: Platform.OS === "web" ? 24 : 16, gap: 10 },
  h1: { fontFamily: "Inter_700Bold", fontSize: 20, color: c.textDark },
  p: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, color: c.textMid },
  warn: { fontFamily: "Inter_500Medium", fontSize: 13, color: c.amber },
  msg: { fontFamily: "Inter_500Medium", fontSize: 13, color: c.textDark, backgroundColor: c.cardBeige, padding: 10, borderRadius: 8 },
  card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 12, gap: 6 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: c.textDark },
  line: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  kind: { fontFamily: "Inter_500Medium", fontSize: 13, color: c.textMid, width: 110 },
  status: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: c.textMuted, width: 120 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  actionText: { fontFamily: "Inter_500Medium", fontSize: 12, color: c.textDark },
});
