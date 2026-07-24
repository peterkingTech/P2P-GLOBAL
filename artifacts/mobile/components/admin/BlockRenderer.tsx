import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Image, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { LessonBlock } from "@/lib/curriculumBlocks";
import { lookupVerseForAdmin } from "@/lib/bibleClient";
import { pickAndUploadImage, pickAndUploadAudio } from "@/lib/curriculumMedia";

interface Props {
  block: LessonBlock;
  moduleId: string;
  lessonId: string;
  onChangeContent: (content: Record<string, any>) => void;
}

function patch(block: LessonBlock, onChangeContent: Props["onChangeContent"], key: string, value: any) {
  onChangeContent({ ...block.content, [key]: value });
}

// Every text field is a live TextInput, styled to look like plain reading
// text — this is what makes "click anywhere to edit" work without a
// separate view/edit mode.
const textInputBase = { padding: 0, margin: 0 } as const;

export default function BlockRenderer({ block, moduleId, lessonId, onChangeContent }: Props) {
  const c = block.content ?? {};

  switch (block.block_type) {
    case "heading": {
      const level = c.level ?? 2;
      return (
        <TextInput
          style={[textInputBase, level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3]}
          value={c.text ?? ""}
          onChangeText={(t) => patch(block, onChangeContent, "text", t)}
          placeholder="Heading"
          placeholderTextColor={colors.textMutedLight}
          multiline
        />
      );
    }

    case "paragraph":
      return (
        <TextInput
          style={[textInputBase, styles.paragraph]}
          value={c.text ?? ""}
          onChangeText={(t) => patch(block, onChangeContent, "text", t)}
          placeholder="Write a paragraph..."
          placeholderTextColor={colors.textMutedLight}
          multiline
        />
      );

    case "key_point":
      return (
        <View style={styles.keyPointRow}>
          <Ionicons name="key" size={16} color={colors.amber} style={{ marginTop: 3 }} />
          <TextInput
            style={[textInputBase, styles.paragraph, { flex: 1, fontFamily: "Inter_600SemiBold" }]}
            value={c.text ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "text", t)}
            placeholder="Key point..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
        </View>
      );

    case "callout": {
      const stylesByType: Record<string, { bg: string; border: string; icon: string }> = {
        info: { bg: "#EAF6F1", border: colors.accentGreen, icon: "information-circle" },
        warning: { bg: "#FDF3E7", border: colors.amber, icon: "warning" },
        tip: { bg: "#FEF9E7", border: colors.brightYellow, icon: "bulb" },
      };
      const s = stylesByType[c.style ?? "info"] ?? stylesByType.info;
      return (
        <View style={[styles.callout, { backgroundColor: s.bg, borderColor: s.border }]}>
          <View style={styles.calloutHeader}>
            <Ionicons name={s.icon as any} size={16} color={s.border} />
            <View style={{ flexDirection: "row", gap: 6, marginLeft: "auto" }}>
              {(["info", "warning", "tip"] as const).map((opt) => (
                <TouchableOpacity key={opt} onPress={() => patch(block, onChangeContent, "style", opt)}>
                  <View
                    style={[
                      styles.styleDot,
                      { backgroundColor: stylesByType[opt].border, opacity: (c.style ?? "info") === opt ? 1 : 0.3 },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TextInput
            style={[textInputBase, styles.paragraph]}
            value={c.text ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "text", t)}
            placeholder="Callout text..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
        </View>
      );
    }

    case "quote":
      return (
        <View style={styles.quoteWrap}>
          <TextInput
            style={[textInputBase, styles.quoteText]}
            value={c.text ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "text", t)}
            placeholder="Quote..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
          <TextInput
            style={[textInputBase, styles.quoteAttribution]}
            value={c.attribution ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "attribution", t)}
            placeholder="— Attribution"
            placeholderTextColor={colors.textMutedLight}
          />
        </View>
      );

    case "glossary_term":
      return (
        <View style={styles.glossaryWrap}>
          <TextInput
            style={[textInputBase, styles.glossaryTerm]}
            value={c.term ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "term", t)}
            placeholder="Term"
            placeholderTextColor={colors.textMutedLight}
          />
          <TextInput
            style={[textInputBase, styles.paragraph]}
            value={c.definition ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "definition", t)}
            placeholder="Definition..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
        </View>
      );

    case "divider":
      return <View style={styles.divider} />;

    case "scripture":
    case "memory_verse":
      return <ScriptureBlockEditor block={block} onChangeContent={onChangeContent} isMemory={block.block_type === "memory_verse"} />;

    case "reflection_question":
      return (
        <View style={styles.questionRow}>
          <Ionicons name="help-circle" size={18} color={colors.primaryGreen} style={{ marginTop: 2 }} />
          <TextInput
            style={[textInputBase, styles.paragraph, { flex: 1 }]}
            value={c.question ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "question", t)}
            placeholder="Reflection question..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
        </View>
      );

    case "checkpoint":
      return (
        <View style={styles.checkpointRow}>
          <Ionicons name="flag" size={16} color={colors.accentGreen} />
          <TextInput
            style={[textInputBase, styles.paragraph, { flex: 1, fontFamily: "Inter_600SemiBold" }]}
            value={c.text ?? ""}
            onChangeText={(t) => patch(block, onChangeContent, "text", t)}
            placeholder="Checkpoint milestone..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
        </View>
      );

    case "assignment":
      return <AssignmentBlockEditor block={block} onChangeContent={onChangeContent} />;

    case "image":
      return <ImageBlockEditor block={block} moduleId={moduleId} lessonId={lessonId} onChangeContent={onChangeContent} />;

    case "audio_link":
      return <AudioBlockEditor block={block} moduleId={moduleId} lessonId={lessonId} onChangeContent={onChangeContent} />;

    case "video_link":
      return (
        <View style={styles.mediaLinkWrap}>
          <Ionicons name="videocam" size={18} color={colors.textMid} />
          <View style={{ flex: 1 }}>
            <TextInput
              style={[textInputBase, styles.mediaTitleInput]}
              value={c.title ?? ""}
              onChangeText={(t) => patch(block, onChangeContent, "title", t)}
              placeholder="Video title"
              placeholderTextColor={colors.textMutedLight}
            />
            <TextInput
              style={[textInputBase, styles.mediaUrlInput]}
              value={c.url ?? ""}
              onChangeText={(t) => patch(block, onChangeContent, "url", t)}
              placeholder="https://..."
              placeholderTextColor={colors.textMutedLight}
              autoCapitalize="none"
            />
          </View>
        </View>
      );

    default:
      return <Text style={styles.paragraph}>Unsupported block type: {block.block_type}</Text>;
  }
}

