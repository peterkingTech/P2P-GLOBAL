import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import {
  addChapter, updateChapter, deleteChapter, reorderChapters, addKingdomStorySource, deleteKingdomStorySource,
  CHAPTER_ITEMS, type KingdomStory, type KingdomStoryChapter, type ChapterInput,
} from "@/lib/kingdomStoriesApi";

// Chapters of a Kingdom Story (editor). Saves each field when the editor
// leaves it, like the rest of the story editor. A chapter is complete — and
// the story publishable — only with a title, a narrative, 5 Kingdom Lessons
// and 5 Peer Reflection Questions (the server enforces the same rule).
// The four evidence notes keep documented history, testimony, tradition and
// disputed claims apart, so readers can tell what an account rests on.
type Props = {
  story: KingdomStory;
  locked: boolean; // live story: chapters are read-only until it is unpublished
  onChanged: () => Promise<void> | void;
  onError: (title: string, e: unknown) => void;
};

function confirm(title: string, message: string, onYes: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: onYes }]);
}

const EVIDENCE: { key: keyof KingdomStoryChapter["evidence"]; label: string; hint: string }[] = [
  { key: "documented", label: "Documented history", hint: "What contemporary records or scholarship establish" },
  { key: "testimony", label: "Testimony", hint: "First-hand or reported accounts, and whose" },
  { key: "tradition", label: "Tradition", hint: "What is handed down but not independently documented" },
  { key: "disputed", label: "Disputed or uncertain", hint: "Claims historians question, and why" },
];

function ItemsEditor({ label, values, locked, onSave }: { label: string; values: string[]; locked: boolean; onSave: (items: string[]) => void }) {
  const [items, setItems] = useState<string[]>(() => Array.from({ length: CHAPTER_ITEMS }, (_, i) => values[i] ?? ""));
  const filled = items.filter((x) => x.trim()).length;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label} <Text style={[styles.counter, filled === CHAPTER_ITEMS && { color: colors.accentGreen }]}>{filled}/{CHAPTER_ITEMS}</Text></Text>
      {items.map((v, i) => (
        <View key={i} style={styles.itemRow}>
          <Text style={styles.itemNum}>{i + 1}</Text>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={v}
            editable={!locked}
            multiline
            onChangeText={(t) => setItems((cur) => cur.map((x, j) => (j === i ? t : x)))}
            onEndEditing={() => onSave(items)}
            onBlur={() => onSave(items)}
            accessibilityLabel={`${label} ${i + 1}`}
          />
        </View>
      ))}
    </View>
  );
}

