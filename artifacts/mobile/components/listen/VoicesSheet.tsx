// P2P VOICES — the voice library, opened from inside the P2P Listen player (no separate player, no new tab).
// Lists ONLY voices the server reports for P2P's connected provider accounts (never a hard-coded list), with the
// accent from each voice's own locale, Female / Male only where the provider says so, characteristics only from
// the provider's metadata. Preview pauses the current listening and puts it back where it was afterwards.
// Choosing a voice is remembered for the CONTENT language (other languages keep their own choice); the listening
// carries on from the same sentence. "Official narration" (owner-approved Kingdom Stories recordings) stays first
// unless the listener turns that off. Bible content is never read by a P2P Voice.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, TextInput, Pressable, ActivityIndicator, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { listen, useListenState } from "@/lib/listen";
import {
  chooseVoice, defaultVoiceFor, getCatalogue, isEligibleKind, previewVoiceAudio, PROVIDER_LABEL, restoreVoiceDefaults, setPreferOfficial, toggleFavourite, useReadingSource, useVoicePrefs,
  type Catalogue, type CatalogueFilter, type P2PVoice,
} from "@/lib/voices";

const base = (l: string) => String(l ?? "").toLowerCase().split(/[-_]/)[0];
const CHAR_LABEL: Record<string, string> = { warm: "Warm", deep: "Deep", gentle: "Gentle", expressive: "Expressive", conversational: "Conversational", narrator: "Narrator", calm: "Calm", clear: "Clear" };

