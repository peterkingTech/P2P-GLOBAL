import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { Avatar } from "@/components/Avatar";
import type { FamilyMember } from "@/lib/familyApi";
import {
  canRemoveMember, filterMembers, memberAccessibilityLabel, memberCountLabel, memberProfilePath,
  roleLabel, showSearch, sortMembers,
} from "@/lib/familyMembersModel";

interface Props {
  members: FamilyMember[] | null;
  myId: string | undefined;
  canManage: boolean;
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onOpenProfile: (path: string) => void;
  onRemove: (m: FamilyMember) => void;
  onRetry: () => void;
  // Optional: voice/video call buttons on everyone else's row, through the
  // app's existing call flow (the screen passes lib/callStart's startPeerCall).
  onCall?: (m: FamilyMember, callType: "audio" | "video") => void;
  callingUserId?: string | null;
}

// Presentational member list for one Family Circle. Data, permissions and
// actions come from the screen (app/family/members.tsx); this only renders.
export function FamilyMemberList({ members, myId, canManage, loading, error, query, onQueryChange, onOpenProfile, onRemove, onRetry, onCall, callingUserId }: Props) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  if (loading && !members) {
    return (
      <View style={styles.centered} accessibilityLabel="Loading people">
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }
  if (error && !members) {
    return (
      <View style={styles.errorBox} accessibilityRole="alert">
        <Ionicons name="cloud-offline-outline" size={22} color={c.textMuted} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const all = sortMembers(members ?? []);
  const shown = filterMembers(all, query);

  return (
    <View style={styles.section}>
      <Text style={styles.count} accessibilityRole="header">{memberCountLabel(all.length)}</Text>
      <Text style={styles.countSub}>in this Family Circle</Text>

      {showSearch(all.length) ? (
        <TextInput
          style={styles.search} value={query} onChangeText={onQueryChange} placeholder="Search by name or @username"
          placeholderTextColor={c.textMuted} autoCapitalize="none" accessibilityLabel="Search people"
        />
      ) : null}

      {all.length === 0 ? (
        <Text style={styles.empty}>No one is in this Family Circle yet.</Text>
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>No one matches “{query.trim()}”.</Text>
      ) : (
        shown.map((m) => {
          const isMe = m.userId === myId;
          const path = memberProfilePath(m);
          const role = roleLabel(m.role);
          const body = (
            <>
              <Avatar photoUrl={m.avatarUrl} name={m.name} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName} numberOfLines={1}>{m.name}{isMe ? " (You)" : ""}</Text>
                {role ? <Text style={styles.memberRole} numberOfLines={1}>{role}</Text> : null}
              </View>
              {path ? <Ionicons name="chevron-forward" size={16} color={c.textMuted} /> : null}
            </>
          );
          return (
            <View key={m.id} style={styles.memberRow}>
              {path ? (
                <TouchableOpacity
                  style={styles.memberMain} onPress={() => onOpenProfile(path)}
                  accessibilityRole="button" accessibilityLabel={memberAccessibilityLabel(m, isMe)} accessibilityHint="Opens their profile"
                >
                  {body}
                </TouchableOpacity>
              ) : (
                <View style={styles.memberMain} accessibilityLabel={memberAccessibilityLabel(m, isMe)}>{body}</View>
              )}
              {onCall && !isMe ? (
                callingUserId === m.userId ? (
                  <View style={styles.removeBtn}><ActivityIndicator size="small" color={c.accentGreen} /></View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.removeBtn} onPress={() => onCall(m, "audio")} disabled={!!callingUserId}
                      accessibilityRole="button" accessibilityLabel={`Voice call ${m.name}`}
                    >
                      <Ionicons name="call-outline" size={19} color={c.accentGreen} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.removeBtn} onPress={() => onCall(m, "video")} disabled={!!callingUserId}
                      accessibilityRole="button" accessibilityLabel={`Video call ${m.name}`}
                    >
                      <Ionicons name="videocam-outline" size={20} color={c.accentGreen} />
                    </TouchableOpacity>
                  </>
                )
              ) : null}
              {canRemoveMember(m, myId, canManage) ? (
                <TouchableOpacity
                  style={styles.removeBtn} onPress={() => onRemove(m)}
                  accessibilityRole="button" accessibilityLabel={`Remove ${m.name}`}
                >
                  <Ionicons name="close-circle-outline" size={20} color={c.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })
      )}
      {error && members ? <Text style={styles.staleNote}>Couldn't refresh — showing the last loaded list.</Text> : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    centered: { paddingVertical: 40, alignItems: "center" },
    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 2 },
    count: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    countSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 },
    search: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 14,
      minHeight: 44, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginBottom: 6,
    },
    empty: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", paddingVertical: 12 },
    memberRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    memberMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 6 },
    memberName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    memberRole: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    removeBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    errorBox: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 20, alignItems: "center", gap: 8 },
    errorText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", textAlign: "center" },
    retryBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: c.primaryGreen, justifyContent: "center" },
    retryText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    staleNote: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
  });
}

export default FamilyMemberList;
