import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import CustomLessonEditor from "@/components/study/CustomLessonEditor";
import { passageLabel, readPassages, statusLabel, type CustomLesson, type LessonApi, type LessonInput, type LessonStatus } from "@/lib/customLessonModel";
import { AppButton, IconButton } from "@/components/ui";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
function confirm(title: string, message: string, label: string, onConfirm: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onConfirm(); return; }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: label, style: "destructive", onPress: onConfirm }]);
}

// The LESSONS section of a custom study (Family or Church — the screen passes
// its own API adapter). Leaders: add / edit / preview / publish / unpublish /
// archive / restore; delete only for a draft that was never published (the
// server enforces all of this too). Members only ever receive published
// lessons from the server, so they just see the list.
interface Props {
  lessons: CustomLesson[];
  onLessonsChange: (next: CustomLesson[]) => void;
  canManage: boolean;
  api: LessonApi;
  onOpen: (lesson: CustomLesson) => void; // existing lesson screen (also the leader's preview)
}

export default function CustomLessonSection({ lessons, onLessonsChange, canManage, api, onOpen }: Props) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const [editing, setEditing] = useState<{ lesson: CustomLesson | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const replace = (l: CustomLesson) => onLessonsChange(lessons.map((x) => (x.id === l.id ? l : x)));

  async function handleSave(input: LessonInput, publish: boolean) {
    const target = editing?.lesson ?? null;
    if (target) {
      let updated = await api.update(target.id, input);
      if (publish && updated.status === "draft") updated = await api.setStatus(target.id, "published");
      replace(updated);
    } else {
      const created = await api.add({ ...input, orderIndex: lessons.length, ...(publish ? { status: "published" as const } : {}) });
      onLessonsChange([...lessons, created]);
    }
    setEditing(null);
  }

  async function changeStatus(lesson: CustomLesson, status: LessonStatus) {
    setBusyId(lesson.id);
    try { replace(await api.setStatus(lesson.id, status)); }
    catch (e: any) { notify("Couldn't update the lesson", e?.message ?? "Please try again."); }
    finally { setBusyId(null); }
  }

  function remove(lesson: CustomLesson) {
    confirm("Delete this draft?", lesson.title, "Delete", async () => {
      setBusyId(lesson.id);
      try { await api.remove(lesson.id); onLessonsChange(lessons.filter((l) => l.id !== lesson.id)); }
      catch (e: any) { notify("Couldn't delete", e?.message ?? "Please try again."); }
      finally { setBusyId(null); }
    });
  }

  function openActions(lesson: CustomLesson) {
    const status = lesson.status ?? "published";
    const neverPublished = status === "draft" && !lesson.publishedAt;
    const actions: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [
      { text: "Edit", onPress: () => setEditing({ lesson }) },
      { text: status === "published" ? "Open" : "Preview", onPress: () => onOpen(lesson) },
    ];
    if (status === "draft") actions.push({ text: "Publish", onPress: () => changeStatus(lesson, "published") });
    if (status === "published") actions.push({ text: "Unpublish (back to draft)", onPress: () => changeStatus(lesson, "draft") });
    if (status !== "archived") actions.push({ text: "Archive", onPress: () => confirm("Archive this lesson?", "Members won't see it. Anything already written is kept.", "Archive", () => changeStatus(lesson, "archived")) });
    if (status === "archived") actions.push({ text: "Restore as draft", onPress: () => changeStatus(lesson, "draft") });
    if (neverPublished) actions.push({ text: "Delete draft", style: "destructive", onPress: () => remove(lesson) });
    if (Platform.OS === "web") {
      const choice = window.prompt(`${lesson.title}\n\n${actions.map((a, i) => `${i + 1}. ${a.text}`).join("\n")}\n\nType a number:`);
      const picked = actions[Number(choice) - 1];
      picked?.onPress?.();
      return;
    }
    Alert.alert(lesson.title, undefined, [...actions, { text: "Cancel", style: "cancel" }]);
  }

  return (
    <View>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>LESSONS</Text>
        {canManage && (
          <AppButton label="Add lesson" onPress={() => setEditing({ lesson: null })} size="sm" icon="add" />
        )}
      </View>
      {lessons.length === 0 ? (
        <Text style={styles.empty}>{canManage ? "No lessons yet. Add the first one." : "No lessons yet."}</Text>
      ) : lessons.map((lesson, i) => {
        const main = readPassages(lesson.scriptureReferences)[0];
        const status = lesson.status ?? "published";
        return (
          <TouchableOpacity key={lesson.id} style={[styles.card, status === "archived" && { opacity: 0.6 }]} onPress={() => onOpen(lesson)}
            accessibilityRole="button" accessibilityLabel={`${lesson.title}${canManage ? `, ${statusLabel(status)}` : ""}`}>
            <Text style={styles.number}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{lesson.title}</Text>
              {main ? <Text style={styles.meta} numberOfLines={1}>{passageLabel(main)}</Text> : null}
              {!!lesson.tags?.length && <Text style={styles.meta} numberOfLines={1}>{lesson.tags.map((t) => `#${t}`).join("  ")}</Text>}
            </View>
            {canManage && (
              <View style={[styles.badge, status === "published" ? styles.badgeOn : status === "archived" ? styles.badgeOff : null]}>
                <Text style={[styles.badgeText, status === "published" && { color: "#fff" }]}>{statusLabel(status)}</Text>
              </View>
            )}
            {canManage && (
              busyId === lesson.id ? <ActivityIndicator size="small" color={c.accentGreen} style={styles.more} /> : (
                <IconButton icon="ellipsis-horizontal" accessibilityLabel={`Actions for ${lesson.title}`} onPress={() => openActions(lesson)} color={c.textMuted} />
              )
            )}
          </TouchableOpacity>
        );
      })}
      <CustomLessonEditor visible={!!editing} lesson={editing?.lesson ?? null} onCancel={() => setEditing(null)} onSave={handleSave} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    sectionLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    empty: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, paddingLeft: 14, paddingVertical: 10, marginBottom: 8, minHeight: 56 },
    number: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold", width: 20 },
    title: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: c.borderBeige },
    badgeOn: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    badgeOff: { borderStyle: "dashed" },
    badgeText: { fontSize: 11, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  });
}