// ── Scripture / Memory Verse ──────────────────────────────────────────────────

function ScriptureBlockEditor({
  block, onChangeContent, isMemory,
}: { block: LessonBlock; onChangeContent: Props["onChangeContent"]; isMemory: boolean }) {
  const c = block.content ?? {};
  const [refInput, setRefInput] = useState(c.reference ?? "");
  const [looking, setLooking] = useState(false);

  async function handleLookup() {
    if (!refInput.trim()) return;
    setLooking(true);
    try {
      const result = await lookupVerseForAdmin(refInput.trim(), "en");
      if (!result) {
        Alert.alert("Not found", `Could not find text for "${refInput.trim()}". You can still type it manually.`);
        onChangeContent({ ...c, reference: refInput.trim() });
        return;
      }
      onChangeContent({ ...c, reference: refInput.trim(), text: result.text, translation: result.translationCode });
    } finally {
      setLooking(false);
    }
  }

  return (
    <View style={[styles.scriptureWrap, isMemory && styles.memoryVerseWrap]}>
      <View style={styles.scriptureHeader}>
        <Ionicons name={isMemory ? "bookmark" : "book"} size={16} color={colors.primaryGreen} />
        <TextInput
          style={[textInputBase, styles.scriptureRefInput]}
          value={refInput}
          onChangeText={setRefInput}
          onBlur={() => patch(block, onChangeContent, "reference", refInput)}
          placeholder="e.g. John 3:16"
          placeholderTextColor={colors.textMutedLight}
        />
        <TouchableOpacity style={styles.lookupBtn} onPress={handleLookup} disabled={looking}>
          {looking ? <ActivityIndicator size="small" color={colors.primaryGreen} /> : <Text style={styles.lookupBtnText}>Look up</Text>}
        </TouchableOpacity>
      </View>
      <TextInput
        style={[textInputBase, styles.scriptureText]}
        value={c.text ?? ""}
        onChangeText={(t) => patch(block, onChangeContent, "text", t)}
        placeholder="Verse text (or look it up above)"
        placeholderTextColor={colors.textMutedLight}
        multiline
      />
      {!!c.translation && <Text style={styles.translationTag}>{c.translation}</Text>}
    </View>
  );
}

// ── Assignment (with nested questions) ────────────────────────────────────────

