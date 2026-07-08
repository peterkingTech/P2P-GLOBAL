import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PrayerRequest } from "@/contexts/DataContext";
import colors from "@/constants/colors";

function PrayerCard({ item, onPray }: { item: PrayerRequest; onPray: (id: string) => void }) {
  return (
    <View style={styles.prayerCard}>
      <View style={styles.prayerHeader}>
        <View style={styles.prayerAvatar}>
          <Text style={styles.prayerAvatarText}>{item.userName.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.prayerName}>{item.userName}</Text>
          {item.nation && (
            <Text style={styles.prayerNation}>{item.nation}</Text>
          )}
        </View>
        <Text style={styles.prayerCount}>{item.prayerCount}</Text>
      </View>
      <Text style={styles.prayerText}>{item.text}</Text>
      <TouchableOpacity
        style={[styles.prayBtn, item.hasPrayed && styles.prayBtnActive]}
        onPress={() => {
          if (!item.hasPrayed) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onPray(item.id);
          }
        }}
        activeOpacity={0.8}
        disabled={!!item.hasPrayed}
      >
        <Ionicons
          name={item.hasPrayed ? "heart" : "heart-outline"}
          size={15}
          color={item.hasPrayed ? colors.upperRoomAmber : colors.upperRoomMuted}
        />
        <Text style={[styles.prayBtnText, item.hasPrayed && styles.prayBtnTextActive]}>
          {item.hasPrayed ? "Prayed" : "Pray"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function PrayerTab() {
  const insets = useSafeAreaInsets();
  const { prayers, isLoading, addPrayer, prayForRequest } = useData();

  const [prayerText, setPrayerText] = useState("");
  const [nation, setNation] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  async function handleSubmitPrayer() {
    if (!prayerText.trim()) return;
    setSubmitting(true);
    await addPrayer(prayerText.trim(), nation.trim() || undefined);
    setSubmitting(false);
    setPrayerText("");
    setNation("");
    setShowForm(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 20 }]}>
        <View>
          <Text style={styles.headerTitle}>Upper Room</Text>
          <Text style={styles.headerSub}>Pray as one body across nations</Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowForm((s) => !s)}
        >
          <Ionicons name={showForm ? "close" : "add"} size={22} color={colors.upperRoomCream} />
        </TouchableOpacity>
      </View>

      {/* Quick nav row */}
      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navCard}>
          <Ionicons name="radio" size={18} color={colors.upperRoomAmber} />
          <Text style={styles.navCardLabel}>Live Rooms</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navCard}>
          <Ionicons name="earth" size={18} color={colors.upperRoomAmber} />
          <Text style={styles.navCardLabel}>Nation Wall</Text>
        </TouchableOpacity>
      </View>

      {/* Add prayer form */}
      {showForm && (
        <View style={styles.form}>
          <TextInput
            style={styles.formInput}
            value={prayerText}
            onChangeText={setPrayerText}
            placeholder="Share your prayer request..."
            placeholderTextColor={colors.upperRoomMuted}
            multiline
            numberOfLines={3}
          />
          <TextInput
            style={[styles.formInput, { marginTop: 8 }]}
            value={nation}
            onChangeText={setNation}
            placeholder="Nation (optional)"
            placeholderTextColor={colors.upperRoomMuted}
          />
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmitPrayer}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.cream} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Submit Request</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Prayer Wall */}
      <Text style={styles.wallLabel}>Prayer Wall</Text>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.upperRoomAmber} />
        </View>
      ) : (
        <FlatList
          data={prayers}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PrayerCard item={item} onPray={prayForRequest} />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={prayers.length > 0}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="radio-outline" size={40} color={colors.upperRoomBorder} />
              <Text style={styles.emptyText}>No prayers yet. Be the first.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.upperRoomBg },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.upperRoomBorder,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colors.upperRoomCream, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, color: colors.upperRoomMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  addBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "rgba(224,164,65,0.15)",
    borderWidth: 1, borderColor: colors.upperRoomBorder,
    alignItems: "center", justifyContent: "center",
  },
  navRow: {
    flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.upperRoomBorder,
  },
  navCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10, borderWidth: 1, borderColor: colors.upperRoomBorder,
    paddingVertical: 10, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  navCardLabel: { fontSize: 12, fontWeight: "600", color: colors.upperRoomCream, fontFamily: "Inter_600SemiBold" },
  form: {
    margin: 16,
    padding: 14,
    backgroundColor: colors.upperRoomCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.upperRoomBorder,
  },
  formInput: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: colors.upperRoomBorder,
    borderRadius: 10, padding: 12,
    color: colors.upperRoomCream, fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  submitBtn: {
    backgroundColor: colors.upperRoomAmber,
    borderRadius: 10, height: 44,
    alignItems: "center", justifyContent: "center", marginTop: 10,
  },
  submitBtnText: { color: "#100B06", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  wallLabel: {
    fontSize: 13,
    color: colors.upperRoomMuted,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 16,
    paddingVertical: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 14 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { color: colors.upperRoomMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
  prayerCard: {
    backgroundColor: colors.upperRoomCard,
    borderRadius: 14, borderWidth: 1, borderColor: colors.upperRoomBorder,
    padding: 14, marginBottom: 10,
  },
  prayerHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  prayerAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(224,164,65,0.15)",
    borderWidth: 1, borderColor: colors.upperRoomBorder,
    alignItems: "center", justifyContent: "center",
  },
  prayerAvatarText: { fontSize: 14, fontWeight: "700", color: colors.upperRoomAmber, fontFamily: "Inter_700Bold" },
  prayerName: { fontSize: 13, fontWeight: "600", color: colors.upperRoomCream, fontFamily: "Inter_600SemiBold" },
  prayerNation: { fontSize: 11, color: colors.upperRoomMuted, fontFamily: "Inter_400Regular" },
  prayerCount: { fontSize: 13, color: colors.upperRoomAmber, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  prayerText: { fontSize: 14, color: colors.upperRoomCream, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: 12, opacity: 0.85 },
  prayBtn: {
    flexDirection: "row", gap: 6, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: "flex-start",
    borderWidth: 1, borderColor: colors.upperRoomBorder,
  },
  prayBtnActive: { backgroundColor: "rgba(224,164,65,0.12)", borderColor: "rgba(224,164,65,0.3)" },
  prayBtnText: { fontSize: 13, color: colors.upperRoomMuted, fontFamily: "Inter_500Medium" },
  prayBtnTextActive: { color: colors.upperRoomAmber },
});
