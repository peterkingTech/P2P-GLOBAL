import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { BIBLE_BOOKS } from "@/lib/bibleBooks";
import { getBibleTranslations, type BibleTranslation } from "@/lib/familyApi";
import { formToInput, lessonToForm, newPassage, type CustomLesson, type LessonForm, type LessonInput } from "@/lib/customLessonModel";
import { AppButton, IconButton } from "@/components/ui";

// Full-screen authoring form for one custom lesson (Family or Church — the
// screen passes onSave). Only the title is required; everything else is
// optional. "Save draft" keeps it to leaders; "Publish" shows it to members.
// Editing a published lesson keeps it published (the server versions it).
interface Props {
  visible: boolean;
  lesson: CustomLesson | null; // null = new lesson
  onCancel: () => void;
  onSave: (input: LessonInput, publish: boolean) => Promise<void>;
}

export default function CustomLessonEditor({ visible, lesson, onCancel, onSave }: Props) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<LessonForm>(lessonToForm(lesson));
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [bookPickerFor, setBookPickerFor] = useState<number | null>(null);

  useEffect(() => { if (visible) { setForm(lessonToForm(lesson)); setProblem(null); } }, [visible, lesson]);
  useEffect(() => { if (visible && !translations.length) void getBibleTranslations("en").then(setTranslations).catch(() => {}); }, [visible, translations.length]);

  const set = (patch: Partial<LessonForm>) => setForm((f) => ({ ...f, ...patch }));
  const setPassage = (i: number, patch: Partial<LessonForm["passages"][number]>) => set({ passages: form.passages.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const isPublished = lesson?.status === "published" || (lesson != null && lesson.status === undefined);

  async function save(publish: boolean) {
    const input = formToInput(form);
    if (typeof input === "string") { setProblem(input); return; }
    setProblem(null);
    setSaving(publish ? "publish" : "draft");
    try { await onSave(input, publish); }
    catch (e: any) { setProblem(e?.message ?? "Couldn't save. Please try again."); }
    finally { setSaving(null); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
          <View style={styles.bar}>
            <AppButton label="Cancel" onPress={onCancel} variant="tertiary" accessibilityLabel="Cancel" style={{ minWidth: 72 }} />
            <Text style={styles.barTitle}>{lesson ? "Edit lesson" : "New lesson"}</Text>
            <View style={styles.barBtn} />
          </View>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled">
            <Field styles={styles} label="Title *">
              <TextInput style={styles.input} value={form.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. The Good Shepherd" placeholderTextColor={c.textMuted} maxLength={160} accessibilityLabel="Lesson title" />
            </Field>
            <Field styles={styles} label="Short description">
              <TextInput style={[styles.input, { minHeight: 60 }]} value={form.description} onChangeText={(v) => set({ description: v })} multiline maxLength={600} placeholderTextColor={c.textMuted} accessibilityLabel="Short description" />
            </Field>
            <Field styles={styles} label="Topics" hint="Separate with commas, e.g. prayer, family">
              <TextInput style={styles.input} value={form.tags} onChangeText={(v) => set({ tags: v })} autoCapitalize="none" placeholderTextColor={c.textMuted} accessibilityLabel="Topics" />
            </Field>

            <Field styles={styles} label="Scripture" hint="The first passage is the lesson's main Scripture.">
              {form.passages.map((p, i) => (
                <View key={i} style={styles.passage}>
                  <Text style={styles.passageLabel}>{i === 0 ? "Main passage" : `Passage ${i + 1}`}</Text>
                  <AppButton label={`${p.book || "Choose a book"}`} onPress={() => setBookPickerFor(i)} variant="secondary" icon="chevron-down" iconPosition="trailing" accessibilityLabel={`Book${p.book ? `, ${p.book}` : ""}`} />
                  <View style={styles.row}>
                    {(["chapter", "startVerse", "endVerse"] as const).map((k) => (
                      <TextInput key={k} style={[styles.input, styles.small]} value={p[k]} onChangeText={(v) => setPassage(i, { [k]: v.replace(/[^0-9]/g, "") })}
                        keyboardType="number-pad" placeholder={k === "chapter" ? "Chapter" : k === "startVerse" ? "From v." : "To v."} placeholderTextColor={c.textMuted}
                        accessibilityLabel={k === "chapter" ? "Chapter" : k === "startVerse" ? "First verse" : "Last verse"} />
                    ))}
                  </View>
                  {translations.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                      {translations.map((t) => (
                        <TouchableOpacity key={t.translation_code} style={[styles.chip, p.translation === t.translation_code && styles.chipOn]}
                          onPress={() => setPassage(i, { translation: p.translation === t.translation_code ? "" : t.translation_code })}
                          accessibilityRole="radio" accessibilityState={{ checked: p.translation === t.translation_code }} accessibilityLabel={t.translation_name}>
                          <Text style={[styles.chipText, p.translation === t.translation_code && styles.chipTextOn]}>{t.translation_code}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {form.passages.length > 1 && (
                    <TouchableOpacity onPress={() => set({ passages: form.passages.filter((_, j) => j !== i) })} style={styles.removeLink} accessibilityRole="button" accessibilityLabel={`Remove passage ${i + 1}`}>
                      <Text style={styles.removeText}>Remove passage</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {form.passages.length < 10 && (
                <TouchableOpacity style={styles.addLink} onPress={() => set({ passages: [...form.passages, newPassage(form.passages[0]?.translation ?? "")] })} accessibilityRole="button">
                  <Ionicons name="add" size={16} color={c.accentGreen} /><Text style={styles.addText}>Add another passage</Text>
                </TouchableOpacity>
              )}
            </Field>

            <Field styles={styles} label="Teaching content">
              <TextInput style={[styles.input, { minHeight: 160 }]} value={form.teachingMaterial} onChangeText={(v) => set({ teachingMaterial: v })} multiline textAlignVertical="top" maxLength={20000} placeholderTextColor={c.textMuted} accessibilityLabel="Teaching content" />
            </Field>

            <Field styles={styles} label="Questions" hint="Discussion questions are talked about together. Reflection questions are answered privately.">
              {form.questions.map((q, i) => (
                <View key={q.id ?? `new-${i}`} style={styles.question}>
                  <TextInput style={[styles.input, { minHeight: 48 }]} value={q.text} multiline onChangeText={(v) => set({ questions: form.questions.map((x, j) => (j === i ? { ...x, text: v } : x)) })}
                    placeholder={`Question ${i + 1}`} placeholderTextColor={c.textMuted} maxLength={500} accessibilityLabel={`Question ${i + 1}`} />
                  <View style={styles.row}>
                    {(["discussion", "reflection"] as const).map((k) => (
                      <TouchableOpacity key={k} style={[styles.chip, q.kind === k && styles.chipOn]} onPress={() => set({ questions: form.questions.map((x, j) => (j === i ? { ...x, kind: k } : x)) })}
                        accessibilityRole="radio" accessibilityState={{ checked: q.kind === k }}>
                        <Text style={[styles.chipText, q.kind === k && styles.chipTextOn]}>{k === "discussion" ? "Discussion" : "Reflection"}</Text>
                      </TouchableOpacity>
                    ))}
                    <View style={{ flex: 1 }} />
                    <IconButton icon="trash-outline" accessibilityLabel={`Remove question ${i + 1}`} onPress={() => set({ questions: form.questions.length > 1 ? form.questions.filter((_, j) => j !== i) : [{ text: "", kind: "discussion" }] })} color={c.textMuted} />
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.addLink} onPress={() => set({ questions: [...form.questions, { text: "", kind: "discussion" }] })} accessibilityRole="button">
                <Ionicons name="add" size={16} color={c.accentGreen} /><Text style={styles.addText}>Add a question</Text>
              </TouchableOpacity>
            </Field>

            <Field styles={styles} label="Prayer focus">
              <TextInput style={[styles.input, { minHeight: 48 }]} value={form.prayerFocus} onChangeText={(v) => set({ prayerFocus: v })} multiline maxLength={1000} placeholderTextColor={c.textMuted} accessibilityLabel="Prayer focus" />
            </Field>
            <Field styles={styles} label="Video" hint="A YouTube link (optional)">
              <TextInput style={styles.input} value={form.media} onChangeText={(v) => set({ media: v })} autoCapitalize="none" keyboardType="url" placeholder="https://youtu.be/…" placeholderTextColor={c.textMuted} accessibilityLabel="YouTube link" />
            </Field>
            <Field styles={styles} label="Links and resources" hint="Optional web links (https://)">
              {form.resources.map((r, i) => (
                <View key={i} style={styles.question}>
                  <TextInput style={styles.input} value={r.title} onChangeText={(v) => set({ resources: form.resources.map((x, j) => (j === i ? { ...x, title: v } : x)) })} placeholder="Title" placeholderTextColor={c.textMuted} accessibilityLabel={`Link ${i + 1} title`} />
                  <View style={styles.row}>
                    <TextInput style={[styles.input, { flex: 1 }]} value={r.url} onChangeText={(v) => set({ resources: form.resources.map((x, j) => (j === i ? { ...x, url: v } : x)) })} autoCapitalize="none" keyboardType="url" placeholder="https://…" placeholderTextColor={c.textMuted} accessibilityLabel={`Link ${i + 1} address`} />
                    <IconButton icon="trash-outline" accessibilityLabel={`Remove link ${i + 1}`} onPress={() => set({ resources: form.resources.filter((_, j) => j !== i) })} color={c.textMuted} />
                  </View>
                </View>
              ))}
              {form.resources.length < 10 && (
                <TouchableOpacity style={styles.addLink} onPress={() => set({ resources: [...form.resources, { title: "", url: "" }] })} accessibilityRole="button">
                  <Ionicons name="add" size={16} color={c.accentGreen} /><Text style={styles.addText}>Add a link</Text>
                </TouchableOpacity>
              )}
            </Field>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            {problem ? <Text style={styles.problem} accessibilityLiveRegion="assertive">{problem}</Text> : null}
            <View style={styles.row}>
              {!isPublished && (
                <AppButton label="Save draft" onPress={() => save(false)} variant="secondary" disabled={!!saving} loading={saving === "draft"} style={{ flex: 1 }} />
              )}
              <AppButton label={isPublished ? "Save changes" : "Publish"} onPress={() => save(true)} disabled={!!saving} loading={saving === "publish"} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={bookPickerFor !== null} transparent animationType="fade" onRequestClose={() => setBookPickerFor(null)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.sheetTitle}>Choose a book</Text>
            <ScrollView>
              {BIBLE_BOOKS.map((b) => (
                <TouchableOpacity key={b.name} style={styles.bookRow} onPress={() => { if (bookPickerFor !== null) setPassage(bookPickerFor, { book: b.name }); setBookPickerFor(null); }} accessibilityRole="button">
                  <Text style={styles.bookText}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// Module-level (not defined inside the editor) so the text boxes inside keep
// their identity — and keyboard focus — across re-renders while typing.
function Field({ styles, label, hint, children }: { styles: ReturnType<typeof makeStyles>; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, minHeight: 48 },
    barBtn: { minWidth: 72, minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
    barCancel: { fontSize: 15, color: c.textMid, fontFamily: "Inter_500Medium" },
    barTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { paddingHorizontal: 16, gap: 16 },
    field: { gap: 6 },
    label: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    hint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    input: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", minHeight: 44 },
    passage: { gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige },
    passageLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    bookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    bookText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    small: { flex: 1, textAlign: "center" },
    chips: { gap: 6, paddingVertical: 2 },
    chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center", backgroundColor: c.card },
    chipOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    chipTextOn: { color: "#fff" },
    question: { gap: 6, marginBottom: 6 },
    iconBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    addLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
    addText: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    removeLink: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
    removeText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium" },
    footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: c.lightCream, borderTopWidth: 1, borderTopColor: c.borderBeige, gap: 8 },
    problem: { fontSize: 13, color: "#B42318", fontFamily: "Inter_500Medium" },
    btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    btnPrimary: { backgroundColor: c.primaryGreen },
    btnPrimaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    btnSecondary: { borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    btnSecondaryText: { color: c.textDark, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: { maxHeight: "75%", backgroundColor: c.lightCream, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 14, paddingHorizontal: 16 },
    sheetTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
    bookRow: { minHeight: 44, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
  });
}
