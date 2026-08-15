import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function ChurchPrivacySettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchCreator, updateChurch, loadUserChurch } = useData();
  const [locationHidden, setLocationHidden] = useState(userChurch?.locationHidden ?? false);
  const [saving, setSaving] = useState(false);

  async function handleToggle(value: boolean) {
    if (!userChurch || !isChurchCreator) return;
    setLocationHidden(value);
    setSaving(true);
    const { error } = await updateChurch(userChurch.id, { locationHidden: value });
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error); setLocationHidden(!value); return; }
    await loadUserChurch();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!isChurchCreator && (
          <View style={styles.lockBanner}>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <Text style={styles.lockBannerText}>Only the General Overseer can change this.</Text>
          </View>
        )}

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Physical location not publicly displayed</Text>
            <Text style={styles.rowDesc}>Your city and country stay on file, but won't be shown on the church's public profile.</Text>
          </View>
          <Switch
            value={locationHidden}
            onValueChange={handleToggle}
            disabled={!isChurchCreator || saving}
            trackColor={{ true: colors.accentGreen }}
          />
        </View>

        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>Member Profile Visibility</Text>
        <Text style={styles.helperText}>
          Individual members control whether their own progress is visible to church leadership from their own church settings — this is a per-member choice, not something the General Overseer sets church-wide.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { padding: 20, paddingBottom: 60 },
  lockBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  lockBannerText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14,
  },
  rowTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  rowDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  divider: { height: 1, backgroundColor: colors.borderBeige, marginVertical: 24 },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textDark, marginBottom: 6, fontFamily: "Inter_700Bold" },
  helperText: { fontSize: 12, color: colors.textMuted, lineHeight: 18, fontFamily: "Inter_400Regular" },
});