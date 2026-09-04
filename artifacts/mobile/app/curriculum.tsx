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
import { useData, CurriculumCatalogItem } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// Three-category curriculum — a small, fixed library of stand-alone
// journeys, presented in a deliberate sequence: Kingdom School unlocks them
// one at a time, in display_order, as the learner completes each one (see
// DataContext.getKingdomSchoolLockState) — starting with "Peer-to-Peer
// Orientation" for every brand-new learner regardless of which category
// happens to render first in this list. The catalog itself (title/
// description/cover image/counts) is entirely database-driven (see
// DataContext.getCurriculumCatalog) — this screen renders whatever is
// actually published, it doesn't hard-code the three titles, so a future
// fourth category needs only a new published p2p_curriculums row (appended
// after the existing display_order values), never a mobile release.
function iconForTitle(title: string): keyof typeof Ionicons.glyphMap {
  if (title.includes("Peer-to-Peer") || title.includes("Orientation")) return "people-circle-outline";
  if (title.includes("Gospel")) return "sunny-outline";
  if (title.includes("Foundation")) return "leaf-outline";
  return "library-outline";
}

// The cover photo as its own large square block on the right of the card —
// a real flex column next to the text column (not an overlapping full-bleed
// background with a fade), so growing the photo can never encroach on or
// compress the text: the two live in separate, fixed layout regions.
// Falls back to the icon + color wash exactly as before when there is no
// photo yet or it fails to load.
function CategoryPhotoBlock({
  uri, icon, colorTheme,
}: { uri: string | null; icon: keyof typeof Ionicons.glyphMap; colorTheme: string }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={styles.photoBlock}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <View style={[styles.photoBlock, styles.photoBlockFallback, { backgroundColor: `${colorTheme}1f` }]}>
      <Ionicons name={icon} size={30} color={colorTheme} />
    </View>
  );
}

export default function CurriculumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getCurriculumCatalog } = useData();
  const { profile } = useAuth();
  const [catalog, setCatalog] = useState<CurriculumCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setCatalog(await getCurriculumCatalog(profile?.id));
    setLoading(false);
  }, [getCurriculumCatalog, profile?.id]);

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
          Kingdom School opens one journey at a time, starting with Peer-to-Peer Orientation. Complete a category to unlock the next.
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
                style={[styles.currCard, item.isLocked && styles.currCardLocked]}
                onPress={() => router.push(`/curriculum/${item.id}` as any)}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.description}. ${countsLabel}. ${item.isLocked ? "Locked — complete the current category first." : "Tap to open."}`}
              >
                <View style={styles.cardContent}>
                  <Text style={styles.currTitle}>{item.title}</Text>
                  <Text style={styles.currDesc} numberOfLines={3}>{item.description}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name={item.isLocked ? "lock-closed" : "book-outline"} size={13} color={colors.textMuted} />
                    <Text style={styles.metaText}>{item.isLocked ? "Locked — complete the current category first" : countsLabel}</Text>
                  </View>
                </View>

                {/* A dedicated block, not an overlapping background — the
                    text column above is never affected no matter how large
                    this photo is. */}
                <View style={styles.photoWrap}>
                  <CategoryPhotoBlock uri={item.coverImage} icon={icon} colorTheme={item.colorTheme} />
                  {item.isLocked && (
                    <View style={styles.categoryLockOverlay} accessibilityElementsHidden importantForAccessibility="no">
                      <Ionicons name="lock-closed" size={22} color="#fff" />
                    </View>
                  )}
                  {/* The arrow is a visual affordance, never the only signal
                      that this card is tappable — the whole card carries an
                      accessibilityRole of "button" with a full descriptive
                      label above, and the entire card surface (not just the
                      arrow) is the touch target. */}
                  <View style={styles.arrowBadge} accessibilityElementsHidden importantForAccessibility="no">
                    <Ionicons name="chevron-forward" size={18} color={colors.textDark} />
                  </View>
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
    flexDirection: "row", minHeight: 168, borderRadius: 20, overflow: "hidden",
    borderWidth: 1, borderColor: colors.borderBeige,
    marginBottom: 14, backgroundColor: colors.card,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  // A fixed, protected text column — its width never changes no matter how
  // the photo block next to it is sized, so the photo can be made as large
  // as the design wants without ever compressing or wrapping the text.
  cardContent: { flex: 1, padding: 18, justifyContent: "center" },
  currTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
  currDesc: { fontSize: 13, color: colors.textMid, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 10 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  // The photo's own dedicated region — large and square-ish, taking up the
  // maximum width the card can spare on the right without shrinking
  // cardContent below.
  photoWrap: { width: 148, alignSelf: "stretch" },
  photoBlock: { width: "100%", height: "100%" },
  photoBlockFallback: { alignItems: "center", justifyContent: "center" },
  currCardLocked: { opacity: 0.65 },
  categoryLockOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center",
  },
  arrowBadge: {
    position: "absolute", top: 12, right: 12, width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center",
  },
});