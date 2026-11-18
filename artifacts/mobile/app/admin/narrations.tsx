// ADMIN › STORY NARRATION — the owner-controlled workflow for OFFICIAL Kingdom Stories narration (owner brief
// 2026-11-18). Owner only: the API (routes/narrationsAdmin.ts) requires super_admin on every action; this screen
// is only the interface. P2P never generates narration here — the owner generates it outside P2P (ElevenLabs,
// with the narration script) and uploads the MP3 and its word-timing file. Also shows the P2P Voices providers
// (connected or not, and why) and usage, with no secrets.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, Platform } from "react-native";
import { Stack } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { apiRequest } from "@/lib/apiClient";
import { useAdminContentWidth } from "@/lib/adminLayout";

type Rec = { id: string; story_id: string; chapter_id: string; language: string; provider: string; voice_name: string; voice_id: string | null; accent: string | null; model: string | null;
  audio_format: string | null; duration_seconds: number | null; size_bytes: number | null; content_version: string | null; status: string; reason: string | null; legacy: boolean;
  uploaded_at: string | null; approved_at: string | null; published_at: string | null; withdrawn_at: string | null; created_at: string };
type Chapter = { id: string; chapter_number: number; title: string; recordings: { language: string; status: string }[] };
type Story = { id: string; title: string; status: string; chapters: Chapter[] };
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const call = <T,>(path: string, init: RequestInit = {}) => apiRequest<T>(`/admin/narrations${path}`, init, { fallbackError: "Something went wrong." });
const STATUS_LABEL: Record<string, string> = { awaiting_upload: "Waiting for upload", uploaded: "Uploaded — awaiting your review", approved: "Approved — not yet published", rejected: "Rejected",
  published: "Published (official)", withdrawn: "Withdrawn", superseded: "Replaced by a newer version" };

async function putFile(url: string, asset: DocumentPicker.DocumentPickerAsset, contentType: string) {
  const body: Blob = (asset as any).file ?? (await (await fetch(asset.uri)).blob());
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "true" }, body });
  if (!r.ok) throw new Error(`Upload failed (${r.status}).`);
}