export default function VoicesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(c), [c]);
  const st = useListenState();
  const prefs = useVoicePrefs();
  const { source: reading } = useReadingSource();
  const content = st.content;
  const lang = base(content?.language ?? "en");
  const eligible = !!content && content.kind !== "bible" && isEligibleKind(content.kind);
  const hasOfficial = !!content?.narration;
  const [f, setF] = useState<CatalogueFilter>({ language: lang, purpose: "everyday" });
  const [q, setQ] = useState("");
  const [data, setData] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  const [allLangs, setAllLangs] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewPlayer = useRef<AudioPlayer | null>(null);
  const resumeAfter = useRef(false);

  useEffect(() => { if (visible) setF((x) => ({ ...x, language: lang })); }, [visible, lang]);
  useEffect(() => {
    if (!visible) return;
    setLoading(true); setError(null);
    const h = setTimeout(() => {
      getCatalogue({ ...f, q: q.trim() || undefined }).then(setData).catch(() => setError(t("voices.unavailable", { defaultValue: "P2P Voices aren't available right now. Your phone's voice keeps reading." }))).finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [visible, f, q, t]);
  useEffect(() => () => { previewPlayer.current?.remove(); previewPlayer.current = null; }, []);

  const stopPreview = () => {
    try { previewPlayer.current?.pause(); } catch {}
    setPreviewing(null);
    if (resumeAfter.current) { resumeAfter.current = false; listen.resume(); } // back to the same place
  };
  const preview = async (v: P2PVoice) => {
    if (previewing === v.id) return stopPreview();
    if (listen.getState().status === "playing") { listen.pause(); resumeAfter.current = true; }
    setPreviewing(v.id);
    try {
      const r = await previewVoiceAudio(v.id);
      if (!previewPlayer.current) previewPlayer.current = createAudioPlayer({ uri: r.url });
      else previewPlayer.current.replace({ uri: r.url });
      const p = previewPlayer.current;
      const sub = p.addListener("playbackStatusUpdate", (x) => { if (x.didJustFinish) { sub.remove(); stopPreview(); } });
      p.play();
    } catch { stopPreview(); setError(t("voices.noPreview", { defaultValue: "There's no preview for this voice right now." })); }
  };
  const select = (v: P2PVoice | null) => {
    chooseVoice(v?.language ?? lang, v);
    if (v && hasOfficial && prefs.preferOfficial) setPreferOfficial(false); // they chose this voice for this story
    if (st.status === "playing") listen.voiceSourceChanged(); // same sentence, new voice
  };
  // P2P Voice is the main voice: a language the listener never chose for uses P2P's default voice (marked "Default").
  const langKey = f.language ?? lang;
  const def = defaultVoiceFor(langKey);
  const chosen = langKey in prefs.byLanguage ? prefs.byLanguage[langKey]?.voiceId ?? null : def?.voiceId ?? null;
  const list = (data?.voices ?? []).filter((v) => !onlyFav || prefs.favourites.includes(v.id));
  const toggle = <K extends keyof CatalogueFilter>(k: K, v: CatalogueFilter[K]) => setF((x) => ({ ...x, [k]: x[k] === v ? null : v, page: 0 }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { stopPreview(); onClose(); }} presentationStyle="pageSheet">
      <View style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={s.header}>
          <Text style={s.title} accessibilityRole="header">{t("voices.title", { defaultValue: "P2P Voices" })}</Text>
          <IconButton icon="close" accessibilityLabel={t("voices.close", { defaultValue: "Close" })} onPress={() => { stopPreview(); onClose(); }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={s.now}>
            <Text style={s.label}>{t("voices.nowReading", { defaultValue: "Reading now" })}</Text>
            <Text style={s.nowText}>
              {reading?.mode === "official" ? t("voices.official", { defaultValue: "Official narration · {{voice}}", voice: reading.voice })
                : reading?.mode === "p2p" ? t("voices.synthetic", { defaultValue: "Synthetic voice · {{voice}} ({{provider}})", voice: reading.voice, provider: PROVIDER_LABEL[reading.provider] ?? reading.provider })
                : t("voices.device", { defaultValue: "Your phone's own voice" })}
            </Text>
          </View>

          {content?.kind === "bible" || content?.kind === "playlist" ? (
            <Text style={s.note}>{t("voices.bibleProtected", { defaultValue: "Bible reading always uses your phone's voice or the translation's own licensed audio. P2P Voices never re-create Bible audio." })}</Text>
          ) : !eligible ? (
            <Text style={s.note}>{t("voices.notEligible", { defaultValue: "This reading uses your phone's voice. P2P Voices read Kingdom Stories, lessons, plans and the Daily Word." })}</Text>
          ) : null}

          {hasOfficial ? (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{t("voices.officialFirst", { defaultValue: "Official narration first" })}</Text>
                <Text style={s.note}>{t("voices.officialFirstNote", { defaultValue: "This story has an official recording approved by P2P. Turn this off to hear your chosen voice instead." })}</Text>
              </View>
              <Switch value={prefs.preferOfficial} onValueChange={(v) => { setPreferOfficial(v); if (st.status === "playing") listen.voiceSourceChanged(); }}
                accessibilityLabel={t("voices.officialFirst", { defaultValue: "Official narration first" })} trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
            </View>
          ) : eligible && content?.kind?.startsWith("story") ? (
            <Text style={s.note}>{t("voices.noOfficial", { defaultValue: "This chapter has no official narration yet. Choose a P2P Voice below, or keep your phone's voice." })}</Text>
          ) : null}



          <TextInput value={q} onChangeText={setQ} placeholder={t("voices.search", { defaultValue: "Search voices, accents, languages" })} placeholderTextColor={c.textMuted} style={s.search}
            accessibilityLabel={t("voices.search", { defaultValue: "Search voices, accents, languages" })} />
          {data ? (
            <View style={{ gap: 8 }}>
              <ChipRow accessibilityLabel={t("voices.language", { defaultValue: "Language" })} single>
                {/* Compact: the reading's own language and the chosen one first, then a few; the rest behind "More languages". */}
                {(allLangs ? data.facets.language : data.facets.language.filter((x, i) => x.key === lang || x.key === f.language || i < 6))
                  .map((x) => <FilterChip key={x.key} label={`${x.name} ${x.count}`} selected={f.language === x.key} selection="single" onPress={() => setF((y) => ({ ...y, language: x.key, accent: null, page: 0 }))} />)}
                {data.facets.language.length > 7 ? <FilterChip label={allLangs ? t("voices.fewerLanguages", { defaultValue: "Fewer languages" }) : t("voices.moreLanguages", { defaultValue: "More languages ({{count}})", count: data.facets.language.length })}
                  icon={allLangs ? "chevron-up" : "chevron-down"} selected={false} onPress={() => setAllLangs((x) => !x)} /> : null}
              </ChipRow>
              {data.facets.accent.length > 1 ? (
                <ChipRow accessibilityLabel={t("voices.accent", { defaultValue: "Accent" })}>
                  {data.facets.accent.map((x) => <FilterChip key={x.key} label={`${x.key} ${x.count}`} selected={f.accent === x.key} onPress={() => toggle("accent", x.key)} />)}
                </ChipRow>
              ) : null}
              <ChipRow accessibilityLabel={t("voices.more", { defaultValue: "Voice, provider and character" })}>
                {data.facets.presentation.map((x) => <FilterChip key={x.key} label={`${x.key === "female" ? t("voices.female", { defaultValue: "Female" }) : t("voices.male", { defaultValue: "Male" })} ${x.count}`} selected={f.presentation === x.key} onPress={() => toggle("presentation", x.key)} />)}
                {data.facets.provider.length > 1 ? data.facets.provider.map((x) => <FilterChip key={x.key} label={`${PROVIDER_LABEL[x.key] ?? x.key} ${x.count}`} selected={f.provider === x.key} onPress={() => toggle("provider", x.key)} />) : null}
                {data.facets.characteristic.map((x) => <FilterChip key={x.key} label={`${CHAR_LABEL[x.key] ?? x.key} ${x.count}`} selected={f.characteristic === x.key} onPress={() => toggle("characteristic", x.key)} />)}
                {prefs.favourites.length ? <FilterChip label={t("voices.favourites", { defaultValue: "Favourites" })} icon="star" selected={onlyFav} onPress={() => setOnlyFav((o) => !o)} /> : null}
              </ChipRow>
            </View>
          ) : null}

          {loading && !data ? <ActivityIndicator color={c.accentGreen} /> : null}
          {error ? <Text style={s.note} accessibilityLiveRegion="polite">{error}</Text> : null}
          {data && !data.providers.some((p) => p.enabled) ? (
            <Text style={s.note}>{t("voices.noneConnected", { defaultValue: "P2P Voices are being set up and aren't available yet. Your phone's voice reads aloud meanwhile." })}</Text>
          ) : data && !list.length ? (
            <Text style={s.note}>{t("voices.noneForLanguage", { defaultValue: "There's no P2P Voice for this language yet. Your phone's voice keeps reading." })}</Text>
          ) : null}

          {list.map((v) => {
            const on = chosen === v.id;
            const fav = prefs.favourites.includes(v.id);
            return (
              <View key={v.id} style={[s.voice, on && s.voiceOn]}>
                <Pressable style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onPress={() => select(v)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                  accessibilityLabel={`${v.accent}, ${v.presentation ?? ""}, ${PROVIDER_LABEL[v.provider]}: ${v.name}`}>
                  <Text style={s.voiceName}>{v.accent}</Text>
                  <Text style={s.voiceMeta}>
                    {[v.presentation ? (v.presentation === "female" ? t("voices.female", { defaultValue: "Female" }) : t("voices.male", { defaultValue: "Male" })) : null, PROVIDER_LABEL[v.provider] ?? v.provider, v.name].filter(Boolean).join(" · ")}
                  </Text>
                  {v.characteristics.length ? <Text style={s.voiceTags}>{v.characteristics.map((x) => CHAR_LABEL[x] ?? x).join(" · ")}</Text> : null}
                  <Text style={s.synthetic}>{def?.voiceId === v.id ? `${t("voices.defaultBadge", { defaultValue: "P2P default" })} · ` : ""}{t("voices.syntheticBadge", { defaultValue: "Synthetic voice" })}</Text>
                </Pressable>
                {v.preview ? <IconButton icon={previewing === v.id ? "stop-circle-outline" : "play-circle-outline"} size="sm" accessibilityLabel={t("voices.preview", { defaultValue: "Preview {{name}}", name: v.name })} onPress={() => void preview(v)} /> : null}
                <IconButton icon={fav ? "star" : "star-outline"} size="sm" selected={fav} accessibilityLabel={fav ? t("voices.unfavourite", { defaultValue: "Remove from favourites" }) : t("voices.favourite", { defaultValue: "Add to favourites" })} onPress={() => toggleFavourite(v.id)} />
              </View>
            );
          })}
          {data && data.total > (data.page + 1) * data.pageSize ? <AppButton variant="tertiary" label={t("voices.moreVoices", { defaultValue: "More voices" })} onPress={() => setF((x) => ({ ...x, page: (x.page ?? 0) + 1 }))} /> : null}

          <Pressable style={[s.voice, !chosen && s.voiceOn]} onPress={() => select(null)} accessibilityRole="radio" accessibilityState={{ checked: !chosen }}>
            <View style={{ flex: 1 }}>
              <Text style={s.voiceName}>{t("voices.phoneVoice", { defaultValue: "My phone's voice (backup)" })}</Text>
              <Text style={s.voiceMeta}>{t("voices.phoneVoiceNote", { defaultValue: "Used automatically for the Bible, when you're offline, or if a P2P Voice isn't available" })}</Text>
            </View>
          </Pressable>
          <Text style={s.note}>{t("voices.disclosure", { defaultValue: "When you choose a P2P Voice, the text you are listening to is sent to that provider to create the audio. Your private notes, messages and prayers are never sent." })}</Text>
          <AppButton variant="tertiary" icon="refresh" label={t("voices.restore", { defaultValue: "Restore default voices" })} onPress={() => { restoreVoiceDefaults(); if (st.status === "playing") listen.voiceSourceChanged(); }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: "800", color: c.textDark },
  now: { padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, gap: 2 },
  nowText: { color: c.textDark, fontSize: 15, fontWeight: "700" },
  label: { color: c.textMid, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
  rowTitle: { color: c.textDark, fontSize: 15, fontWeight: "700" },
  search: { minHeight: 46, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.textDark, backgroundColor: c.card },
  voice: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
  voiceOn: { borderColor: c.accentGreen, borderWidth: 2 },
  voiceName: { color: c.textDark, fontSize: 15, fontWeight: "700" },
  voiceMeta: { color: c.textMid, fontSize: 13 },
  voiceTags: { color: c.textMuted, fontSize: 12 },
  synthetic: { color: c.textMuted, fontSize: 11, fontWeight: "700", marginTop: 2 },
});
