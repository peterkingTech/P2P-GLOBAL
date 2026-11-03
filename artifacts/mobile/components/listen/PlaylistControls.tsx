import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { listen, type ListenState } from "@/lib/listen";
import { changeQueue, cycleRepeat, retryUnavailable, saveQueueAsPlaylist, setShuffle, usePlaylistSession } from "@/lib/listen/playlistSession";

// The Read & Listen screen's playlist controls (Scripture playlists and
// collections): Shuffle, Repeat (off → everything → this passage), the
// listening queue (jump to, Play next, move, remove, keep as a playlist) and
// any passages that couldn't be loaded. All of it drives the ONE shared player.
const REPEAT_LABEL = { off: "Repeat off", all: "Repeat all", one: "Repeat this passage" } as const;

export default function PlaylistControls({ st }: { st: ListenState }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const session = usePlaylistSession();
  const [queueOpen, setQueueOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const byKey = new Map(session.entries.map((e) => [e.key, e]));
  const playingKey = st.content?.sections[st.section]?.id ?? null;
  const sectionIndex = (key: string) => st.content?.sections.findIndex((x) => x.id === key) ?? -1;
  const order = session.order.filter((k) => byKey.has(k));

  return (
    <View style={{ gap: 10 }}>
      <View style={s.row}>
        <Pressable style={[s.toggle, session.shuffle && s.on]} onPress={() => setShuffle(!session.shuffle)} disabled={session.busy}
          accessibilityRole="switch" accessibilityState={{ checked: session.shuffle, disabled: session.busy }} accessibilityLabel="Shuffle">
          <Ionicons name="shuffle" size={18} color={session.shuffle ? "#fff" : c.textMid} />
          <Text style={[s.toggleText, session.shuffle && { color: "#fff" }]}>Shuffle</Text>
        </Pressable>
        <Pressable style={[s.toggle, st.repeat !== "off" && s.on]} onPress={cycleRepeat} accessibilityRole="button"
          accessibilityLabel={`${REPEAT_LABEL[st.repeat]}. Tap to change.`}>
          <Ionicons name={st.repeat === "one" ? "repeat" : "repeat-outline"} size={18} color={st.repeat !== "off" ? "#fff" : c.textMid} />
          <Text style={[s.toggleText, st.repeat !== "off" && { color: "#fff" }]}>{st.repeat === "one" ? "Repeat 1" : st.repeat === "all" ? "Repeat all" : "Repeat"}</Text>
        </Pressable>
        <Pressable style={[s.toggle, queueOpen && s.on]} onPress={() => setQueueOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: queueOpen }}
          accessibilityLabel={`Queue, ${order.length} passages`}>
          <Ionicons name="list" size={18} color={queueOpen ? "#fff" : c.textMid} />
          <Text style={[s.toggleText, queueOpen && { color: "#fff" }]}>Queue · {order.length}</Text>
        </Pressable>
      </View>
      <Text style={s.hint}>{session.shuffle ? "Shuffled for this listening only — your playlist's order stays as it is. " : ""}{REPEAT_LABEL[st.repeat]}.</Text>

      {session.unavailable.length ? (
        <View style={s.warn} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={18} color={c.amber} />
          <Text style={[s.hint, { flex: 1, marginTop: 0 }]}>
            {session.unavailable.length === 1 ? "1 passage couldn't be loaded" : `${session.unavailable.length} passages couldn't be loaded`}: {session.unavailable.map((e) => e.reference).join(", ")}. They're left out for now.
          </Text>
          <AppButton label="Try again" size="sm" variant="tertiary" onPress={() => retryUnavailable()} loading={session.busy} />
        </View>
      ) : null}

      {queueOpen ? (
        <View style={s.queue} accessibilityLabel="Listening queue">
          {order.map((k, i) => {
            const e = byKey.get(k)!;
            const here = k === playingKey;
            const missing = session.unavailable.some((u) => u.key === k);
            return (
              <View key={k} style={[s.qRow, here && { backgroundColor: `${c.accentGreen}1A` }]}>
                <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }} disabled={missing}
                  onPress={() => { const n = sectionIndex(k); if (n >= 0) listen.seekPart(st.content!.sections[n].parts[0].key); }}
                  accessibilityRole="button" accessibilityLabel={`${here ? "Now playing: " : "Play "}${e.reference}${missing ? ", couldn't be loaded" : ""}`}>
                  <Text style={s.qNum}>{here ? "▶" : i + 1}</Text>
                  <Text style={[s.qRef, missing && { color: c.textMuted, textDecorationLine: "line-through" }]} numberOfLines={1}>{e.reference} <Text style={s.qTrans}>{e.ref.translationCode}</Text></Text>
                </Pressable>
                {!here ? <IconButton icon="arrow-redo-outline" size="sm" accessibilityLabel={`Play ${e.reference} next`} onPress={() => changeQueue({ op: "playNext", id: k, after: playingKey })} /> : null}
                <IconButton icon="chevron-up" size="sm" accessibilityLabel={`Move ${e.reference} up`} disabled={i === 0} onPress={() => changeQueue({ op: "move", id: k, to: i - 1 })} />
                <IconButton icon="close" size="sm" accessibilityLabel={`Remove ${e.reference} from the queue`} onPress={() => changeQueue({ op: "remove", id: k })} color={c.textMuted} />
              </View>
            );
          })}
          <Text style={s.hint}>Queue changes are for this listening only{session.meta?.id ? " — the saved playlist isn't changed" : ""}.</Text>
          {naming !== null ? (
            <View style={{ gap: 8 }}>
              <TextInput style={s.input} value={naming} onChangeText={setNaming} autoFocus maxLength={120} placeholder="Name the new playlist" placeholderTextColor={c.textMuted} accessibilityLabel="Name of the new playlist" />
              <View style={s.row}>
                <AppButton label="Save" size="sm" disabled={!naming.trim()} onPress={async () => {
                  try { await saveQueueAsPlaylist(naming.trim()); setNotice(`Saved as “${naming.trim()}”.`); setNaming(null); }
                  catch (e: any) { setNotice(e?.message ?? "Couldn't save it."); }
                }} />
                <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => setNaming(null)} />
              </View>
            </View>
          ) : (
            <View style={s.row}>
              <AppButton label="Save queue as playlist" icon="add" size="sm" variant="secondary" onPress={() => setNaming(session.meta?.title ? `${session.meta.title} (my order)` : "My playlist")} />
              <AppButton label="Clear queue" icon="trash-outline" size="sm" variant="tertiary" onPress={() => changeQueue({ op: "clear", keep: playingKey })} />
            </View>
          )}
          {notice ? <Text style={s.hint} accessibilityLiveRegion="polite">{notice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    toggle: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    on: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    toggleText: { fontSize: 13.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    hint: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    warn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: `${c.amber}1F`, flexWrap: "wrap" },
    queue: { gap: 2, padding: 8, borderRadius: 14, backgroundColor: c.card },
    qRow: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, paddingLeft: 8 },
    qNum: { width: 22, fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_700Bold", textAlign: "center" },
    qRef: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    qTrans: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 15 },
  });
}
