import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useData, CurriculumCatalogItem } from "@/contexts/DataContext";
import colors from "@/constants/colors";

// Three-category curriculum — a small, fixed library of stand-alone
// journeys, not a numbered staircase and not an open-ended list. No
// "Level 1/2/3", no locked-until-you-finish-the-last-one gating between
// categories: each is independent, and a learner can move between them in
// any order. The catalog itself (title/description/cover image/counts) is
// entirely database-driven (see DataContext.getCurriculumCatalog) — this
// screen renders whatever is actually published, it doesn't hard-code the
// three titles, so a future fourth category needs only a new published
// p2p_curriculums row, never a mobile release.
function iconForTitle(title: string): keyof typeof Ionicons.glyphMap {
  if (title.includes("Peer-to-Peer") || title.includes("Orientation")) return "people-circle-outline";
  if (title.includes("Gospel")) return "sunny-outline";
  if (title.includes("Foundation")) return "leaf-outline";
  return "library-outline";
}

function CardImage({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return null;
  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

// A small square crop of the actual cover photo, in place of an abstract
// icon, so the card gives a real preview of the image before the user taps
// in — falls back to the icon + color wash exactly as before when there is
// no photo yet or it fails to load.
function SquarePhotoBadge({
  uri, icon, colorTheme,
}: { uri: string | null; icon: keyof typeof Ionicons.glyphMap; colorTheme: string }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={styles.iconBadge}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <View style={[styles.iconBadge, { backgroundColor: `${colorTheme}1f` }]}>
      <Ionicons name={icon} size={20} color={colorTheme} />
    </View>
  );
}

export default function CurriculumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getCurriculumCatalog } = useData();
  const [catalog, setCatalog] = useState<CurriculumCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setCatalog(await getCurriculumCatalog());
    setLoading(false);
  }, [getCurriculumCatalog]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Curriculum</Text>
      </View>

      <View style={styles.intro}>
        <Text style={styles.introText}>
          Explore stand-alone journeys to grow in your faith and life with Christ. Study one, return to another later, or explore several at once — there's no required order.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={catalog}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const icon = (item.icon as keyof typeof Ionicons.glyphMap) || iconForTitle(item.title);
            const countsLabel = `${item.moduleCount} ${item.moduleCount === 1 ? "module" : "modules"} · ${item.lessonCount} ${item.lessonCount === 1 ? "lesson" : "lessons"}`;
            return (
              <TouchableOpacity
                style={styles.currCard}
                onPress={() => router.push(`/curriculum/${item.id}` as any)}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.description}. ${countsLabel}. Tap to open.`}
              >
                {/* Cover image, when the admin has set one, fills the right
                    two-thirds of the card behind a left-to-right gradient so
                    the icon/title/description on the left stay fully
                    readable regardless of the photo underneath. No image at
                    all is a completely normal, supported state — the card
                    still looks intentional via the icon + color wash. */}
                <View style={StyleSheet.absoluteFill}>
                  <CardImage uri={item.coverImage} />
                  <LinearGradient
                    colors={[colors.card, colors.card, `${colors.card}00`]}
                    locations={[0, 0.42, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </View>

                <View style={styles.cardContent}>
                  <View style={styles.cardTop}>
                    <SquarePhotoBadge uri={item.coverImage} icon={icon} colorTheme={item.colorTheme} />
                  </View>
                  <Text style={styles.currTitle}>{item.title}</Text>
                  <Text style={styles.currDesc} numberOfLines={3}>{item.description}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="book-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.metaText}>{countsLabel}</Text>
                  </View>
                </View>

                {/* The arrow is a visual affordance, never the only signal
                    that this card is tappable — the whole card carries an
                    accessibilityRole of "button" with a full descriptive
                    label above, and the entire card surface (not just the
                    arrow) is the touch target. */}
                <View style={styles.arrowBadge} accessibilityElementsHidden importantForAccessibility="no">
                  <Ionicons name="chevron-forward" size={18} color={colors.textDark} />
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  intro: {
    margin: 16,
    padding: 14,
    backgroundColor: colors.cardBeige,
    borderRadius: 12, borderWidth: 1, borderColor: colors.warmBeige,
  },
  introText: { fontSize: 13, color: colors.textMid, lineHeight: 20, fontFamily: "Inter_400Regular" },
  list: { paddingHorizontal: 16 },
  currCard: {
    minHeight: 168, borderRadius: 20, overflow: "hidden",
    borderWidth: 1, borderColor: colors.borderBeige,
    marginBottom: 14, backgroundColor: colors.card,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  cardContent: { padding: 18, paddingRight: "42%", flex: 1, justifyContent: "center" },
  cardTop: { flexDirection: "row", marginBottom: 10 },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  currTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
  currDesc: { fontSize: 13, color: colors.textMid, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 10 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  arrowBadge: {
    position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center",
  },
});