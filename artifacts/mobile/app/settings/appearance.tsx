import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, AppearanceMode, IllustrationLevel } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { AppStyle, AppStyleCategory, APP_STYLES, getStylesByCategory, resolveAppStyleColors } from "@/constants/appStyles";
import StylePreviewModal from "@/components/StylePreviewModal";
import { FilterChip, IconButton, SegmentedControl } from "@/components/ui";

// Appearance — one screen for everything about how the app looks (it used to
// be three: Appearance → App Style → Style Details). Theme mode, App Style
// (with the same preview-before-apply sheet) and the decoration level all
// save through ThemeContext exactly as before.

const MODES: { value: AppearanceMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "Light", icon: "sunny" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "phone-portrait" },
];

const CATEGORY_META: { id: AppStyleCategory; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "fruits", label: "Fruits" },
  { id: "nature", label: "Nature" },
  { id: "p2p_global", label: "P2P Global" },
  { id: "seasonal", label: "Seasonal" },
];

const LEVELS: { id: IllustrationLevel; label: string; description: string }[] = [
  { id: "minimal", label: "Minimal", description: "Color palette only — no decorative artwork." },
  { id: "balanced", label: "Balanced", description: "Subtle decorative touches in a few places, like empty states and welcome screens. Recommended." },
  { id: "expressive", label: "Expressive", description: "More visual personality, while core screens stay fully readable." },
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
        <IconButton
          icon={isFavorite ? "star" : "star-outline"}
          onPress={onToggleFavorite}
          size="sm"
          color={isFavorite ? "#B8860B" : colors.textMuted}
          accessibilityLabel={isFavorite ? `Remove ${appStyle.name} from favorites` : `Add ${appStyle.name} to favorites`}
        />
      </View>
      <Text style={styles.styleCardName} numberOfLines={1}>{appStyle.name}</Text>
      <View style={styles.swatchRow}>
        <View style={[styles.swatch, { backgroundColor: previewColors.primaryGreen }]} />
        <View style={[styles.swatch, { backgroundColor: previewColors.accentGreen }]} />
        <View style={[styles.swatch, { backgroundColor: previewColors.lightCream, borderWidth: 1, borderColor: colors.borderBeige }]} />
        {isActive && <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} style={{ marginLeft: "auto" }} accessibilityElementsHidden />}
      </View>
    </TouchableOpacity>
  );
}

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, style, styleId, mode, setMode, resolvedMode, setStyle, favorites, toggleFavorite, illustrationLevel, setIllustrationLevel } = useTheme();
  const styles = makeStyles(colors);
  const [categoryFilter, setCategoryFilter] = useState<AppStyleCategory | "all">("all");
  const [previewing, setPreviewing] = useState<AppStyle | null>(null);

  const modeLocked = style.isExisting;
  const favoriteStyles = useMemo(() => APP_STYLES.filter((s) => favorites.includes(s.id)), [favorites]);
  const visibleCategories = categoryFilter === "all" ? CATEGORY_META : CATEGORY_META.filter((c) => c.id === categoryFilter);

  function renderSection(label: string, items: AppStyle[]) {
    if (items.length === 0) return null;
    return (
      <View key={label} style={styles.styleSection}>
        <Text style={styles.subLabel}>{label}</Text>
        <View style={styles.grid}>
          {items.map((s) => (
            <View key={s.id} style={styles.gridItem}>
              <StyleCard appStyle={s} isFavorite={favorites.includes(s.id)} isActive={s.id === styleId}
                onPress={() => setPreviewing(s)} onToggleFavorite={() => toggleFavorite(s.id)} colors={colors} resolvedMode={resolvedMode} />
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
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" color={colors.textDark} />
        <Text style={styles.headerTitle} accessibilityRole="header">Appearance</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* 1. Theme mode */}
        <Text style={styles.sectionLabel} accessibilityRole="header">THEME MODE</Text>
        {modeLocked ? (
          <Text style={styles.hint}>
            "{style.name}" is one of the original P2P Global looks with a fixed light or dark appearance. Choose a different App Style below to use Light, Dark or System.
          </Text>
        ) : (
          <SegmentedControl options={MODES} value={mode} onChange={setMode} accessibilityLabel="Theme mode" />
        )}

        {/* 2. App Style — tap a style to preview it, then apply */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]} accessibilityRole="header">APP STYLE</Text>
        <Text style={styles.hint}>Now using {style.emoji} {style.name}. Tap a style to preview it.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flexGrow: 0 }}>
          <FilterChip label="All" selection="single" selected={categoryFilter === "all"} onPress={() => setCategoryFilter("all")} />
          {CATEGORY_META.map((c) => (
            <FilterChip key={c.id} label={c.label} selection="single" selected={categoryFilter === c.id} onPress={() => setCategoryFilter(c.id)} />
          ))}
        </ScrollView>
        {categoryFilter === "all" && renderSection("Favorites", favoriteStyles)}
        {visibleCategories.map((c) => renderSection(c.label, getStylesByCategory(c.id)))}

        {/* 3. Decoration level (was "Style Details") */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]} accessibilityRole="header">DECORATION</Text>
        <Text style={styles.hint}>How much decorative personality your App Style shows.</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Decoration level">
          {LEVELS.map((lvl) => {
            const active = illustrationLevel === lvl.id;
            return (
              <TouchableOpacity key={lvl.id} style={[styles.row, active && styles.rowActive]} onPress={() => setIllustrationLevel(lvl.id)} activeOpacity={0.85}
                accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`${lvl.label}. ${lvl.description}`}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, active && { color: colors.primaryGreen }]}>{lvl.label}</Text>
                  <Text style={styles.rowDesc}>{lvl.description}</Text>
                </View>
                <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={22} color={active ? colors.primaryGreen : colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>
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
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingHorizontal: 8, paddingVertical: 6,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    sectionLabel: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 10 },
    subLabel: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 10 },
    hint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, marginBottom: 10 },
    chipRow: { gap: 8, paddingBottom: 6 },
    styleSection: { marginTop: 16 },
    grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 },
    gridItem: { width: "50%", paddingHorizontal: 5, marginBottom: 10 },
    styleCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 14, minHeight: 96 },
    styleCardActive: { borderColor: c.accentGreen, borderWidth: 2 },
    styleCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    styleCardEmoji: { fontSize: 24 },
    styleCardName: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    swatchRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
    swatch: { width: 16, height: 16, borderRadius: 8 },
    row: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 10,
    },
    rowActive: { borderColor: c.primaryGreen },
    rowTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 3 },
    rowDesc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
  });
}
