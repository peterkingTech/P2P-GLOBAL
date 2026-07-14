import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, DiscoverablePeer } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar } from "@/components/Avatar";
import SkillsMultiSelect from "@/components/SkillsMultiSelect";
import { skillLabel } from "@/constants/skillsTaxonomy";
import colors from "@/constants/colors";

export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { supabase } = useAuth();
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const { getDiscoverablePeers, reportContent } = useData();
  const [peers, setPeers] = useState<DiscoverablePeer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState<string[]>([]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);

  function handleReport(peer: DiscoverablePeer) {
    Alert.alert(
      `Report ${peer.fullName}?`,
      "Let a moderator know what's wrong with this profile. This won't notify them.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            const err = await reportContent("profile", peer.id, "Reported from discovery");
            Alert.alert(err ? "Couldn't send report" : "Reported", err || "A moderator will review this.");
          },
        },
      ]
    );
  }

  async function handleMessage(peer: DiscoverablePeer) {
    setMessaging(peer.id);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: peer.id });
      if (error || !data) {
        if (error?.message?.includes("age verification required")) {
          Alert.alert(
            "Add your date of birth",
            "Please add your date of birth in Settings before messaging other members.",
            [{ text: "Go to Settings", onPress: () => router.push("/settings") }, { text: "Cancel", style: "cancel" }]
          );
        } else if (error?.message?.includes("adult and minor accounts")) {
          Alert.alert("Can't message this person", "This conversation isn't available.");
        } else {
          Alert.alert(
            "Can't message yet",
            "You can message peers once you share a study group together, or once they've reached out for help."
          );
        }
        return;
      }
      router.push(`/messages/${data}` as any);
    } finally {
      setMessaging(null);
    }
  }

  const load = useCallback(async (q?: string, skills?: string[]) => {
    setLoading(true);
    setPeers(await getDiscoverablePeers(q, skills));
    setLoading(false);
  }, [getDiscoverablePeers]);

  useEffect(() => { load(search, skillFilter); }, [skillFilter, load]);

  return (
    <>
      <Stack.Screen options={{ title: "Discovery Search" }} />
      <View style={styles.container}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => load(search, skillFilter)}
            returnKeyType="search"
          />
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.skillFilterBtn} onPress={() => setSkillPickerOpen(true)}>
            <Ionicons name="options-outline" size={14} color={colors.accentGreen} />
            <Text style={styles.skillFilterBtnText}>
              {skillFilter.length > 0 ? `Skills (${skillFilter.length})` : "Filter by skill"}
            </Text>
          </TouchableOpacity>
          {skillFilter.length > 0 && (
            <TouchableOpacity onPress={() => setSkillFilter([])}>
              <Text style={styles.clearFilterText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        {skillFilter.length > 0 && (
          <View style={styles.chipsWrap}>
            {skillFilter.map((s) => (
              <View key={s} style={styles.skillChip}>
                <Text style={styles.skillChipText}>{skillLabel(s)}</Text>
              </View>
            ))}
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primaryGreen} />
        ) : (
          <FlatList
            data={peers}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 60 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>No study partners found.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.row, item.id === highlight && styles.rowHighlight]}>
                <Avatar photoUrl={item.photoUrl} name={item.fullName} size={44} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.fullName}</Text>
                  <Text style={styles.meta}>{item.country || "Unknown location"} · {item.role}</Text>
                  {item.skills.length > 0 && (
                    <Text style={styles.skillsMeta} numberOfLines={1}>
                      {item.skills.slice(0, 3).map(skillLabel).join(", ")}
                    </Text>
                  )}
                </View>
                <TouchableOpacity style={styles.reportBtn} onPress={() => handleReport(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="flag-outline" size={15} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.msgBtn} onPress={() => handleMessage(item)} disabled={messaging === item.id}>
                  {messaging === item.id ? (
                    <ActivityIndicator size="small" color={colors.accentGreen} />
                  ) : (
                    <Ionicons name="chatbubble-outline" size={18} color={colors.accentGreen} />
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <SkillsMultiSelect
        visible={skillPickerOpen}
        initialSelected={skillFilter}
        onClose={() => setSkillPickerOpen(false)}
        onSave={(selected) => {
          setSkillFilter(selected);
          setSkillPickerOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, margin: 20, marginBottom: 0,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  filterRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 20, marginTop: 10,
  },
  skillFilterBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  skillFilterBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  clearFilterText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: 20, marginTop: 8 },
  skillChip: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  skillChipText: { fontSize: 11, color: colors.textDark, fontFamily: "Inter_500Medium" },
  skillsMeta: { fontSize: 11, color: colors.accentGreen, marginTop: 2, fontFamily: "Inter_500Medium" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  rowHighlight: { borderColor: colors.primaryGreen, borderWidth: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  msgBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(29,158,117,0.08)" },
  reportBtn: { padding: 4 },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
