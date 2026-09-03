import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { AppStyle, AppStyleCategory, APP_STYLES, getStylesByCategory, resolveAppStyleColors } from "@/constants/appStyles";
import StylePreviewModal from "@/components/StylePreviewModal";

const CATEGORY_META: { id: AppStyleCategory; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "fruits", label: "Fruits" },
  { id: "nature", label: "Nature" },
  { id: "p2p_global", label: "P2P Global" },
  { id: "seasonal", label: "Seasonal" },
];

function StyleCard({ appStyle, isFavorite, isActive, onPress, onToggleFavorite, colors, resolvedMode }: {
  appStyle: AppStyle; isFavorite: boolean; isActive: boolean; onPress: () => void; onToggleFavorite: () => void;
  colors: AppColors; resolvedMode: "light" | "dark";
}) {
  const styles = makeStyles(colors);
  const previewColors = resolveAppStyleColors(appStyle, resolvedMode);
  return (
    <TouchableOpacity
      style={[styles.styleCard, isActive && styles.styleCardActive]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${appStyle.name}. ${appStyle.description}${isActive ? ". Currently selected" : ""}. Tap to preview.`}
    >
      <View style={styles.styleCardTop}>
        <Text style={styles.styleCardEmoji}>{appStyle.emoji}</Text>
        <TouchableOpacity
          onPress={onToggleFavorite}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? `Remove ${appStyle.name} from favorites` : `Add ${appStyle.name} to favorites`}
        >
          <Ionicons name={isFavorite ? "star" : "star-outline"} size={16} color={isFavorite ? "#E8B408" : colors.textMutedLight} />
        </TouchableOpacity>
      </View>
      <Text style={styles.styleCardName} numberOfLines={1}>{appStyle.name}</Text>
      <View style={styles.swatchRow}>
        <View style={[styles.swatch, { backgroundColor: previewColors.primaryGreen }]} />
        <View style={[styles.swatch, { backgroundColor: previewColors.accentGreen }]} />
        <View style={[styles.swatch, { backgroundColor: previewColors.lightCream, borderWidth: 1, borderColor: colors.borderBeige }]} />
      </View>
      {isActive && (
        <View style={styles.activeBadge}>
          <Ionicons name="checkmark-circle" size={14} color={colors.accentGreen} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function AppStyleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, styleId, resolvedMode, setStyle, favorites, toggleFavorite } = useTheme();
  const styles = makeStyles(colors);
  const [categoryFilter, setCategoryFilter] = useState<AppStyleCategory | "all">("all");
  const [previewing, setPreviewing] = useState<AppStyle | null>(null);

  const favoriteStyles = useMemo(
    () => APP_STYLES.filter((s) => favorites.includes(s.id)),
    [favorites]
  );

  const visibleCategories = categoryFilter === "all" ? CATEGORY_META : CATEGORY_META.filter((c) => c.id === categoryFilter);

  function renderSection(label: string, items: AppStyle[]) {
    if (items.length === 0) return null;
    return (
      <View key={label} style={styles.section}>
        <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
        <View style={styles.grid}>
          {items.map((s) => (
            <View key={s.id} style={styles.gridItem}>
              <StyleCard
                appStyle={s}
                isFavorite={favorites.includes(s.id)}
                isActive={s.id === styleId}
                onPress={() => setPreviewing(s)}
                onToggleFavorite={() => toggleFavorite(s.id)}
                colors={colors}
                resolvedMode={resolvedMode}
              />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App Style</Text>
      </View>

      <Text style={styles.intro}>Personalize the look and feel of your P2P Global experience.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
        <TouchableOpacity
          style={[styles.chip, categoryFilter === "all" && styles.chipActive]}
          onPress={() => setCategoryFilter("all")}
        >
          <Text style={[styles.chipText, categoryFilter === "all" && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {CATEGORY_META.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, categoryFilter === c.id && styles.chipActive]}
            onPress={() => setCategoryFilter(c.id)}
          >
            <Text style={[styles.chipText, categoryFilter === c.id && styles.chipTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {categoryFilter === "all" && favoriteStyles.length > 0 && renderSection("⭐ Favorites", favoriteStyles)}
        {visibleCategories.map((c) => renderSection(c.label, getStylesByCategory(c.id)))}
      </ScrollView>

      <StylePreviewModal
        style={previewing}
        visible={!!previewing}
        onCancel={() => setPreviewing(null)}
        onApply={() => {
          if (previewing) setStyle(previewing.id);
          setPreviewing(null);
        }}
      />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    intro: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
    chipScroll: { flexGrow: 0, marginTop: 4 },
    chipRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 10 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    chipActive: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    chipText: { fontSize: 13, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    chipTextActive: { color: "#fff" },
    content: { paddingHorizontal: 20 },
    section: { marginTop: 18 },
    sectionLabel: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 10 },
    grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 },
    gridItem: { width: "50%", paddingHorizontal: 5, marginBottom: 10 },
    styleCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, minHeight: 96,
    },
    styleCardActive: { borderColor: c.accentGreen, borderWidth: 2 },
    styleCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    styleCardEmoji: { fontSize: 24 },
    styleCardName: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
    swatchRow: { flexDirection: "row", gap: 6, marginTop: 8 },
    swatch: { width: 16, height: 16, borderRadius: 8 },
    activeBadge: { position: "absolute", top: 10, right: 34 },
  });
}