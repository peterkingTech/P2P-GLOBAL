import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { useData } from "@/contexts/DataContext";

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { blockedUsers, refreshBlockedUsers, unblockUser } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  useEffect(() => {
    refreshBlockedUsers().finally(() => setLoading(false));
  }, [refreshBlockedUsers]);

  async function handleUnblock(blockedId: string) {
    setUnblockingId(blockedId);
    try {
      await unblockUser(blockedId);
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Blocked Users" />
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : blockedUsers.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="shield-checkmark-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => { if (item.username) router.push(`/profile/${item.username}` as any); }}
              >
                <Text style={styles.rowName}>{item.fullName}</Text>
                {item.username && <Text style={styles.rowUsername}>@{item.username}</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.unblockBtn}
                onPress={() => handleUnblock(item.userId)}
                disabled={unblockingId === item.userId}
              >
                {unblockingId === item.userId ? (
                  <ActivityIndicator size="small" color={colors.accentGreen} />
                ) : (
                  <Text style={styles.unblockBtnText}>Unblock</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 30 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    row: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 12, padding: 14,
    },
    rowName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowUsername: { fontSize: 12, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    unblockBtn: {
      borderWidth: 1, borderColor: c.accentGreen, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 8, minWidth: 78, alignItems: "center",
    },
    unblockBtnText: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
  });
}
