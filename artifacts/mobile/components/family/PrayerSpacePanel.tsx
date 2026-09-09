import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Switch } from "react-native";
import type { FamilyPrayerRequest, WorshipScripture, WorshipSession } from "@/lib/familyApi";
import { formatScriptureReference } from "@/lib/familyApi";

interface Props {
  session: WorshipSession;
  prayers: FamilyPrayerRequest[];
  isGuide: boolean;
  myUserId: string | undefined;
  praying: boolean;
  prayingCount: number;
  onTogglePraying: () => void;
  onAdd: (content: string, visibility: "private" | "family", scriptureReference: WorshipScripture | null) => void;
  onMarkPrayed: (id: string) => void;
  onMarkAnswered: (id: string) => void;
  onSetFocus: (requestId: string | null) => void;
}

// P2P's own Prayer panel — a focus sits above the request list, not a
// chat-shaped feed. "People growing together" over "people chatting
// online": the room can gather around ONE request at a time.
export default function PrayerSpacePanel({
  session, prayers, isGuide, myUserId, praying, prayingCount, onTogglePraying,
  onAdd, onMarkPrayed, onMarkAnswered, onSetFocus,
}: Props) {
  const [draft, setDraft] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [attachCurrentPassage, setAttachCurrentPassage] = useState(false);

  const focused = prayers.find((p) => p.id === session.currentFocusPrayerRequestId);
  const others = prayers.filter((p) => p.status !== "answered" && p.id !== session.currentFocusPrayerRequestId);

  function submit() {
    if (!draft.trim()) return;
    onAdd(draft.trim(), isPrivate ? "private" : "family", attachCurrentPassage && session.currentScripture ? session.currentScripture : null);
    setDraft("");
    setAttachCurrentPassage(false);
  }

  function renderRequest(p: FamilyPrayerRequest, isFocused: boolean) {
    return (
      <View key={p.id} style={[styles.requestCard, isFocused && styles.requestCardFocused]}>
        {isFocused && <Text style={styles.focusLabel}>🎯 GROUP FOCUS</Text>}
        <Text style={styles.requestText}>🙏 {p.content}</Text>
        {p.scripture_reference && <Text style={styles.requestScripture}>{formatScriptureReference(p.scripture_reference)}</Text>}
        <View style={styles.requestActions}>
          {p.status === "open" && <TouchableOpacity onPress={() => onMarkPrayed(p.id)}><Text style={styles.requestAction}>Prayed</Text></TouchableOpacity>}
          {p.user_id === myUserId && p.status !== "answered" && (
            <TouchableOpacity onPress={() => onMarkAnswered(p.id)}><Text style={styles.requestAction}>Answered</Text></TouchableOpacity>
          )}
          {isGuide && (
            <TouchableOpacity onPress={() => onSetFocus(isFocused ? null : p.id)}>
              <Text style={styles.requestAction}>{isFocused ? "Clear focus" : "Focus"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View>
      {focused && renderRequest(focused, true)}

      <TouchableOpacity style={styles.prayingBtn} onPress={onTogglePraying}>
        <Text style={styles.prayingBtnText}>{praying ? "🙏 You're praying" : "🙏 I'm praying"}</Text>
        {prayingCount > 0 && <Text style={styles.prayingCount}>{prayingCount} praying now</Text>}
      </TouchableOpacity>

      {others.map((p) => renderRequest(p, false))}

      <View style={styles.addBox}>
        <TextInput
          style={styles.addInput}
          placeholder="Share a prayer request…"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <View style={styles.addRow}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Private</Text>
            <Switch value={isPrivate} onValueChange={setIsPrivate} />
          </View>
          {session.currentScripture && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Attach passage</Text>
              <Switch value={attachCurrentPassage} onValueChange={setAttachCurrentPassage} />
            </View>
          )}
          <TouchableOpacity style={styles.shareBtn} onPress={submit}><Text style={styles.shareBtnText}>Share</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  requestCard: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  requestCardFocused: {
    backgroundColor: "rgba(184,134,11,0.12)", borderRadius: 10, borderBottomWidth: 0,
    borderWidth: 1, borderColor: "rgba(184,134,11,0.4)", padding: 12, marginBottom: 10,
  },
  focusLabel: { color: "#B8860B", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 4 },
  requestText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  requestScripture: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 3 },
  requestActions: { flexDirection: "row", gap: 16, marginTop: 6 },
  requestAction: { color: "#1D9E75", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  prayingBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(29,158,117,0.15)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  prayingBtnText: { color: "#fff", fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  prayingCount: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_400Regular" },

  addBox: { marginTop: 8, gap: 8 },
  addInput: {
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 40,
  },
  addRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular" },
  shareBtn: { marginLeft: "auto", backgroundColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  shareBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