export default function StoryNarrationAdmin() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const width = useAdminContentWidth();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ language: "en", provider: "elevenlabs", voiceName: "", voiceId: "", accent: "", model: "", notes: "" });
  const [audio, setAudio] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [timings, setTimings] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, { action: string; created_at: string; detail: Record<string, unknown> }[]>>({});
  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  const [voices, setVoices] = useState<any>(null);

  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };
  const loadStories = useCallback(() => call<{ stories: Story[] }>("/stories").then((r) => setStories(r.stories)).catch((e) => say((e as Error).message)), []);
  const loadRecs = useCallback((st: Story) => call<{ recordings: Rec[] }>(`?storyId=${st.id}`).then((r) => setRecs(r.recordings)).catch((e) => say((e as Error).message)), []);
  useEffect(() => { void loadStories(); apiRequest("/voices/admin/status", {}, { fallbackError: "" }).then(setVoices).catch(() => {}); }, [loadStories]);
  useEffect(() => { if (story) void loadRecs(story); }, [story, loadRecs]);
  useEffect(() => () => { player?.remove(); }, [player]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); say(done); if (story) { await loadRecs(story); await loadStories(); } } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const upload = () => act(async () => {
    if (!story || !chapter) throw new Error("Choose a story and chapter.");
    if (!audio || !timings) throw new Error("Choose the MP3 and its word-timing JSON file.");
    const d = await call<{ id: string; upload: { audio: { url: string; contentType: string }; timings: { url: string; contentType: string } } }>("/draft",
      json("POST", { storyId: story.id, chapterId: chapter.id, ...form, audioExt: "mp3" }));
    await putFile(d.upload.audio.url, audio, d.upload.audio.contentType);
    await putFile(d.upload.timings.url, timings, d.upload.timings.contentType);
    await call(`/${d.id}/uploaded`, json("POST"));
    setAudio(null); setTimings(null);
  }, "Uploaded and checked. Listen to it, then approve or reject.");
  const preview = (r: Rec) => act(async () => {
    const { url } = await call<{ url: string }>(`/${r.id}/preview`);
    player?.remove();
    const p = createAudioPlayer({ uri: url }); setPlayer(p); p.play();
  }, "Playing the recording.");
  const loadHistory = (r: Rec) => call<{ events: any[] }>(`/${r.id}/history`).then((h) => setHistory((x) => ({ ...x, [r.id]: h.events }))).catch((e) => say((e as Error).message));

  const chapterRecs = recs.filter((r) => chapter && r.chapter_id === chapter.id);
  return (
    <>
      <Stack.Screen options={{ title: "Story narration" }} />
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16, gap: 14, width: "100%", maxWidth: Math.max(320, Math.min(width, 1000)), alignSelf: "center" }}>
        <View style={s.banner}>
          <Text style={s.h}>Official Kingdom Stories narration — owner only</Text>
          <Text style={s.note}>P2P never generates narration and never spends ElevenLabs credits. Generate the recording yourself, then upload the MP3 and its word-timing file here. Only recordings you approve and publish play as official narration; everything is kept and audited.</Text>
        </View>
        {msg ? <Text style={s.flash} accessibilityLiveRegion="polite">{msg}</Text> : null}

        <Text style={s.label}>1 · Story</Text>
        <ChipRow accessibilityLabel="Stories">
          {(stories ?? []).map((x) => <FilterChip key={x.id} label={x.title} selected={story?.id === x.id} onPress={() => { setStory(x); setChapter(null); }} />)}
        </ChipRow>
        {story ? (
          <>
            <Text style={s.label}>2 · Chapter or section</Text>
            <ChipRow accessibilityLabel="Chapters">
              {story.chapters.map((ch) => {
                const pub = ch.recordings.some((r) => r.status === "published");
                return <FilterChip key={ch.id} label={`${ch.chapter_number === 0 ? "Introduction" : `${ch.chapter_number}. ${ch.title}`}${pub ? " ✓" : ""}`} selected={chapter?.id === ch.id} onPress={() => setChapter(ch)} />;
              })}
            </ChipRow>
          </>
        ) : null}

        {story && chapter ? (
          <View style={s.card}>
            <Text style={s.h}>3 · Upload a recording you generated</Text>
            {(["language", "voiceName", "voiceId", "accent", "model", "notes"] as const).map((k) => (
              <TextInput key={k} value={form[k]} onChangeText={(v) => setForm((f) => ({ ...f, [k]: v }))} style={s.input} placeholderTextColor={c.textMuted}
                placeholder={{ language: "Language (e.g. en)", voiceName: "Voice name (required)", voiceId: "Provider voice ID (optional)", accent: "Accent (e.g. British English)", model: "Model (e.g. Eleven v4)", notes: "Notes (optional)" }[k]}
                accessibilityLabel={k} />
            ))}
            <ChipRow accessibilityLabel="Provider" single>
              {[["elevenlabs", "ElevenLabs"], ["studio", "Studio recording"], ["other", "Other"]].map(([k, l]) => <FilterChip key={k} label={l} selected={form.provider === k} selection="single" onPress={() => setForm((f) => ({ ...f, provider: k }))} />)}
            </ChipRow>
            <View style={s.row}>
              <AppButton size="sm" variant="secondary" icon="musical-note-outline" label={audio ? `MP3: ${audio.name}` : "Choose MP3"} onPress={async () => { const r = await DocumentPicker.getDocumentAsync({ type: ["audio/mpeg"], copyToCacheDirectory: true }); if (!r.canceled) setAudio(r.assets[0]); }} />
              <AppButton size="sm" variant="secondary" icon="code-outline" label={timings ? `Timings: ${timings.name}` : "Choose word-timing JSON"} onPress={async () => { const r = await DocumentPicker.getDocumentAsync({ type: ["application/json"], copyToCacheDirectory: true }); if (!r.canceled) setTimings(r.assets[0]); }} />
            </View>
            <Text style={s.note}>The server checks it is a real MP3 (by its bytes, up to 80 MB) and that the timing file belongs to this story, chapter and language.</Text>
            <AppButton icon="cloud-upload-outline" label="Upload and check" loading={busy} disabled={busy || !form.voiceName.trim() || !audio || !timings} onPress={() => void upload()} />
          </View>
        ) : null}

        {story && chapter ? (
          <View style={{ gap: 10 }}>
            <Text style={s.h}>Recordings for this chapter</Text>
            {!chapterRecs.length ? <Text style={s.note}>None uploaded through this workflow yet. A recording uploaded before it (if any) keeps playing until you withdraw it below.</Text> : null}
            {chapterRecs.map((r) => (
              <View key={r.id} style={[s.card, r.status === "published" && s.published]}>
                <Text style={s.recTitle}>{r.voice_name} · {r.language}{r.accent ? ` · ${r.accent}` : ""} · {r.provider}</Text>
                <Text style={s.status}>{STATUS_LABEL[r.status] ?? r.status}{r.legacy ? " (legacy recording)" : ""}</Text>
                <Text style={s.note}>{[r.duration_seconds ? `${Math.floor(r.duration_seconds / 60)}:${String(r.duration_seconds % 60).padStart(2, "0")}` : null, r.size_bytes ? `${(r.size_bytes / 1048576).toFixed(1)} MB` : null,
                  r.audio_format, r.model, r.content_version ? `content version ${r.content_version.slice(0, 19)}` : null, r.uploaded_at ? `uploaded ${r.uploaded_at.slice(0, 16).replace("T", " ")}` : null,
                  r.published_at ? `published ${r.published_at.slice(0, 16).replace("T", " ")}` : null].filter(Boolean).join(" · ")}</Text>
                {r.reason ? <Text style={s.note}>Reason: {r.reason}</Text> : null}
                <View style={s.row}>
                  {!r.legacy && r.status !== "awaiting_upload" ? <AppButton size="sm" variant="secondary" icon="play-outline" label="Preview" onPress={() => void preview(r)} /> : null}
                  <AppButton size="sm" variant="tertiary" icon="time-outline" label="History" onPress={() => void loadHistory(r)} />
                </View>
                {r.status === "uploaded" ? (
                  <View style={s.row}>
                    <Switch value={!!verified[r.id]} onValueChange={(v) => setVerified((x) => ({ ...x, [r.id]: v }))} accessibilityLabel="I listened: it is the right story and chapter" />
                    <Text style={[s.note, { flex: 1 }]}>I listened: it is the right story and chapter</Text>
                    <AppButton size="sm" icon="checkmark" label="Approve" disabled={!verified[r.id] || busy} onPress={() => void act(() => call(`/${r.id}/approve`, json("POST", { verified: true })), "Approved. Publish it when you are ready.")} />
                  </View>
                ) : null}
                {r.status === "approved" ? <AppButton size="sm" icon="megaphone-outline" label="Publish as official narration" disabled={busy} onPress={() => void act(() => call(`/${r.id}/publish`, json("POST")), "Published. Participants now hear this recording.")} /> : null}
                {["uploaded", "approved", "published"].includes(r.status) ? (
                  <View style={s.row}>
                    <TextInput value={reason[r.id] ?? ""} onChangeText={(v) => setReason((x) => ({ ...x, [r.id]: v }))} placeholder="Reason" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1, minWidth: 160 }]} />
                    {r.status === "published"
                      ? <AppButton size="sm" variant="secondary" icon="eye-off-outline" label="Withdraw" disabled={busy || !(reason[r.id] ?? "").trim()} onPress={() => void act(() => call(`/${r.id}/withdraw`, json("POST", { reason: reason[r.id] })), "Withdrawn. Nothing was deleted.")} />
                      : <AppButton size="sm" variant="secondary" icon="close" label="Reject" disabled={busy || !(reason[r.id] ?? "").trim()} onPress={() => void act(() => call(`/${r.id}/reject`, json("POST", { reason: reason[r.id] })), "Rejected.")} />}
                  </View>
                ) : null}
                {history[r.id] ? history[r.id].map((h, i) => <Text key={i} style={s.note}>{h.created_at.slice(0, 16).replace("T", " ")} · {h.action}</Text>) : null}
              </View>
            ))}
            <View style={s.card}>
              <Text style={s.h}>Recording uploaded before this workflow</Text>
              <Text style={s.note}>If this chapter already had narration (uploaded by script), it keeps playing as official narration. You can withdraw it — the files stay — and restore it later.</Text>
              <View style={s.row}>
                <TextInput value={reason.legacy ?? ""} onChangeText={(v) => setReason((x) => ({ ...x, legacy: v }))} placeholder="Reason" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1, minWidth: 160 }]} />
                <AppButton size="sm" variant="secondary" label="Withdraw legacy" disabled={busy || !(reason.legacy ?? "").trim()} onPress={() => void act(() => call("/legacy/withdraw", json("POST", { storyId: story.id, chapterId: chapter.id, language: form.language, reason: reason.legacy })), "Legacy recording withdrawn (files kept).")} />
                <AppButton size="sm" variant="tertiary" label="Restore legacy" disabled={busy} onPress={() => void act(() => call("/legacy/restore", json("POST", { storyId: story.id, chapterId: chapter.id, language: form.language })), "Legacy recording restored.")} />
              </View>
            </View>
          </View>
        ) : null}

        {voices ? (
          <View style={s.card}>
            <Text style={s.h}>P2P Voices — providers</Text>
            {(voices.providers ?? []).map((p: any) => (
              <Text key={p.id} style={s.note}><Text style={s.recTitle}>{p.name}: </Text>{p.enabled ? "connected" : `not connected — ${p.reason}`}{"\n"}{p.role}</Text>
            ))}
            {(voices.candidates ?? []).map((p: any) => <Text key={p.id} style={s.note}><Text style={s.recTitle}>{p.name} (candidate): </Text>{p.finding}</Text>)}
            <Text style={s.note}>ElevenLabs generation by P2P: {voices.elevenlabs?.generation}. Credits spent by P2P: {voices.elevenlabs?.creditsSpentByP2P}.</Text>
            {(voices.usage ?? []).map((u: any) => <Text key={u.provider} style={s.note}>{u.provider}: {u.generated} generated · {u.cached} from cache · {u.characters} characters · {u.errors} errors (since the server started)</Text>)}
          </View>
        ) : null}
        {Platform.OS === "web" ? null : <View style={{ height: 40 }} />}
      </ScrollView>
    </>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  banner: { padding: 14, borderRadius: 14, borderWidth: 2, borderColor: c.accentGreen, backgroundColor: c.card, gap: 6 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, gap: 8 },
  published: { borderColor: c.accentGreen, borderWidth: 2 },
  h: { color: c.textDark, fontSize: 16, fontWeight: "800" },
  label: { color: c.textMid, fontSize: 13, fontWeight: "800" },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  flash: { color: c.textDark, fontSize: 14, fontWeight: "600" },
  recTitle: { color: c.textDark, fontSize: 15, fontWeight: "700" },
  status: { color: c.accentGreen, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 44, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: c.textDark, backgroundColor: c.lightCream },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
});
