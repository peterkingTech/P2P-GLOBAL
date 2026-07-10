import React, { useMemo, useState } from "react";
import { Modal, View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { SKILLS_TAXONOMY, groupSkillsByCategory } from "@/constants/skillsTaxonomy";

interface SkillsMultiSelectProps {
  visible: boolean;
  initialSelected: string[];
  onClose: () => void;
  onSave: (selected: string[]) => void;
}

export default function SkillsMultiSelect({ visible, initialSelected, onClose, onSave }: SkillsMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(initialSelected);

  React.useEffect(() => {
    if (visible) {
      setSelected(initialSelected);
      setQuery("");
    }
  }, [visible, initialSelected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = q
      ? SKILLS_TAXONOMY.filter((s) => s.label.toLowerCase().includes(q) || s.category.toLowerCase().includes(q))
      : SKILLS_TAXONOMY;
    return groupSkillsByCategory(items);
  }, [query]);

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Select Skills</Text>
          <TouchableOpacity onPress={() => onSave(selected)}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search skills..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {selected.length > 0 && (
          <View style={styles.selectedBar}>
            <Text style={styles.selectedCount}>{selected.length} selected</Text>
          </View>
        )}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {filtered.map((group) => (
            <View key={group.category} style={{ marginBottom: 8 }}>
              <Text style={styles.categoryHeading}>{group.category}</Text>
              {group.items.map((item) => {
                const isSelected = selected.includes(item.key);
                return (
                  <TouchableOpacity key={item.key} style={styles.row} onPress={() => toggle(item.key)}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          {filtered.length === 0 && (
            <Text style={styles.emptyText}>No skills match "{query}"</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cancelText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  saveText: { fontSize: 14, color: colors.primaryGreen, fontWeight: "700", fontFamily: "Inter_700Bold" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderRadius: 10,
    borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 12, height: 40,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  selectedBar: { paddingHorizontal: 16, paddingTop: 8 },
  selectedCount: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  categoryHeading: {
    fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, fontFamily: "Inter_700Bold", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  rowLabel: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", flex: 1, paddingRight: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.borderBeige,
    alignItems: "center", justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
});
