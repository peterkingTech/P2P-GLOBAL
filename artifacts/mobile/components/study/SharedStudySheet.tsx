import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { Avatar } from "@/components/Avatar";
import {
  getStudyDestinations, startSharedStudy, DESTINATION_LABELS, RELATIONSHIP_LABELS,
  type StudyContentType, type StudyPerson, type LedGroup,
} from "@/lib/studyTogetherApi";
import { IconButton } from "@/components/ui";

// Study Together (shared, at your own pace): choose WHO — a peer (Peer
// Guide, disciples, groupmates and P2P connections are one list, so the same
// person never appears twice under two labels) or a Family Circle / Church /
// Circle / Group you lead — then send. The server decides who is eligible
// (connections, blocks, children, leadership); this sheet only shows its answer.
// Nothing about the sender's progress, answers or reflections is shared.

interface Props {
  visible: boolean;
  onClose: () => void;
  content: { type: StudyContentType; id: string; title: string };
  onStarted: (studyId: string) => void;
}
type Step = "where" | "people" | "group";

const GROUP_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { family: "home-outline", church: "business-outline", circle: "people-circle-outline", group: "people-outline" };

export default function SharedStudySheet({ visible, onClose, content, onStarted }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<StudyPerson[]>([]);
  const [groups, setGroups] = useState<LedGroup[]>([]);
  const [max, setMax] = useState(5);
  const [step, setStep] = useState<Step>("where");
  const [picked, setPicked] = useState<string[]>([]);
  const [group, setGroup] = useState<LedGroup | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep("where"); setPicked([]); setGroup(null); setNote(""); setError(null); setExistingId(null);
    let live = true;
    setLoading(true);
    getStudyDestinations()
      .then((d) => { if (!live) return; setPeople(d.people); setGroups(d.groups); setMax(d.maxPeople); })
      .catch((e) => live && setError(e?.message ?? "Couldn't load who you can study with."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [visible]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));

  async function send() {
    if (busy) return;
    setBusy(true); setError(null); setExistingId(null);
    try {
      const r = await startSharedStudy(step === "group" && group
        ? { contentType: content.type, contentId: content.id, destination: group.type, groupId: group.id, prompt: note.trim() || undefined }
        : { contentType: content.type, contentId: content.id, destination: "peer", userIds: picked, prompt: note.trim() || undefined });
      onStarted(r.id);
    } catch (e: any) {
      setError(e?.message ?? "That didn't send. Please try again.");
      if (e?.studyId) setExistingId(e.studyId);
    } finally { setBusy(false); }
  }

  const canSend = step === "people" ? picked.length > 0 : step === "group" ? !!group : false;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity accessibilityRole="button" style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close Study Together">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            {step !== "where" ? (
              <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => { setStep("where"); setError(null); }} color={c.textDark} />
            ) : null}
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {step === "people" ? "Choose who to invite" : step === "group" ? "Start a group study" : "Study Together"}
            </Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={c.textDark} />
          </View>
          <Text style={styles.sub} numberOfLines={2}>"{content.title}" — everyone reads at their own pace and keeps their own progress and private reflections. Only what you choose to post is shared.</Text>
          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.error}>{error}</Text>
              {existingId ? <TouchableOpacity onPress={() => onStarted(existingId)} accessibilityRole="button"><Text style={styles.link}>Open that study</Text></TouchableOpacity> : null}
            </View>
          ) : null}

          {loading ? <ActivityIndicator style={{ margin: 24 }} color={c.accentGreen} /> : (
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              {step === "where" ? (
                <>
                  <TouchableOpacity style={styles.row} onPress={() => setStep("people")} disabled={!people.length} accessibilityRole="button"
                    accessibilityLabel={`${DESTINATION_LABELS.peer}${people.length ? "" : " — no one to invite yet"}`}>
                    <Ionicons name="person-add-outline" size={24} color={people.length ? c.accentGreen : c.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{DESTINATION_LABELS.peer}</Text>
                      <Text style={styles.kind}>{people.length ? "Your Peer Guide, disciples, groupmates and P2P connections" : "Connect with someone on P2P first — then you can invite them here."}</Text>
                    </View>
                    {people.length ? <Ionicons name="chevron-forward" size={18} color={c.textMuted} /> : null}
                  </TouchableOpacity>
                  {groups.length ? <Text style={styles.group}>Groups you lead</Text> : null}
                  {groups.map((g) => (
                    <TouchableOpacity key={`${g.type}:${g.id}`} style={styles.row} onPress={() => { setGroup(g); setStep("group"); }} accessibilityRole="button" accessibilityLabel={`${DESTINATION_LABELS[g.type]}: ${g.name}`}>
                      <Ionicons name={GROUP_ICONS[g.type] ?? "people-outline"} size={24} color={c.accentGreen} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
                        <Text style={styles.kind}>{DESTINATION_LABELS[g.type]}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
                    </TouchableOpacity>
                  ))}
                  {!groups.length ? <Text style={[styles.sub, { paddingTop: 10 }]}>Family Circle, Church, Circle and Group studies are started by their leaders. When a leader starts one, it appears in your Study Together list.</Text> : null}
                </>
              ) : step === "people" ? (
                <>
                  <Text style={styles.sub}>Choose up to {max}. They'll get an invitation they can accept or decline.</Text>
                  {people.map((p) => {
                    const on = picked.includes(p.id);
                    return (
                      <TouchableOpacity key={p.id} style={styles.row} onPress={() => toggle(p.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${p.name}, ${RELATIONSHIP_LABELS[p.relationship]}`}>
                        <Avatar photoUrl={p.photoUrl} name={p.name} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.kind}>{RELATIONSHIP_LABELS[p.relationship]}</Text>
                        </View>
                        <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? c.accentGreen : c.textMuted} />
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                <Text style={styles.sub}>Everyone in {group?.name} will be able to open this study and will get a notification. You can choose the chapter, add discussion questions and conclude the study later.</Text>
              )}
              {step !== "where" ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 8 }}>
                  <Text style={styles.label}>A note or first question (optional)</Text>
                  <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="e.g. Let's read chapter 1 this week" placeholderTextColor={c.textMuted} multiline maxLength={1000} accessibilityLabel="A note or first question" />
                  <TouchableOpacity style={[styles.send, (!canSend || busy) && { opacity: 0.5 }]} onPress={send} disabled={!canSend || busy} accessibilityRole="button"
                    accessibilityLabel={step === "group" ? "Start the group study" : "Send invitation"}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>{step === "group" ? "Start group study" : picked.length > 1 ? `Send ${picked.length} invitations` : "Send invitation"}</Text>}
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "85%", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 16, width: "100%", maxWidth: 640, alignSelf: "center" },
    header: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingTop: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingBottom: 6 },
    errorBox: { paddingHorizontal: 16, paddingBottom: 6, gap: 4 },
    error: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium" },
    link: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", paddingVertical: 6 },
    group: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 56 },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    kind: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    label: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 56, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
    send: { minHeight: 48, borderRadius: 12, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    sendText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  });
}