function ChapterCard({ story, chapter, index, count, locked, onChanged, onError }: Props & { chapter: KingdomStoryChapter; index: number; count: number }) {
  const [open, setOpen] = useState(false);
  const [srcTitle, setSrcTitle] = useState("");
  const [srcPublisher, setSrcPublisher] = useState("");
  const last = React.useRef<string>("");

  async function save(input: ChapterInput) {
    const key = JSON.stringify(input);
    if (key === last.current) return; // onEndEditing + onBlur fire together
    last.current = key;
    try { await updateChapter(story.id, chapter.id, input); await onChanged(); }
    catch (e) { last.current = ""; onError("Couldn't save chapter", e); }
  }
  async function move(delta: number) {
    const ids = (story.chapters ?? []).map((c) => c.id);
    const j = index + delta;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try { await reorderChapters(story.id, ids); await onChanged(); } catch (e) { onError("Couldn't reorder chapters", e); }
  }
  async function addSource() {
    if (!srcTitle.trim()) return;
    try {
      await addKingdomStorySource(story.id, { title: srcTitle.trim(), publisher: srcPublisher.trim() || undefined, chapterId: chapter.id, displayOrder: chapter.sources.length });
      setSrcTitle(""); setSrcPublisher(""); await onChanged();
    } catch (e) { onError("Couldn't add source", e); }
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHead} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.cardNum}>{chapter.chapterNumber}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{chapter.title || "Untitled chapter"}</Text>
        <View style={[styles.badge, chapter.complete ? styles.badgeOk : styles.badgeTodo]}>
          <Text style={[styles.badgeText, { color: chapter.complete ? colors.primaryGreen : "#92400E" }]}>{chapter.complete ? "Complete" : "Incomplete"}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {open && (
        <View style={{ gap: 4, paddingHorizontal: 12, paddingBottom: 12 }}>
          {!chapter.complete && (
            <Text style={styles.todo}>
              Still needed: {[!chapter.title.trim() && "a title", !chapter.narrative.trim() && "the narrative",
                chapter.lessons.length < CHAPTER_ITEMS && `${CHAPTER_ITEMS - chapter.lessons.length} more Kingdom Lesson${CHAPTER_ITEMS - chapter.lessons.length === 1 ? "" : "s"}`,
                chapter.reflections.length < CHAPTER_ITEMS && `${CHAPTER_ITEMS - chapter.reflections.length} more Reflection Question${CHAPTER_ITEMS - chapter.reflections.length === 1 ? "" : "s"}`]
                .filter(Boolean).join(", ")}.
            </Text>
          )}
          <Text style={styles.fieldLabel}>Chapter title</Text>
          <TextInput style={styles.input} defaultValue={chapter.title} editable={!locked} onEndEditing={(e) => save({ title: e.nativeEvent.text })} />
          <Text style={styles.fieldLabel}>Narrative</Text>
          <TextInput style={[styles.input, styles.multiline]} defaultValue={chapter.narrative} editable={!locked} multiline onEndEditing={(e) => save({ narrative: e.nativeEvent.text })} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Dates</Text>
              <TextInput style={styles.input} defaultValue={chapter.dates ?? ""} editable={!locked} placeholder="e.g. c. AD 155" placeholderTextColor={colors.textMuted} onEndEditing={(e) => save({ dates: e.nativeEvent.text })} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Places</Text>
              <TextInput style={styles.input} defaultValue={chapter.places ?? ""} editable={!locked} onEndEditing={(e) => save({ places: e.nativeEvent.text })} />
            </View>
          </View>
          <Text style={styles.fieldLabel}>People</Text>
          <TextInput style={styles.input} defaultValue={chapter.people ?? ""} editable={!locked} onEndEditing={(e) => save({ people: e.nativeEvent.text })} />
          <Text style={styles.fieldLabel}>Scripture references</Text>
          <TextInput style={styles.input} defaultValue={chapter.scriptureRefs ?? ""} editable={!locked} placeholder="e.g. Acts 2:1–13" placeholderTextColor={colors.textMuted} onEndEditing={(e) => save({ scriptureRefs: e.nativeEvent.text })} />

          <Text style={styles.subHeading}>What this account rests on</Text>
          {EVIDENCE.map((ev) => (
            <View key={ev.key}>
              <Text style={styles.fieldLabel}>{ev.label}</Text>
              <TextInput style={[styles.input, styles.multilineSm]} defaultValue={chapter.evidence[ev.key] ?? ""} editable={!locked} multiline placeholder={ev.hint} placeholderTextColor={colors.textMuted}
                onEndEditing={(e) => save({ evidence: { [ev.key]: e.nativeEvent.text } })} />
            </View>
          ))}

          <ItemsEditor label="Kingdom Lessons" values={chapter.lessons} locked={locked} onSave={(lessons) => save({ lessons })} />
          <ItemsEditor label="Peer Reflection Questions" values={chapter.reflections} locked={locked} onSave={(reflections) => save({ reflections })} />

          <Text style={styles.subHeading}>Chapter sources ({chapter.sources.length})</Text>
          {chapter.sources.map((s) => (
            <View key={s.id} style={styles.sourceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle}>{s.title}</Text>
                {!!s.publisher && <Text style={styles.sourceMeta}>{s.publisher}</Text>}
              </View>
              {!locked && (
                <TouchableOpacity onPress={async () => { try { await deleteKingdomStorySource(story.id, s.id); await onChanged(); } catch (e) { onError("Couldn't remove source", e); } }} accessibilityLabel="Remove source">
                  <Ionicons name="trash-outline" size={14} color="#B91C1C" />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {!locked && (
            <>
              <TextInput style={styles.input} value={srcTitle} onChangeText={setSrcTitle} placeholder="Source title (a real, checkable source)" placeholderTextColor={colors.textMuted} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput style={[styles.input, { flex: 1 }]} value={srcPublisher} onChangeText={setSrcPublisher} placeholder="Publisher (optional)" placeholderTextColor={colors.textMuted} />
                <TouchableOpacity style={styles.smallBtn} onPress={addSource}><Text style={styles.smallBtnText}>Add</Text></TouchableOpacity>
              </View>
            </>
          )}

          {!locked && (
            <View style={styles.cardActions}>
              <TouchableOpacity disabled={index === 0} onPress={() => move(-1)} style={[styles.iconBtn, index === 0 && { opacity: 0.3 }]} accessibilityLabel="Move chapter up">
                <Ionicons name="arrow-up" size={16} color={colors.textMid} />
              </TouchableOpacity>
              <TouchableOpacity disabled={index === count - 1} onPress={() => move(1)} style={[styles.iconBtn, index === count - 1 && { opacity: 0.3 }]} accessibilityLabel="Move chapter down">
                <Ionicons name="arrow-down" size={16} color={colors.textMid} />
              </TouchableOpacity>
              <TouchableOpacity
                style={{ marginLeft: "auto" }}
                onPress={() => confirm("Delete this chapter?", "Its text, lessons, questions and sources are removed. This cannot be undone.", async () => {
                  try { await deleteChapter(story.id, chapter.id); await onChanged(); } catch (e) { onError("Couldn't delete chapter", e); }
                })}
              >
                <Text style={styles.deleteText}>Delete chapter</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function ChaptersEditor(props: Props) {
  const chapters = props.story.chapters ?? [];
  const complete = chapters.filter((c) => c.complete).length;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Chapters ({chapters.length})</Text>
      {chapters.length > 0 ? (
        <Text style={styles.hint}>{complete} of {chapters.length} complete. Every chapter needs a title, narrative, 5 Kingdom Lessons and 5 Peer Reflection Questions before the story can be published.</Text>
      ) : (
        <Text style={styles.hint}>Optional. Split a longer story into chapters, each with its own Kingdom Lessons and Peer Reflection Questions. The story text above then serves as the introduction.</Text>
      )}
      {chapters.map((ch, i) => (
        // Remount when the saved content changes so uncontrolled fields show it.
        <ChapterCard key={`${ch.id}:${ch.chapterNumber}`} {...props} chapter={ch} index={i} count={chapters.length} />
      ))}
      {!props.locked && (
        <TouchableOpacity
          style={styles.addBtn}
          onPress={async () => { try { await addChapter(props.story.id, { title: "" }); await props.onChanged(); } catch (e) { props.onError("Couldn't add chapter", e); } }}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={16} color={colors.accentGreen} />
          <Text style={styles.addBtnText}>Add chapter</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 12, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 22 },
  subHeading: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 14 },
  hint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, minHeight: 48 },
  cardNum: { width: 22, fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  cardTitle: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeOk: { backgroundColor: "rgba(29,158,117,0.12)" },
  badgeTodo: { backgroundColor: "#FEF3C7" },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  todo: { fontSize: 12, color: "#92400E", fontFamily: "Inter_500Medium", marginTop: 2 },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 10, marginBottom: 4 },
  counter: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  input: { backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  multiline: { minHeight: 140, textAlignVertical: "top" },
  multilineSm: { minHeight: 60, textAlignVertical: "top" },
  itemRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  itemNum: { width: 14, paddingTop: 12, fontSize: 13, color: colors.textMuted, fontFamily: "Inter_700Bold" },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige },
  sourceTitle: { fontSize: 12, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  sourceMeta: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  smallBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
  smallBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  iconBtn: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, padding: 8 },
  deleteText: { color: "#B91C1C", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  addBtn: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", borderWidth: 1, borderColor: colors.accentGreen, borderStyle: "dashed", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  addBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
});
