import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, FlatList, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { CANON, type CanonBook } from "@/lib/bibleReaderApi";
import { IconButton } from "@/components/ui";
import { BIBLE_COVER } from "@/constants/artwork";

// Book → chapter selection for the Bible reader. Books come from the canon
// list (structure only), in Bible order, split Old/New Testament, with a
// search field. Only chapters that exist for the chosen book are offered.
interface Props {
  visible: boolean;
  onClose: () => void;
  currentBook: string;
  currentChapter: number;
  onSelect: (bookCode: string, chapter: number) => void;
}

export default function BookChapterPicker({ visible, onClose, currentBook, currentChapter, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [query, setQuery] = useState("");
  const [testament, setTestament] = useState<"OT" | "NT">("OT");
  const [openBook, setOpenBook] = useState<string | null>(currentBook);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setOpenBook(currentBook);
    setTestament(CANON.find((b) => b.code === currentBook)?.testament ?? "OT");
  }, [visible, currentBook]);

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return CANON.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().startsWith(q));
    return CANON.filter((b) => b.testament === testament);
  }, [query, testament]);

  const renderBook = ({ item: b }: { item: CanonBook }) => {
    const open = openBook === b.code;
    const current = b.code === currentBook;
    return (
      <View>
        <TouchableOpacity style={[styles.bookRow, current && styles.bookRowCurrent]} onPress={() => setOpenBook(open ? null : b.code)}
          accessibilityRole="button" accessibilityState={{ expanded: open, selected: current }}
          accessibilityLabel={`${b.name}, ${b.chapters} chapter${b.chapters === 1 ? "" : "s"}${current ? ", current book" : ""}`}>
          <Text style={[styles.bookName, current && styles.bookNameCurrent]}>{b.name}</Text>
          <Text style={styles.bookMeta}>{b.chapters}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={c.textMuted} />
        </TouchableOpacity>
        {open && (
          <View style={styles.grid} accessibilityRole="list">
            {Array.from({ length: b.chapters }, (_, i) => i + 1).map((n) => {
              const isCurrent = current && n === currentChapter;
              return (
                <TouchableOpacity key={n} style={[styles.chip, isCurrent && styles.chipCurrent]} onPress={() => onSelect(b.code, n)}
                  accessibilityRole="button" accessibilityLabel={`${b.name} chapter ${n}${isCurrent ? ", current" : ""}`} accessibilityState={{ selected: isCurrent }}>
                  <Text style={[styles.chipText, isCurrent && styles.chipTextCurrent]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[styles.screen, { paddingTop: insets.top > 20 ? 12 : insets.top + 12 }]}>
        <View style={styles.header}>
          <Image source={BIBLE_COVER} style={styles.coverThumb} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={styles.title} accessibilityRole="header">Books</Text>
          <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={c.textDark} />
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={c.textMuted} />
          <TextInput style={styles.searchInput} placeholder="Find a book" placeholderTextColor={c.textMuted} value={query} onChangeText={setQuery}
            autoCorrect={false} accessibilityLabel="Find a book" returnKeyType="search" />
        </View>
        {!query && (
          <View style={styles.tabs} accessibilityRole="tablist">
            {(["OT", "NT"] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.tab, testament === t && styles.tabActive]} onPress={() => setTestament(t)}
                accessibilityRole="tab" accessibilityState={{ selected: testament === t }}>
                <Text style={[styles.tabText, testament === t && styles.tabTextActive]}>{t === "OT" ? "Old Testament" : "New Testament"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <FlatList data={books} keyExtractor={(b) => b.code} renderItem={renderBook} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={<Text style={styles.empty}>No book matches “{query}”.</Text>} />
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
    coverThumb: { width: 40, height: 40, borderRadius: 8, marginRight: 10 },
    title: { flex: 1, fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, paddingHorizontal: 12, minHeight: 44, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    searchInput: { flex: 1, color: c.textDark, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 8 },
    tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    tab: { flex: 1, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    tabActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tabText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    tabTextActive: { color: "#fff" },
    bookRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    bookRowCurrent: { backgroundColor: c.card },
    bookName: { flex: 1, fontSize: 16, color: c.textDark, fontFamily: "Inter_500Medium" },
    bookNameCurrent: { color: c.accentGreen, fontFamily: "Inter_700Bold" },
    bookMeta: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.card },
    chip: { width: 48, height: 44, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center", backgroundColor: c.lightCream },
    chipCurrent: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    chipTextCurrent: { color: "#fff" },
    empty: { textAlign: "center", color: c.textMuted, fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 32 },
  });
}
