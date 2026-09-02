import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, CurriculumCatalogItem } from "@/contexts/DataContext";
import colors from "@/constants/colors";

// Curriculum redesign — a library of stand-alone journeys, not a numbered
// staircase. No "Level 1/2/3", no locked-until-you-finish-the-last-one
// gating between curricula: each is independent, and a learner can move
// between them in any order. Categories with no real content yet show as
// "Coming Soon" (no fabricated lessons) rather than being hidden outright,
// so the full intended shape of the curriculum is visible even before
// every category is built out.
type CatalogEntry = CurriculumCatalogItem & { icon: keyof typeof Ionicons.glyphMap; comingSoon?: false };
type ComingSoonEntry = { id: string; title: string; description: string; icon: keyof typeof Ionicons.glyphMap; comingSoon: true };

// Categories this redesign intentionally leaves for a future, dedicated
// pass (see the session's product decision) — shown so the full intended
// shape of "P2P Global Curriculum" is visible, never populated with
// invented lesson content.
const COMING_SOON: ComingSoonEntry[] = [
  { id: "coming-soon-bible", title: "The Bible", description: "Understand, read, interpret, and live according to Scripture.", icon: "book-outline", comingSoon: true },
  { id: "coming-soon-prayer", title: "Prayer & Communion with God", description: "Develop a deeper relationship with God through prayer.", icon: "hand-left-outline", comingSoon: true },
  { id: "coming-soon-spirit", title: "The Holy Spirit", description: "Know the person and work of the Holy Spirit and learn to walk by the Spirit.", icon: "flame-outline", comingSoon: true },
  { id: "coming-soon-growth", title: "Spiritual Growth & Transformation", description: "Become increasingly like Christ through repentance, holiness, and spiritual disciplines.", icon: "leaf-outline", comingSoon: true },
  { id: "coming-soon-relationships", title: "Christian Relationships & Community", description: "Live faithfully with other believers, family, friends, and church.", icon: "people-outline", comingSoon: true },
  { id: "coming-soon-discipleship", title: "Discipleship", description: "Following Jesus, being discipled, discipling others, and generational growth.", icon: "git-network-outline", comingSoon: true },
  { id: "coming-soon-mission", title: "Kingdom Life & Mission", description: "Live for God's Kingdom through mission, evangelism, service, and calling.", icon: "globe-outline", comingSoon: true },
  { id: "coming-soon-leadership", title: "Christian Leadership", description: "Servant leadership, responsibility, stewardship, and Kingdom leadership.", icon: "compass-outline", comingSoon: true },
];

function iconForTitle(title: string): keyof typeof Ionicons.glyphMap {
  if (title.includes("Peer-to-Peer") || title.includes("Orientation")) return "people-circle-outline";
  if (title.includes("Gospel")) return "sunny-outline";
  if (title.includes("Identity")) return "person-outline";
  return "library-outline";
}

export default function CurriculumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getCurriculumCatalog } = useData();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await getCurriculumCatalog();
    setCatalog(rows.map((r) => ({ ...r, icon: iconForTitle(r.title) })));
    setLoading(false);
  }, [getCurriculumCatalog]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const data: (CatalogEntry | ComingSoonEntry)[] = [...catalog, ...COMING_SOON];

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            if (item.comingSoon) {
              return (
                <View style={[styles.currCard, styles.currCardComingSoon]}>
                  <View style={styles.cardTop}>
                    <View style={styles.iconBadgeMuted}>
                      <Ionicons name={item.icon} size={20} color={colors.textMuted} />
                    </View>
                    <View style={styles.comingSoonPill}>
                      <Text style={styles.comingSoonPillText}>Coming Soon</Text>
                    </View>
                  </View>
                  <Text style={styles.currTitleMuted}>{item.title}</Text>
                  <Text style={styles.currDesc}>{item.description}</Text>
                </View>
              );
            }
            return (
              <TouchableOpacity
                style={styles.currCard}
                onPress={() => router.push(`/curriculum/${item.id}` as any)}
                activeOpacity={0.85}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.iconBadge, { backgroundColor: `${item.colorTheme}1f` }]}>
                    <Ionicons name={item.icon} size={20} color={item.colorTheme} />
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
                <Text style={styles.currTitle}>{item.title}</Text>
                <Text style={styles.currDesc} numberOfLines={2}>{item.description}</Text>
                <Text style={styles.metaText}>
                  {item.moduleCount} {item.moduleCount === 1 ? "module" : "modules"} · {item.lessonCount} {item.lessonCount === 1 ? "lesson" : "lessons"}
                </Text>
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
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 12,
  },
  currCardComingSoon: { opacity: 0.6 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconBadgeMuted: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.borderBeige },
  comingSoonPill: { backgroundColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  comingSoonPillText: { fontSize: 11, color: colors.textMuted, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  currTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  currTitleMuted: { fontSize: 16, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", marginBottom: 4 },
  currDesc: { fontSize: 13, color: colors.textMuted, lineHeight: 20, fontFamily: "Inter_400Regular", marginBottom: 8 },
  metaText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
