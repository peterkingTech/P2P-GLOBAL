import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Platform, Modal, FlatList } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchSocialAccountData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";
const SOCIAL_PLATFORMS = [
  { value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" }, { value: "tiktok", label: "TikTok" },
  { value: "x_twitter", label: "X (Twitter)" }, { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" }, { value: "website", label: "Website" }, { value: "other", label: "Other" },
];
const MAX_SOCIAL_ACCOUNTS = 8;

export default function ChurchSocialMediaSettingsScreen() {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchCreator, getSocialAccounts, updateSocialAccounts } = useData();
  const [accounts, setAccounts] = useState<ChurchSocialAccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    const data = await getSocialAccounts(userChurch.id);
    setAccounts(data.map((a) => ({ platform: a.platform, handleOrUrl: a.handleOrUrl })));
    setLoading(false);
  }, [userChurch, getSocialAccounts]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function addRow() {
    if (accounts.length >= MAX_SOCIAL_ACCOUNTS) return;
    setAccounts((prev) => [...prev, { platform: "instagram", handleOrUrl: "" }]);
  }
  function updateRow(i: number, patch: Partial<ChurchSocialAccountData>) {
    setAccounts((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function removeRow(i: number) {
    setAccounts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!userChurch) return;
    const cleaned = accounts.filter((a) => a.handleOrUrl.trim());
    setSaving(true);
    const error = await updateSocialAccounts(userChurch.id, cleaned);
    setSaving(false);
    if (error) { showAlert("Couldn't save", error); return; }
    showAlert("Saved", "Social media accounts updated.");
    load();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Social Media</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!isChurchCreator && (
          <View style={styles.lockBanner}>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <Text style={styles.lockBannerText}>Only the Church Leader can change this.</Text>
          </View>
        )}
        <Text style={styles.helperText}>Add the social media accounts your church would like members to see on its P2P church profile.</Text>

        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} />
        ) : accounts.length === 0 ? (
          <Text style={styles.emptyText}>No social media accounts added.</Text>
        ) : (
          accounts.map((a, i) => (
            <View key={i} style={styles.row}>
              <AppButton label={`${SOCIAL_PLATFORMS.find((p) => p.value === a.platform)?.label ?? a.platform}`} onPress={() => setPickerOpenFor(i)} variant="secondary" icon="chevron-down" iconPosition="trailing" disabled={!isChurchCreator} palette="fixedLight" />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={a.handleOrUrl}
                onChangeText={(v) => updateRow(i, { handleOrUrl: v })}
                editable={isChurchCreator}
                placeholder="@examplechurch"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />
              {isChurchCreator && (
                <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={() => removeRow(i)}><Ionicons name="close-circle" size={22} color={colors.textMuted} /></TouchableOpacity>
              )}
            </View>
          ))
        )}

        {isChurchCreator && accounts.length < MAX_SOCIAL_ACCOUNTS && (
          <AppButton label="Add Social Media Account" onPress={addRow} variant="tertiary" icon="add" style={{ marginTop: 4, marginBottom: 20 }} palette="fixedLight" />
        )}

        {isChurchCreator && (
          <AppButton label="Save Changes" onPress={handleSave} size="lg" disabled={saving} loading={saving} palette="fixedLight" />
        )}
      </ScrollView>

      <Modal visible={pickerOpenFor !== null} animationType="slide" transparent onRequestClose={() => setPickerOpenFor(null)}>
        <TouchableOpacity accessibilityRole="button" style={styles.modalOverlay} activeOpacity={1} onPress={() => setPickerOpenFor(null)}>
          <View style={[styles.modalSheet, sheetWidth]}>
            <Text style={styles.modalTitle}>Platform</Text>
            <FlatList
              data={SOCIAL_PLATFORMS}
              keyExtractor={(o) => o.value}
              renderItem={({ item }) => (
                <TouchableOpacity accessibilityRole="button"
                  style={styles.optionRow}
                  onPress={() => { if (pickerOpenFor !== null) updateRow(pickerOpenFor, { platform: item.value }); setPickerOpenFor(null); }}
                >
                  <Text style={styles.optionRowText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
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
  helperText: { fontSize: 12, color: colors.textMuted, marginBottom: 16, fontFamily: "Inter_400Regular" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginVertical: 20, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "60%", width: "100%", alignSelf: "center" },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, marginBottom: 10, fontFamily: "Inter_700Bold" },
  optionRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  optionRowText: { color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
});