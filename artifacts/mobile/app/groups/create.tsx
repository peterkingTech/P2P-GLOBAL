import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import PeoplePicker from "@/components/messages/PeoplePicker";
import { createCommunity, createGroup } from "@/lib/groupsApi";
import type { MailPerson } from "@/lib/mailApi";

// New private group, a group inside a community (?communityId=…&communityName=…), or a new community
// (?kind=community). Always private: only the people added (or who accept an invitation) can see it.
export default function CreateGroup() {
  const p = useLocalSearchParams<{ kind?: string; communityId?: string; communityName?: string }>();
  const community = p.kind === "community";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<MailPerson[]>([]);
  const [adminsOnly, setAdminsOnly] = useState(false);
  const [announcements, setAnnouncements] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      if (community) {
        const r = await createCommunity({ name: name.trim(), description: description.trim() || undefined, memberIds: people.map((x) => x.id), announcements });
        router.replace(`/groups/community/${r.id}` as any);
      } else {
        const r = await createGroup({ name: name.trim(), description: description.trim() || undefined, memberIds: people.map((x) => x.id), communityId: p.communityId ? String(p.communityId) : null, posting: adminsOnly ? "admins" : "everyone" });
        router.replace(`/messages/${r.id}` as any);
      }
    } catch (e: any) { setError(e?.message ?? "That didn't work. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={[s.screen, { paddingTop: insets.top + 4 }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <IconButton icon="close" accessibilityLabel="Close" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title}>{community ? "New community" : p.communityName ? `New group in ${p.communityName}` : "New group"}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 110 }} keyboardShouldPersistTaps="handled">
        <View style={s.privacy}>
          <Ionicons name="lock-closed" size={16} color={c.primaryGreen} />
          <Text style={s.privacyText}>{community
            ? "Private. Only its members can see it. Belonging to the community doesn't give access to its groups — each group has its own members."
            : "Private. Only the people in it can see it, its members and its messages. It never appears in Discover or search."}</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder={community ? "e.g. Grace Church Community" : "e.g. Youth Fellowship"} placeholderTextColor={c.textMuted} style={s.input} maxLength={80} accessibilityLabel="Name" />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Description (optional)</Text>
          <TextInput value={description} onChangeText={setDescription} placeholder="What is it for?" placeholderTextColor={c.textMuted} style={[s.input, { minHeight: 80, textAlignVertical: "top" }]} multiline maxLength={1000} accessibilityLabel="Description" />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>{community ? "Members" : "Add members"}</Text>
          {p.communityId ? <Text style={s.hint}>Only members of {p.communityName ?? "the community"} can be added.</Text> : null}
          <PeoplePicker value={people} onChange={setPeople} max={100} />
        </View>
        {community ? (
          <TouchableOpacity style={s.option} onPress={() => setAnnouncements((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: announcements }}>
            <Ionicons name={announcements ? "checkbox" : "square-outline"} size={22} color={c.accentGreen} />
            <View style={{ flex: 1 }}><Text style={s.optionTitle}>Announcements group</Text><Text style={s.hint}>Every member reads it; only administrators post.</Text></View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.option} onPress={() => setAdminsOnly((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: adminsOnly }}>
            <Ionicons name={adminsOnly ? "checkbox" : "square-outline"} size={22} color={c.accentGreen} />
            <View style={{ flex: 1 }}><Text style={s.optionTitle}>Only administrators can post</Text><Text style={s.hint}>Members can read. You can change this later.</Text></View>
          </TouchableOpacity>
        )}
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 10 }]}>
        <AppButton label={community ? "Create community" : "Create group"} onPress={create} loading={busy} disabled={!name.trim() || busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    privacy: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    privacyText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    label: { fontSize: 12, letterSpacing: 0.5, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    input: { minHeight: 46, fontSize: 15.5, color: c.textDark, fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.card },
    hint: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    option: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 4 },
    optionTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium" },
    footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderBeige, backgroundColor: c.card },
  });
}
