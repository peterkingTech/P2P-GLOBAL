import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

const HALL_MEMBERS = [
  { id: "h1", name: "Emmanuel K.", nation: "Ghana", level: 5, role: "Elder", sessions: 142, disciples: 8 },
  { id: "h2", name: "Sister Ruth M.", nation: "Kenya", level: 5, role: "Mentor", sessions: 98, disciples: 5 },
  { id: "h3", name: "Pastor David L.", nation: "South Korea", level: 5, role: "Elder", sessions: 211, disciples: 12 },
  { id: "h4", name: "Grace A.", nation: "Nigeria", level: 4, role: "Mentor", sessions: 67, disciples: 3 },
  { id: "h5", name: "Maria G.", nation: "Brazil", level: 4, role: "Mentor", sessions: 54, disciples: 4 },
];

export default function HallOfFaithScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.cream} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hall of Faith</Text>
      </View>

      <View style={styles.subheader}>
        <Ionicons name="trophy" size={20} color={colors.brightYellow} />
        <Text style={styles.subheaderText}>
          Disciples who have borne much fruit across the nations
        </Text>
      </View>

      <FlatList
        data={HALL_MEMBERS}
        keyExtractor={(m) => m.id}
        renderItem={({ item, index }) => (
          <View style={styles.memberCard}>
            <View style={styles.rankBadge}>
              <Text style={styles.rankText}>#{index + 1}</Text>
            </View>
            <View style={[styles.memberAvatar, { borderColor: index === 0 ? colors.brightYellow : index === 1 ? "#C0C0C0" : index === 2 ? "#CD7F32" : colors.navBorder }]}>
              <Text style={styles.memberInitial}>{item.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{item.name}</Text>
              <View style={styles.memberMeta}>
                <Ionicons name="earth-outline" size={11} color={colors.upperRoomMuted} />
                <Text style={styles.memberNation}>{item.nation}</Text>
                <View style={styles.rolePill}>
                  <Text style={styles.roleText}>{item.role}</Text>
                </View>
              </View>
            </View>
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{item.sessions}</Text>
                <Text style={styles.statLabel}>sessions</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{item.disciples}</Text>
                <Text style={styles.statLabel}>disciples</Text>
              </View>
            </View>
          </View>
        )}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.upperRoomBg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.upperRoomBorder,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.upperRoomCream, fontFamily: "Inter_700Bold" },
  subheader: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.upperRoomBorder,
  },
  subheaderText: { flex: 1, fontSize: 13, color: colors.upperRoomMuted, lineHeight: 20, fontFamily: "Inter_400Regular" },
  list: { paddingHorizontal: 14, paddingTop: 14 },
  memberCard: {
    backgroundColor: colors.upperRoomCard,
    borderRadius: 14, borderWidth: 1, borderColor: colors.upperRoomBorder,
    padding: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10,
  },
  rankBadge: { width: 24, alignItems: "center" },
  rankText: { fontSize: 13, fontWeight: "700", color: colors.upperRoomAmber, fontFamily: "Inter_700Bold" },
  memberAvatar: {
    width: 42, height: 42, borderRadius: 21,
    borderWidth: 2,
    backgroundColor: "rgba(224,164,65,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  memberInitial: { fontSize: 16, fontWeight: "700", color: colors.upperRoomAmber, fontFamily: "Inter_700Bold" },
  memberName: { fontSize: 14, fontWeight: "600", color: colors.upperRoomCream, fontFamily: "Inter_600SemiBold" },
  memberMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  memberNation: { fontSize: 11, color: colors.upperRoomMuted, fontFamily: "Inter_400Regular" },
  rolePill: {
    backgroundColor: "rgba(224,164,65,0.15)",
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1,
  },
  roleText: { fontSize: 10, color: colors.upperRoomAmber, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  stats: { flexDirection: "row", gap: 12 },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 15, fontWeight: "700", color: colors.upperRoomCream, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 9, color: colors.upperRoomMuted, fontFamily: "Inter_400Regular" },
});