function AssignmentBlockEditor({ block, onChangeContent }: { block: LessonBlock; onChangeContent: Props["onChangeContent"] }) {
  const c = block.content ?? {};
  const questions: Array<{ question: string }> = c.questions ?? [];

  function setQuestions(next: Array<{ question: string }>) {
    onChangeContent({ ...c, questions: next });
  }

  return (
    <View style={styles.assignmentWrap}>
      <View style={styles.assignmentHeader}>
        <Ionicons name="clipboard" size={16} color={colors.primaryGreen} />
        <TextInput
          style={[textInputBase, styles.assignmentTitleInput]}
          value={c.title ?? ""}
          onChangeText={(t) => patch(block, onChangeContent, "title", t)}
          placeholder="Assignment title"
          placeholderTextColor={colors.textMutedLight}
        />
      </View>
      <TextInput
        style={[textInputBase, styles.paragraph]}
        value={c.instructions ?? ""}
        onChangeText={(t) => patch(block, onChangeContent, "instructions", t)}
        placeholder="Instructions..."
        placeholderTextColor={colors.textMutedLight}
        multiline
      />
      {questions.map((q, i) => (
        <View key={i} style={styles.assignmentQuestionRow}>
          <Text style={styles.assignmentQuestionNum}>{i + 1}.</Text>
          <TextInput
            style={[textInputBase, styles.paragraph, { flex: 1 }]}
            value={q.question}
            onChangeText={(t) => {
              const next = [...questions];
              next[i] = { question: t };
              setQuestions(next);
            }}
            placeholder="Question..."
            placeholderTextColor={colors.textMutedLight}
            multiline
          />
          <TouchableOpacity onPress={() => setQuestions(questions.filter((_, idx) => idx !== i))}>
            <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.addQuestionBtn} onPress={() => setQuestions([...questions, { question: "" }])}>
        <Ionicons name="add" size={16} color={colors.primaryGreen} />
        <Text style={styles.addQuestionText}>Add question</Text>
      </TouchableOpacity>
      <View style={styles.dueRow}>
        <Text style={styles.dueLabel}>Due after</Text>
        <TextInput
          style={[textInputBase, styles.dueInput]}
          value={String(c.due_after_days ?? 7)}
          onChangeText={(t) => patch(block, onChangeContent, "due_after_days", parseInt(t, 10) || 0)}
          keyboardType="number-pad"
        />
        <Text style={styles.dueLabel}>days</Text>
      </View>
    </View>
  );
}

// ── Image ──────────────────────────────────────────────────────────────────────

function ImageBlockEditor({
  block, moduleId, lessonId, onChangeContent,
}: { block: LessonBlock; moduleId: string; lessonId: string; onChangeContent: Props["onChangeContent"] }) {
  const c = block.content ?? {};
  const [uploading, setUploading] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState(c.url ?? "");

  async function handlePick() {
    setUploading(true);
    try {
      const url = await pickAndUploadImage(moduleId, lessonId);
      if (url) onChangeContent({ ...c, url });
    } catch (ex: any) {
      Alert.alert("Upload failed", ex.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.imageWrap}>
      {c.url ? (
        <Image source={{ uri: c.url }} style={styles.imagePreview} resizeMode="cover" />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Ionicons name="image-outline" size={28} color={colors.textMutedLight} />
        </View>
      )}
      <View style={styles.imageActionsRow}>
        <TouchableOpacity style={styles.imageActionBtn} onPress={handlePick} disabled={uploading}>
          {uploading ? <ActivityIndicator size="small" color={colors.primaryGreen} /> : (
            <>
              <Ionicons name="cloud-upload-outline" size={14} color={colors.primaryGreen} />
              <Text style={styles.imageActionText}>Upload</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.imageActionBtn} onPress={() => setUrlMode((v) => !v)}>
          <Ionicons name="link-outline" size={14} color={colors.primaryGreen} />
          <Text style={styles.imageActionText}>Use URL</Text>
        </TouchableOpacity>
      </View>
      {urlMode && (
        <TextInput
          style={[textInputBase, styles.mediaUrlInput]}
          value={urlInput}
          onChangeText={setUrlInput}
          onBlur={() => onChangeContent({ ...c, url: urlInput })}
          placeholder="https://..."
          placeholderTextColor={colors.textMutedLight}
          autoCapitalize="none"
        />
      )}
      <TextInput
        style={[textInputBase, styles.imageCaptionInput]}
        value={c.caption ?? ""}
        onChangeText={(t) => patch(block, onChangeContent, "caption", t)}
        placeholder="Caption (optional)"
        placeholderTextColor={colors.textMutedLight}
      />
    </View>
  );
}

// ── Audio ──────────────────────────────────────────────────────────────────────

function AudioBlockEditor({
  block, moduleId, lessonId, onChangeContent,
}: { block: LessonBlock; moduleId: string; lessonId: string; onChangeContent: Props["onChangeContent"] }) {
  const c = block.content ?? {};
  const [uploading, setUploading] = useState(false);

  async function handlePick() {
    setUploading(true);
    try {
      const url = await pickAndUploadAudio(moduleId, lessonId);
      if (url) onChangeContent({ ...c, url });
    } catch (ex: any) {
      Alert.alert("Upload failed", ex.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.mediaLinkWrap}>
      <Ionicons name="musical-notes" size={18} color={colors.textMid} />
      <View style={{ flex: 1 }}>
        <TextInput
          style={[textInputBase, styles.mediaTitleInput]}
          value={c.title ?? ""}
          onChangeText={(t) => patch(block, onChangeContent, "title", t)}
          placeholder="Audio title"
          placeholderTextColor={colors.textMutedLight}
        />
        <Text style={styles.mediaUrlDisplay} numberOfLines={1}>{c.url || "No file uploaded"}</Text>
      </View>
      <TouchableOpacity style={styles.imageActionBtn} onPress={handlePick} disabled={uploading}>
        {uploading ? <ActivityIndicator size="small" color={colors.primaryGreen} /> : <Ionicons name="cloud-upload-outline" size={16} color={colors.primaryGreen} />}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 24, fontFamily: "Inter_700Bold", color: colors.textDark },
  h2: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  h3: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  paragraph: { fontSize: 15, fontFamily: "Inter_400Regular", color: colors.textDark, lineHeight: 22 },
  keyPointRow: { flexDirection: "row", gap: 8 },
  callout: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  calloutHeader: { flexDirection: "row", alignItems: "center" },
  styleDot: { width: 12, height: 12, borderRadius: 6 },
  quoteWrap: { borderLeftWidth: 3, borderLeftColor: colors.accentGreen, paddingLeft: 12, gap: 4 },
  quoteText: { fontSize: 15, fontFamily: "Inter_500Medium", fontStyle: "italic", color: colors.textMid, lineHeight: 22 },
  quoteAttribution: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMuted },
  glossaryWrap: { gap: 4 },
  glossaryTerm: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  divider: { height: 1, backgroundColor: colors.borderBeige, marginVertical: 4 },
  questionRow: { flexDirection: "row", gap: 8 },
  checkpointRow: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#EAF6F1", borderRadius: 8, padding: 10 },
  mediaLinkWrap: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.cardBeige, borderRadius: 10, padding: 10 },
  mediaTitleInput: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  mediaUrlInput: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMid, marginTop: 2 },
  mediaUrlDisplay: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted, marginTop: 2 },
  scriptureWrap: { backgroundColor: "#EAF6F1", borderRadius: 10, padding: 12, gap: 8, borderWidth: 1, borderColor: "#CFE9DE" },
  memoryVerseWrap: { backgroundColor: "#FEF9E7", borderColor: "#F0E1AE" },
  scriptureHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  scriptureRefInput: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark, flex: 1 },
  lookupBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.primaryGreen, minWidth: 64, alignItems: "center" },
  lookupBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scriptureText: { fontSize: 15, fontFamily: "Inter_500Medium", fontStyle: "italic", color: colors.textDark, lineHeight: 22 },
  translationTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.textMuted, alignSelf: "flex-end" },
  assignmentWrap: { backgroundColor: colors.cardBeige, borderRadius: 10, padding: 12, gap: 8 },
  assignmentHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  assignmentTitleInput: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.textDark, flex: 1 },
  assignmentQuestionRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  assignmentQuestionNum: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textMuted, marginTop: 2 },
  addQuestionBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  addQuestionText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primaryGreen },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  dueLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted },
  dueInput: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.textDark, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, minWidth: 30, textAlign: "center" },
  imageWrap: { gap: 8 },
  imagePreview: { width: "100%", height: 160, borderRadius: 10, backgroundColor: colors.cardBeige },
  imagePlaceholder: { width: "100%", height: 120, borderRadius: 10, backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center" },
  imageActionsRow: { flexDirection: "row", gap: 8 },
  imageActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  imageActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primaryGreen },
  imageCaptionInput: { fontSize: 13, fontFamily: "Inter_400Regular", fontStyle: "italic", color: colors.textMuted },
});
