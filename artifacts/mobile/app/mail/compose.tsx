import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import PeoplePicker from "@/components/messages/PeoplePicker";
import { forwardMail, listDrafts, officialScopes, saveDraft, sendMail, type MailPerson, type OfficialScope } from "@/lib/mailApi";
import { useMessagePlaceholder } from "@/lib/messagePrivacy";

// Write P2P Mail: recipients, subject and letter — a formal correspondence composer, not a chat box.
// "Send as" (official correspondence) appears only for people the server says are authorised, and
// only for their own organisation (P2P Global administration, their Church, their Family).
// Params: to/toName (from a chat), draft (reopen a draft), forwardThread/forwardMessage/forwardSubject.
export default function ComposeMail() {
  const privacyPlaceholder = useMessagePlaceholder(); // privacy reminder in the empty composer (lib/messagePrivacy)
  const p = useLocalSearchParams<{ to?: string; toName?: string; draft?: string; forwardThread?: string; forwardMessage?: string; forwardSubject?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const forwarding = !!(p.forwardThread && p.forwardMessage);
  const [to, setTo] = useState<MailPerson[]>(p.to ? [{ id: String(p.to), name: String(p.toName ?? "Participant") }] : []);
  const [subject, setSubject] = useState(forwarding ? `Fwd: ${String(p.forwardSubject ?? "").replace(/^fwd:\s*/i, "")}` : "");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | null>(p.draft ? String(p.draft) : null);
  const [scopes, setScopes] = useState<OfficialScope[]>([]);
  const [asScope, setAsScope] = useState<OfficialScope | null>(null);
  const [toAll, setToAll] = useState(false);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { if (!forwarding) officialScopes().then((r) => setScopes(r.scopes)).catch(() => setScopes([])); }, [forwarding]);
  useEffect(() => {
    if (!p.draft) return;
    listDrafts().then((r) => {
      const d = r.drafts.find((x) => x.id === p.draft);
      if (!d) return;
      setTo(d.to); setSubject(d.subject); setBody(d.body);
    }).catch(() => {});
  }, [p.draft]);

  const everyone = !!asScope && asScope.scope !== "p2p" && toAll;
  const canSend = !!subject.trim() && !!body.trim() && (everyone || to.length > 0) || (forwarding && to.length > 0);
  const send = async () => {
    setError(null); setBusy("send");
    try {
      if (forwarding) {
        const r = await forwardMail(String(p.forwardThread), String(p.forwardMessage), to.map((x) => x.id), body.trim() || undefined);
        router.replace(`/mail/${r.threadId}` as any);
        return;
      }
      const r = await sendMail({ to: to.map((x) => x.id), subject: subject.trim(), body: body.trim(), draftId,
        official: asScope ? { scope: asScope.scope, scopeId: asScope.scopeId, toAll: everyone } : null });
      router.replace(`/mail/${r.threadId}` as any);
    } catch (e: any) { setError(e?.message ?? "Your letter wasn't sent."); }
    finally { setBusy(null); }
  };
  const keep = async () => {
    setError(null); setBusy("draft");
    try {
      const r = await saveDraft({ id: draftId, to: to.map((x) => x.id), subject, body, official: asScope ? { scope: asScope.scope, scopeId: asScope.scopeId } : null });
      setDraftId(r.id); setNote("Draft saved.");
    } catch (e: any) { setError(e?.message ?? "The draft wasn't saved."); }
    finally { setBusy(null); }
  };

  return (
    <KeyboardAvoidingView style={[s.screen, { paddingTop: insets.top + 4 }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <IconButton icon="close" accessibilityLabel="Close" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title}>{forwarding ? "Forward P2P Mail" : "New P2P Mail"}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        {scopes.length ? (
          <View style={{ gap: 8 }}>
            <Text style={s.label}>Send as</Text>
            <View style={s.scopeRow}>
              <TouchableOpacity style={[s.scope, !asScope && s.scopeOn]} onPress={() => { setAsScope(null); setToAll(false); }} accessibilityRole="radio" accessibilityState={{ selected: !asScope }}>
                <Ionicons name="person-outline" size={14} color={!asScope ? "#fff" : c.textMid} /><Text style={[s.scopeText, !asScope && s.scopeTextOn]}>Myself</Text>
              </TouchableOpacity>
              {scopes.map((sc) => {
                const on = asScope?.scope === sc.scope && asScope?.scopeId === sc.scopeId;
                return (
                  <TouchableOpacity key={`${sc.scope}:${sc.scopeId}`} style={[s.scope, on && s.scopeOn]} onPress={() => setAsScope(sc)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Ionicons name="shield-checkmark-outline" size={14} color={on ? "#fff" : c.textMid} /><Text style={[s.scopeText, on && s.scopeTextOn]} numberOfLines={1}>{sc.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {asScope ? <Text style={s.hint}>Official correspondence from {asScope.label}{asScope.scope === "p2p" ? "." : " — only to its own members."}</Text> : null}
            {asScope && asScope.scope !== "p2p" ? (
              <TouchableOpacity style={s.toAll} onPress={() => setToAll((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: toAll }}>
                <Ionicons name={toAll ? "checkbox" : "square-outline"} size={20} color={c.accentGreen} />
                <Text style={s.toAllText}>Send to all {asScope.memberCount ?? ""} members of {asScope.label}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {!everyone ? (
          <View style={{ gap: 8 }}>
            <Text style={s.label}>To</Text>
            <PeoplePicker value={to} onChange={setTo} />
          </View>
        ) : null}
        {!forwarding ? (
          <View style={{ gap: 8 }}>
            <Text style={s.label}>Subject</Text>
            <TextInput value={subject} onChangeText={setSubject} placeholder="What is this letter about?" placeholderTextColor={c.textMuted} style={s.input} maxLength={200} accessibilityLabel="Subject" />
          </View>
        ) : <Text style={s.hint}>The original letter — its sender, date and text — is included below your note.</Text>}
        <View style={{ gap: 8 }}>
          <Text style={s.label}>{forwarding ? "Your note (optional)" : "Letter"}</Text>
          <TextInput value={body} onChangeText={setBody} multiline placeholder={privacyPlaceholder} placeholderTextColor={c.textMuted} style={[s.input, s.body]} accessibilityLabel={forwarding ? "Your note" : "Letter"} />
        </View>
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {note ? <Text style={s.hint} accessibilityLiveRegion="polite">{note}</Text> : null}
        <Text style={s.hint}>P2P Mail stays inside P2P Global — it isn't e-mail and isn't part of your chats.</Text>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 10 }]}>
        {!forwarding ? <AppButton label="Save draft" variant="secondary" onPress={keep} loading={busy === "draft"} disabled={!!busy} style={{ flex: 1 }} /> : null}
        <AppButton label={forwarding ? "Forward" : "Send"} icon="send" onPress={send} loading={busy === "send"} disabled={!canSend || !!busy} style={{ flex: 1 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    label: { fontSize: 12, letterSpacing: 0.5, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    input: { minHeight: 46, fontSize: 15.5, color: c.textDark, fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.card },
    body: { minHeight: 240, textAlignVertical: "top", lineHeight: 23 },
    scopeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    scope: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, maxWidth: 260, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    scopeOn: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    scopeText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
    scopeTextOn: { color: "#fff" },
    toAll: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
    toAllText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    hint: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium" },
    footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderBeige, backgroundColor: c.card },
  });
}
