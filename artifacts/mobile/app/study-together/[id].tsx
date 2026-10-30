import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { supabase } from "@/contexts/AuthContext";
import { Avatar } from "@/components/Avatar";
import {
  getSharedStudy, respondToStudy, leaveStudy, concludeStudy, reopenStudy, setStudyPosition, addStudyPrompt, removeStudyPrompt,
  postStudyResponse, removeStudyResponse, cancelStudyInvite, markStudyOpened, contentRoute, responsesFor, invitationNote,
  DESTINATION_LABELS, type SharedStudy, type StudyResponse,
} from "@/lib/studyTogetherApi";
import { AppButton, IconButton } from "@/components/ui";
import { confirmAction } from "@/lib/alerts";
import { timeAgo as ago } from "@/lib/timeFormat";

// One shared study: what we're studying, where the group is (the leader's
// shared chapter), discussion questions (the chapter's own reflection
// questions + the leader's), and the responses people CHOSE to post.
// Opening the story/lesson from here uses each reader's OWN progress —
// studying together never marks anyone's chapter or lesson complete, and
// private answers, journal entries and reflections are never shown here.
// Chat and calls are the existing P2P ones (shortcuts below).


export default function SharedStudyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [study, setStudy] = useState<SharedStudy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newPrompt, setNewPrompt] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const st = await getSharedStudy(id);
      setStudy(st); setError(null);
      if (st.me.canParticipate) void markStudyOpened(id);
    } catch (e: any) { setError(e?.status === 404 ? "This study isn't available. It may have ended, or the invitation was withdrawn." : e?.message ?? "Couldn't load this study."); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key); setNotice(null);
    try { await fn(); if (done) setNotice(done); await load(); }
    catch (e: any) { setNotice(e?.message ?? "That didn't work. Please try again."); }
    finally { setBusy(null); }
  }

  if (error) return (
    <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Study Together" }} />
      <Ionicons name="book-outline" size={32} color={c.textMuted} />
      <Text style={s.body}>{error}</Text>
      <AppButton label="My studies" onPress={() => router.replace("/study-together" as any)} variant="secondary" />
    </View>
  );
  if (!study) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Study Together" }} /><ActivityIndicator color={c.accentGreen} /></View>;

  const st = study;
  const active = st.status === "active";
  const current = st.sections.find((x) => x.id === st.currentSectionId) ?? null;
  const others = st.members.filter((m) => m.userId !== st.host.id || !st.me.isHost);
  const withWhom = st.destination.type === "peer"
    ? `With ${st.members.filter((m) => m.status === "accepted" && !(st.me.isHost && m.userId === st.host.id)).map((m) => m.name).join(", ") || "your invitees"}`
    : `${DESTINATION_LABELS[st.destination.type]} · ${st.destination.name ?? ""}`;
  const groupRoute = st.destination.type === "family" && st.destination.id ? `/family/${st.destination.id}`
    : st.destination.type === "circle" && st.destination.id ? `/circles/${st.destination.id}`
    : st.destination.type === "church" ? "/church" : null;

  async function message(userId: string) {
    const { data, error: e } = await supabase.rpc("p2p_start_direct_conversation", { target_id: userId });
    if (e || !data) return setNotice("Couldn't open that chat.");
    router.push(`/messages/${data}` as any);
  }

  // Called as a function (not <Thread/>): a component defined inside this one
  // would remount on every keystroke and drop the keyboard.
  function thread({ k, label, list, target }: { k: string; label?: string; list: StudyResponse[]; target: { promptId?: string; sectionId?: string | null; questionIndex?: number | null } }) {
    const draft = drafts[k] ?? "";
    return (
      <View style={s.thread}>
        {label ? <Text style={s.question}>{label}</Text> : null}
        {list.map((r) => (
          <View key={r.id} style={s.response}>
            <Text style={s.responseMeta}>{r.mine ? "You" : r.name} · {ago(r.createdAt)}</Text>
            <Text style={s.body}>{r.body}</Text>
            {(r.mine || st.me.isLeader) ? (
              <AppButton label="Remove" onPress={() => confirmAction("Remove this response?", "It will no longer be visible to the group.", () => act(`rm:${r.id}`, () => removeStudyResponse(st.id, r.id)), { confirmLabel: "Remove", destructive: true })} variant="tertiary" size="sm" accessibilityLabel="Remove response" style={{ alignSelf: "flex-start" }} />
            ) : null}
          </View>
        ))}
        {active && st.me.canParticipate ? (
          <View style={s.composer}>
            <TextInput style={s.input} value={draft} onChangeText={(t) => setDrafts((d) => ({ ...d, [k]: t }))} placeholder="Share a response with the group…" placeholderTextColor={c.textMuted} multiline maxLength={2000} accessibilityLabel={`Response${label ? ` to: ${label}` : ""}`} />
            <TouchableOpacity style={[s.sendBtn, (!draft.trim() || busy === k) && { opacity: 0.5 }]} disabled={!draft.trim() || busy === k}
              onPress={() => act(k, async () => { await postStudyResponse(st.id, { body: draft.trim(), ...target }); setDrafts((d) => ({ ...d, [k]: "" })); })}
              accessibilityRole="button" accessibilityLabel="Post response">
              {busy === k ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={16} color="#fff" />}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }

  const sectionPrompts = st.prompts.filter((p) => p.sectionId && p.sectionId === current?.id);
  const generalPrompts = st.prompts.filter((p) => !p.sectionId);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Study Together" }} />
      <Text style={s.kicker}>{st.contentType === "kingdom_story" ? "Kingdom Story" : "Kingdom School lesson"}</Text>
      <Text style={s.title} accessibilityRole="header">{st.title}</Text>
      {st.subtitle ? <Text style={s.body}>{st.subtitle}</Text> : null}
      <Text style={s.meta}>{withWhom} · started by {st.me.isHost ? "you" : st.host.name}</Text>
      {notice ? <Text style={s.notice} accessibilityRole="alert">{notice}</Text> : null}
      {!st.contentAvailable ? <Text style={s.notice}>This {st.contentType === "lesson" ? "lesson" : "story"} isn't available right now.</Text> : null}

      {st.me.invited ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>{st.host.name} invited you to study this together</Text>
          <Text style={s.body}>You'll read at your own pace with your own progress. Your answers and reflections stay private — only responses you choose to post are shared.</Text>
          {invitationNote(st.me) ? <Text style={s.meta}>{invitationNote(st.me)}</Text> : null}
          <View style={s.row}>
            <AppButton label="Accept" onPress={() => act("accept", () => respondToStudy(st.id, "accepted"), "You've joined this study.")} disabled={!!busy} loading={busy === "accept"} />
            <AppButton label="Decline" onPress={() => act("decline", async () => { await respondToStudy(st.id, "declined"); router.replace("/study-together" as any); })} variant="secondary" disabled={!!busy} />
          </View>
        </View>
      ) : null}

      {!active ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>This study has been concluded</Text>
          <Text style={s.body}>You can still read the responses. Your own progress is unchanged.</Text>
          {st.me.isLeader ? <AppButton label="Continue the study" onPress={() => act("reopen", () => reopenStudy(st.id), "The study is open again.")} variant="secondary" /> : null}
        </View>
      ) : null}

      {st.me.canParticipate ? (
        <>
          <View style={s.row}>
            <AppButton label={current ? `Read Chapter ${current.number}` : st.contentType === "lesson" ? "Open the lesson" : "Open the story"} onPress={() => router.push(contentRoute(st, current?.id) as any)} icon="book-outline" disabled={!st.contentAvailable} accessibilityLabel={current ? `Read chapter ${current.number}` : "Open"} />
          </View>
          <Text style={s.meta}>You read with your own progress — studying together doesn't mark anything complete for anyone.</Text>

          {st.sections.length ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>{current ? `The group is on Chapter ${current.number}: ${current.title}` : "No shared chapter set"}</Text>
              {st.me.isLeader && active ? (
                <>
                  <Text style={s.meta}>Choose the chapter everyone discusses:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {st.sections.map((x) => (
                      <TouchableOpacity key={x.id} style={[s.pill, x.id === st.currentSectionId && s.pillOn]} onPress={() => act("pos", () => setStudyPosition(st.id, x.id))} accessibilityRole="button" accessibilityState={{ selected: x.id === st.currentSectionId }} accessibilityLabel={`Chapter ${x.number}: ${x.title}`}>
                        <Text style={[s.pillText, x.id === st.currentSectionId && s.pillTextOn]}>{x.number}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </View>
          ) : null}

          <Text style={s.section} accessibilityRole="header">Discussion</Text>
          <Text style={s.meta}>Responses here are visible to everyone in this study. Your private reflections in the reader are never shared.</Text>
          {current?.questions.map((qn, i) => (
            <View key={`q:${current.id}:${i}`}>{thread({ k: `q:${current.id}:${i}`, label: qn, list: responsesFor(st.responses, { sectionId: current.id, questionIndex: i }), target: { sectionId: current.id, questionIndex: i } })}</View>
          ))}
          {[...sectionPrompts, ...generalPrompts].map((p) => (
            <View key={p.id}>
              {thread({ k: `p:${p.id}`, label: p.body, list: responsesFor(st.responses, { promptId: p.id }), target: { promptId: p.id } })}
              {st.me.isLeader ? <AppButton label="Remove question" onPress={() => confirmAction("Remove this question?", "Its responses are removed too.", () => act(`rp:${p.id}`, () => removeStudyPrompt(st.id, p.id)), { confirmLabel: "Remove", destructive: true })} variant="tertiary" size="sm" style={{ alignSelf: "flex-start" }} /> : null}
            </View>
          ))}
          {thread({ k: "general", label: "General discussion", list: responsesFor(st.responses, {}), target: {} })}

          {st.me.isLeader && active ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Add a discussion question</Text>
              <TextInput style={s.input} value={newPrompt} onChangeText={setNewPrompt} placeholder={current ? `A question about Chapter ${current.number}` : "A question for the group"} placeholderTextColor={c.textMuted} multiline maxLength={1000} accessibilityLabel="New discussion question" />
              <TouchableOpacity style={[s.btn, !newPrompt.trim() && { opacity: 0.5 }]} disabled={!newPrompt.trim() || busy === "prompt"}
                onPress={() => act("prompt", async () => { await addStudyPrompt(st.id, newPrompt.trim(), current?.id ?? null); setNewPrompt(""); })} accessibilityRole="button">
                <Text style={s.btnText}>Add question</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={s.section} accessibilityRole="header">People</Text>
          {st.participation ? (
            <Text style={s.meta}>
              {st.participation.joined} joined{st.participation.groupSize ? ` of ${st.participation.groupSize}` : ""} · {st.participation.openedThisWeek} opened it this week · {st.participation.sharedResponses} shared responses
            </Text>
          ) : null}
          {others.map((m) => (
            <View key={m.userId} style={s.member}>
              <Avatar photoUrl={m.photoUrl} name={m.name} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{m.name}{m.role === "host" ? " · leading" : ""}</Text>
                <Text style={s.meta}>{m.status === "pending" ? "Invited — waiting for a reply" : m.lastOpenedAt ? `Opened ${ago(m.lastOpenedAt)}` : "Joined"}</Text>
              </View>
              {m.status === "pending" && st.me.isHost ? (
                <AppButton label="Cancel" onPress={() => act(`c:${m.userId}`, () => cancelStudyInvite(st.id, m.userId), "Invitation cancelled.")} variant="tertiary" size="sm" accessibilityLabel={`Cancel invitation to ${m.name}`} style={{ alignSelf: "flex-start" }} />
              ) : st.destination.type === "peer" && m.status === "accepted" ? (
                <IconButton icon="chatbubble-ellipses-outline" accessibilityLabel={`Message ${m.name} (calls start from the chat)`} onPress={() => message(m.userId)} color={c.accentGreen} />
              ) : null}
            </View>
          ))}
          {groupRoute ? (
            <AppButton label={`Open ${st.destination.name ?? DESTINATION_LABELS[st.destination.type]} (chat & calls)`} onPress={() => router.push(groupRoute as any)} variant="secondary" />
          ) : null}

          <View style={[s.row, { marginTop: 12 }]}>
            {st.me.isLeader && active ? (
              <AppButton label="Conclude study" onPress={() => confirmAction("Conclude this study?", "People keep their own progress. Responses stay readable, and you can continue the study later.", () => act("conclude", () => concludeStudy(st.id), "Study concluded."), { confirmLabel: "Conclude", destructive: true })} variant="secondary" />
            ) : null}
            {!st.me.isHost ? (
              <AppButton label="Leave study" onPress={() => confirmAction("Leave this study?", "You'll stop seeing it. Your own progress is unchanged.", () => act("leave", async () => { await leaveStudy(st.id); router.replace("/study-together" as any); }), { confirmLabel: "Leave", destructive: true })} variant="destructive" />
            ) : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    content: { padding: 16, gap: 10, paddingBottom: 48, width: "100%", maxWidth: 760, alignSelf: "center" },
    kicker: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 10 },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium", backgroundColor: c.cardBeige, borderRadius: 10, padding: 10 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 8 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
    btn: { flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    btnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    pill: { minWidth: 44, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center", backgroundColor: c.lightCream },
    pillOn: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    pillText: { color: c.textDark, fontFamily: "Inter_700Bold" },
    pillTextOn: { color: "#fff" },
    thread: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 12, gap: 8 },
    question: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    response: { borderLeftWidth: 3, borderLeftColor: c.lightGreen, paddingLeft: 10, gap: 2 },
    responseMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    composer: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
    input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
    sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    member: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
    name: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
