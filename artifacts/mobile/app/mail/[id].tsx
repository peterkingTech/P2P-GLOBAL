import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { archiveThread, getThread, markThreadRead, replyMail, type MailThread } from "@/lib/mailApi";
import { useMessagePlaceholder } from "@/lib/messagePrivacy";

// One P2P Mail correspondence: its letters in order — the original, then replies (and a forward's
// quoted original) — each with sender, recipients and date, like formal correspondence. Reply stays in
// this thread; Forward starts a new one. Opening it marks it (and only it) read.
const fullDate = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function MailThreadScreen() {
  const privacyPlaceholder = useMessagePlaceholder(); // privacy reminder in the empty composer (lib/messagePrivacy)
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [t, setT] = useState<MailThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [writing, setWriting] = useState(false);

  const load = useCallback(async () => {
    try { setT(await getThread(String(id))); setError(null); markThreadRead(String(id)).catch(() => {}); }
    catch (e: any) { setError(e?.message ?? "This mail isn't available."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try { await replyMail(String(id), reply.trim()); setReply(""); setWriting(false); await load(); }
    catch (e: any) { setError(e?.message ?? "Your reply wasn't sent."); }
    finally { setSending(false); }
  };

  const others = t?.participants.filter((p) => !p.isMe) ?? [];
  return (
    <KeyboardAvoidingView style={[s.screen, { paddingTop: insets.top + 4 }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.headerTitle} numberOfLines={1}>P2P Mail</Text>
        {t ? (
          <IconButton icon={t.archived ? "archive" : "archive-outline"} accessibilityLabel={t.archived ? "Move back to inbox" : "Archive"} color={c.textDark}
            onPress={async () => { await archiveThread(t.id, !t.archived); if (!t.archived) router.back(); else void load(); }} />
        ) : null}
      </View>
      {error && !t ? (
        <View style={s.center}><Ionicons name="mail-unread-outline" size={40} color={c.borderBeige} /><Text style={s.muted}>{error}</Text><AppButton label="Back" variant="secondary" onPress={() => router.back()} /></View>
      ) : !t ? (
        <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 14 }}>
            <Text style={s.subject} accessibilityRole="header">{t.subject}</Text>
            {t.isOfficial ? (
              <View style={s.officialBox} accessibilityLabel={`Official correspondence from ${t.officialLabel}`}>
                <Ionicons name="shield-checkmark" size={18} color={c.primaryGreen} />
                <Text style={s.officialText}>Official correspondence · {t.officialLabel}</Text>
              </View>
            ) : null}
            <Text style={s.people}>Between you and {others.map((o) => o.name).join(", ") || "—"}</Text>
            {t.letters.map((l, i) => (
              <View key={l.id} style={[s.letter, l.from.isMe && s.letterMine]}>
                <View style={s.letterHead}>
                  <Text style={s.kind}>{l.kind === "original" ? (i === 0 ? "ORIGINAL" : "LETTER") : l.kind === "reply" ? "REPLY" : "FORWARDED"}</Text>
                  {l.isOfficial ? <Ionicons name="shield-checkmark" size={14} color={c.primaryGreen} accessibilityLabel="Official" /> : null}
                </View>
                <Text style={s.field}><Text style={s.fieldLabel}>From  </Text>{l.from.isMe ? "You" : l.from.name}</Text>
                <Text style={s.field}><Text style={s.fieldLabel}>To  </Text>{t.participants.filter((p) => p.id !== l.from.id).map((p) => (p.isMe ? "You" : p.name)).join(", ")}</Text>
                <Text style={s.field}><Text style={s.fieldLabel}>Date  </Text>{fullDate(l.sentAt)}</Text>
                <View style={s.rule} />
                <Text style={s.body} selectable>{l.body}</Text>
                <View style={s.letterActions}>
                  <AppButton label="Forward" icon="arrow-redo-outline" size="sm" variant="tertiary"
                    onPress={() => router.push({ pathname: "/mail/compose", params: { forwardThread: t.id, forwardMessage: l.id, forwardSubject: t.subject } } as any)} />
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={[s.replyBar, { paddingBottom: insets.bottom + 10 }]}>
            {writing ? (
              <>
                <TextInput value={reply} onChangeText={setReply} multiline autoFocus placeholder={privacyPlaceholder} placeholderTextColor={c.textMuted} style={s.replyInput} accessibilityLabel="Your reply" />
                {error ? <Text style={s.errorText}>{error}</Text> : null}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <AppButton label="Cancel" variant="secondary" onPress={() => { setWriting(false); setReply(""); }} style={{ flex: 1 }} />
                  <AppButton label="Send reply" icon="send" onPress={send} loading={sending} disabled={!reply.trim() || sending} style={{ flex: 1 }} />
                </View>
              </>
            ) : (
              <AppButton label="Reply" icon="arrow-undo-outline" onPress={() => setWriting(true)} />
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    headerTitle: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    subject: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 28 },
    officialBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.primaryGreen, backgroundColor: c.card },
    officialText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    people: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    letter: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 4 },
    letterMine: { borderColor: c.accentGreen },
    letterHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    kind: { fontSize: 10.5, letterSpacing: 0.8, color: c.textMuted, fontFamily: "Inter_700Bold" },
    field: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    fieldLabel: { color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    rule: { height: 1, backgroundColor: c.borderBeige, marginVertical: 10 },
    body: { fontSize: 15.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 24 },
    letterActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6 },
    replyBar: { borderTopWidth: 1, borderTopColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 16, paddingTop: 10, gap: 10 },
    replyInput: { minHeight: 110, maxHeight: 240, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", textAlignVertical: "top", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, backgroundColor: c.lightCream },
    errorText: { fontSize: 12.5, color: "#C0392B", fontFamily: "Inter_500Medium" },
  });
}
