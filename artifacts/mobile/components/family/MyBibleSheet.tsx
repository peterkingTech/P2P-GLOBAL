import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type } from "@/lib/togetherTheme";
import ScripturePanel from "@/components/family/ScripturePanel";
import { getBibleTranslations, type WorshipScripture } from "@/lib/familyApi";
import { useRouter } from "expo-router";
import { bibleRoute, bookByName, bookByCode } from "@/lib/bibleReaderApi";
import { loadPosition, savePosition } from "@/lib/bibleReadingPrefs";
import { AppButton, IconButton } from "@/components/ui";

// "My Bible" during a Gathering (Prompt 6): anyone can read any passage on
// their own, starting from the group's passage or a lesson reference. It
// never changes what the group sees — only the Guide shares Scripture — and
// it's a sheet over the Gathering, so the call is untouched.
interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where to start: a lesson reference, else the group's current passage. */
  start: Omit<WorshipScripture, "translation"> & { translation?: string | null } | null;
}

export default function MyBibleSheet({ visible, onClose, start }: Props) {
  const [passage, setPassage] = useState<WorshipScripture | null>(null);
  const router = useRouter();

  // The full reader (notes, highlights, search) opens ON TOP of the
  // Gathering, so the call keeps running; its Return bar comes back here.
  function openFullBible() {
    const b = bookByName(passage?.book);
    onClose();
    router.push(bibleRoute(b && passage
      ? { book: b.code, chapter: passage.chapter, v: passage.startVerse, ve: passage.endVerse, translation: passage.translation }
      : { book: "JHN", chapter: 1 }) as any);
  }

  // Reading on your own continues where you last read (the same position the
  // full Bible reader keeps on this device); the group's passage never moves.
  function read(p: WorshipScripture) {
    setPassage(p);
    const b = bookByName(p.book);
    if (b) savePosition({ translation: p.translation, book: b.code, chapter: p.chapter });
  }

  // Lesson references may have no translation; use the first available one.
  useEffect(() => {
    if (!visible) return;
    if (!start) {
      let cancelled = false;
      loadPosition().then((pos) => {
        const b = pos ? bookByCode(pos.book) : undefined;
        if (!cancelled) setPassage(pos && b ? { book: b.name, chapter: pos.chapter, startVerse: 1, endVerse: 176, translation: pos.translation } : null);
      });
      return () => { cancelled = true; };
    }
    if (start.translation) { setPassage({ ...start, translation: start.translation }); return; }
    let cancelled = false;
    getBibleTranslations("en").then((list) => {
      if (!cancelled && list.length) setPassage({ ...start, translation: list[0].translation_code, translationName: list[0].translation_name });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, start?.book, start?.chapter, start?.startVerse, start?.endVerse, start?.translation]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">My Bible</Text>
            <Text style={styles.sub}>Only you see this. The group's passage doesn't change.</Text>
          </View>
          <AppButton label="Full Bible" onPress={openFullBible} variant="secondary" icon="expand-outline" accessibilityLabel="Open the full Bible with your notes and highlights" palette="fixedDark" />
          <IconButton icon="close" accessibilityLabel="Close My Bible and return to the Gathering" onPress={onClose} color={colors.textPrimary} palette="fixedDark" />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Remount when the starting passage changes so the picker starts there. */}
          <ScripturePanel
            key={passage ? `${passage.book}-${passage.chapter}-${passage.translation}` : "none"}
            currentScripture={passage} isGuide onSelect={read} selectLabel="Read" largeText showOpenInBible={false}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 56, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 18, fontFamily: "Inter_700Bold" },
  sub: { color: colors.textSecondary, ...type.caption, marginTop: 2 },
  fullText: { color: colors.textPrimary, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  scroll: { padding: spacing.lg, paddingBottom: 40 },
});
