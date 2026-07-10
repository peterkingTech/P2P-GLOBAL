import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, Fruit } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const LOCKED_FRUITS = [
  { id: "f4", name: "Nation Intercessor", description: "Pray for 10 different nations", iconName: "earth" },
  { id: "f5", name: "Deep Root", description: "Complete a full curriculum module", iconName: "git-branch" },
  { id: "f6", name: "Light Bearer", description: "Invite 3 peers to the network", iconName: "sunny" },
  { id: "f7", name: "Harvest Ready", description: "Disciple your first peer to level 2", iconName: "leaf" },
];

function FruitBadge({ fruit, locked = false }: { fruit: Fruit | typeof LOCKED_FRUITS[0]; locked?: boolean }) {
  return (
    <View style={[styles.fruitCard, locked && styles.fruitCardLocked]}>
      <View style={[styles.fruitIcon, { opacity: locked ? 0.3 : 1, backgroundColor: locked ? colors.borderBeige : "rgba(247,201,72,0.2)" }]}>
        <Ionicons
          name={fruit.iconName as any}
          size={30}
          color={locked ? colors.textMuted : colors.brightYellow}
        />
      </View>
      <Text style={[styles.fruitName, locked && styles.fruitNameLocked]}>
        {fruit.name}
      </Text>
      <Text style={[styles.fruitDesc, locked && styles.fruitDescLocked]}>
        {fruit.description}
      </Text>
      {!locked && "earnedAt" in fruit && (
        <View style={styles.earnedTag}>
          <Text style={styles.earnedTagText}>Earned</Text>
        </View>
      )}
      {locked && (
        <View style={styles.lockedTag}>
          <Ionicons name="lock-closed" size={10} color={colors.textMuted} />
          <Text style={styles.lockedTagText}>Locked</Text>
        </View>
      )}
    </View>
  );
}

export default function FruitScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fruits } = useData();

  const allFruits: Array<Fruit | typeof LOCKED_FRUITS[0]> = [...fruits, ...LOCKED_FRUITS];

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Fruit Collection</Text>
      </View>

      <View style={styles.earnedSummary}>
        <View style={styles.earnedNum}>
          <Text style={styles.earnedNumText}>{fruits.length}</Text>
        </View>
        <View>
          <Text style={styles.earnedLabel}>Fruits Earned</Text>
          <Text style={styles.earnedSublabel}>{LOCKED_FRUITS.length} more to unlock</Text>
        </View>
      </View>

      <FlatList
        data={allFruits}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item }) => (
          <FruitBadge
            fruit={item}
            locked={!("earnedAt" in item)}
          />
        )}
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: insets.bottom + 40 },
        ]}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
      />
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
  earnedSummary: {
    flexDirection: "row", alignItems: "center", gap: 14,
    margin: 16, padding: 16,
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  earnedNum: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(247,201,72,0.15)",
    borderWidth: 2, borderColor: "rgba(247,201,72,0.4)",
    alignItems: "center", justifyContent: "center",
  },
  earnedNumText: { fontSize: 22, fontWeight: "700", color: colors.brightYellow, fontFamily: "Inter_700Bold" },
  earnedLabel: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  earnedSublabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  grid: { paddingHorizontal: 12, paddingTop: 4 },
  row: { gap: 10, marginBottom: 10, paddingHorizontal: 4 },
  fruitCard: {
    flex: 1, backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, alignItems: "center", gap: 6, position: "relative",
  },
  fruitCardLocked: { backgroundColor: colors.cardBeige },
  fruitIcon: {
    width: 60, height: 60, borderRadius: 20,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  fruitName: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  fruitNameLocked: { color: colors.textMuted },
  fruitDesc: { fontSize: 11, color: colors.textMid, textAlign: "center", lineHeight: 16, fontFamily: "Inter_400Regular" },
  fruitDescLocked: { color: colors.borderBeige },
  earnedTag: {
    position: "absolute", top: 8, right: 8,
    backgroundColor: "rgba(29,158,117,0.15)",
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  earnedTagText: { fontSize: 9, color: colors.accentGreen, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  lockedTag: {
    flexDirection: "row", gap: 3, alignItems: "center",
    backgroundColor: colors.borderBeige,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  lockedTagText: { fontSize: 9, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
