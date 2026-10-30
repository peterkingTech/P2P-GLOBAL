import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useData } from "@/contexts/DataContext";
import { getMyFamilies, FAMILY_ROLE_LABELS, type MyFamiliesResponse } from "@/lib/familyApi";
import { AppButton, IconButton } from "@/components/ui";
import StudyTogetherLink from "@/components/learning/StudyTogetherLink";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";

// My Community — one overview of the communities a person belongs to: their
// Family Circles, their church, where Gatherings happen and each community's
// Learning. It only points into the existing screens (family hub, church hub,
// Gatherings, community Learning, Study Together); membership, permissions,
// messages and calls stay exactly where they were. Home shows a short summary
// that opens this screen.
export default function MyCommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { contentMaxWidth } = useLayout();
  const { userChurch } = useData();
  const [families, setFamilies] = useState<MyFamiliesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    getMyFamilies().then((r) => { setFamilies(r); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const go = (route: any) => () => router.push(route);
  const learning = (scope: "family" | "church", groupId: string) => go({ pathname: "/learning/[scope]/[groupId]", params: { scope, groupId } });

  return (
    <View style={[s.screen, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 8) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }, centeredMaxWidth(contentMaxWidth)]}>
        <View style={s.header}>
          <IconButton icon="arrow-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as any))} accessibilityLabel="Back" color={c.textDark} />
          <Text style={s.title} accessibilityRole="header">My Community</Text>
        </View>
        <Text style={s.subtitle}>Your Family Circles and church — gatherings, learning and studies together.</Text>

        {/* My Families */}
        <View style={s.sectionRow}>
          <Text style={s.section} accessibilityRole="header">My Families</Text>
          <AppButton label="Manage" onPress={go("/family")} variant="tertiary" icon="chevron-forward" iconPosition="trailing" accessibilityLabel="Manage my Family Circles" />
        </View>
        {!families && !failed ? <ActivityIndicator color={c.accentGreen} style={{ marginVertical: 12 }} accessibilityLabel="Loading your families" />
          : failed ? <Text style={s.meta}>Your Family Circles couldn't load. Pull down on Family Circle to try again.</Text>
          : families!.families.length === 0 ? (
            <View style={s.card}>
              <Text style={s.meta}>You're not in a Family Circle yet.{families!.pendingInvitations.length ? ` You have ${families!.pendingInvitations.length} invitation${families!.pendingInvitations.length === 1 ? "" : "s"} waiting.` : ""}</Text>
              <AppButton label={families!.pendingInvitations.length ? "See invitations" : "Start or join a Family Circle"} onPress={go("/family")} variant="secondary" style={{ marginTop: 10 }} />
            </View>
          ) : (
            <>
              {families!.pendingInvitations.length > 0 && (
                <TouchableOpacity style={s.notice} onPress={go("/family")} accessibilityRole="button">
                  <Ionicons name="mail-unread-outline" size={16} color={c.accentGreen} />
                  <Text style={[s.meta, { flex: 1, color: c.textDark }]}>{families!.pendingInvitations.length} Family Circle invitation{families!.pendingInvitations.length === 1 ? "" : "s"} waiting</Text>
                  <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                </TouchableOpacity>
              )}
              {families!.families.map(({ family, myRole, memberCount }) => (
                <View key={family.id} style={s.card}>
                  <TouchableOpacity style={s.cardHead} onPress={go({ pathname: "/family/[familyId]", params: { familyId: family.id } })} accessibilityRole="button"
                    accessibilityLabel={`${family.name}. ${memberCount} ${memberCount === 1 ? "person" : "people"}. You are ${FAMILY_ROLE_LABELS[myRole] ?? myRole}. Opens the family`}>
                    <Ionicons name="home-outline" size={20} color={c.accentGreen} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle} numberOfLines={1}>{family.name}</Text>
                      <Text style={s.meta}>{memberCount} {memberCount === 1 ? "person" : "people"} · {FAMILY_ROLE_LABELS[myRole] ?? myRole}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                  </TouchableOpacity>
                  <View style={s.actions}>
                    <AppButton label="Gathering" onPress={go({ pathname: "/family/[familyId]", params: { familyId: family.id } })} variant="secondary" size="sm" icon="videocam-outline" accessibilityLabel={`Start or join a Gathering in ${family.name}`} />
                    <AppButton label="Learning" onPress={learning("family", family.id)} variant="secondary" size="sm" icon="school-outline" accessibilityLabel={`${family.name} Learning`} />
                  </View>
                </View>
              ))}
            </>
          )}

        {/* My Church */}
        <Text style={[s.section, { marginTop: 22 }]} accessibilityRole="header">My Church</Text>
        {userChurch ? (
          <View style={s.card}>
            <TouchableOpacity style={s.cardHead} onPress={go("/church")} accessibilityRole="button" accessibilityLabel={`${userChurch.name}. Opens your church`}>
              <Ionicons name="business-outline" size={20} color={c.accentGreen} />
              <Text style={[s.cardTitle, { flex: 1 }]} numberOfLines={1}>{userChurch.name}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
            <View style={s.actions}>
              <AppButton label="Gatherings" onPress={go("/church/calls")} variant="secondary" size="sm" icon="call-outline" accessibilityLabel={`${userChurch.name} Gatherings`} />
              <AppButton label="Learning" onPress={learning("church", userChurch.id)} variant="secondary" size="sm" icon="school-outline" accessibilityLabel={`${userChurch.name} Learning`} />
            </View>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.meta}>You haven't joined a church on P2P yet.</Text>
            <View style={s.actions}>
              <AppButton label="Join with Invite Code" onPress={go("/church/join")} variant="secondary" size="sm" />
              <AppButton label="Register a Church" onPress={go("/church/register")} variant="tertiary" size="sm" />
            </View>
          </View>
        )}

        {/* Community Learning */}
        <Text style={[s.section, { marginTop: 22 }]} accessibilityRole="header">Community Learning</Text>
        <StudyTogetherLink note="Studies shared in your families, church and with others" />
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -8 },
    title: { fontSize: 24, lineHeight: 30, color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 8 },
    section: { fontSize: 17, lineHeight: 23, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
    card: { padding: 14, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 10 },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    notice: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, marginBottom: 10 },
  });
}
