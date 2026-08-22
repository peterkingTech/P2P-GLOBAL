import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { lookupVerseForAdmin } from "@/lib/bibleClient";
import type { useStudySession } from "@/hooks/useStudySession";

// Scripture supports the learning (spec: "a supporting tool inside Study
// Together"), lesson content stays primary. Reuses the exact same lookup
// call/video.tsx's ScriptureModal already uses; "Share with Group" broadcasts
// it so both participants see the same passage.
export function StudyScriptureTab({ session }: { session: ReturnType<typeof useStudySession> }) {
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<{ reference: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLookup() {
    if (!ref.trim()) return;
    setLoading(true); setError(""); setResult(null);
    const data = await lookupVerseForAdmin(ref.trim());
    setLoading(false);
    if (!data) setError("Scripture couldn't be loaded. Try e.g. \"John 3:16\".");
    else setResult({ reference: ref.trim(), text: data.text });
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={ref}
          onChangeText={setRef}
          placeholder="e.g. John 3:16"
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoCapitalize="words"
          onSubmitEditing={handleLookup}
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleLookup} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultText}>"{result.text}"</Text>
          <Text style={styles.resultRef}>— {result.reference}</Text>
          <TouchableOpacity style={styles.shareBtn} onPress={() => session.shareScripture(result.reference, result.text)}>
            <Ionicons name="people" size={14} color="#fff" />
            <Text style={styles.shareBtnText}>Share with Group</Text>
          </TouchableOpacity>
        </View>
      )}

      {!result && session.sharedScripture && (
        <View style={styles.resultCard}>
          <Text style={styles.sharedLabel}>Shared with the group</Text>
          <Text style={styles.resultText}>"{session.sharedScripture.verse}"</Text>
          <Text style={styles.resultRef}>— {session.sharedScripture.reference}</Text>
        </View>
      )}

      {session.scripturesDiscussed.length > 0 && (
        <View>
          <Text style={styles.historyTitle}>Scriptures Discussed</Text>
          {session.scripturesDiscussed.map((s, i) => (
            <Text key={i} style={styles.historyItem}>{s.reference}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1, backgroundColor: "#1A241E", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular",
  },
  searchBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  errorText: { color: "#DC2626", fontSize: 12, fontFamily: "Inter_400Regular" },
  resultCard: { backgroundColor: "#1A241E", borderRadius: 14, padding: 16, gap: 10 },
  sharedLabel: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  resultText: { color: "#fff", fontSize: 15, fontStyle: "italic", fontFamily: "Inter_400Regular", lineHeight: 22 },
  resultRef: { color: "#1D9E75", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 10, alignSelf: "flex-start", paddingHorizontal: 14,
  },
  shareBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  historyTitle: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  historyItem: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 4 },
});