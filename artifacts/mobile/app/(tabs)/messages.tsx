import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import "@/lib/i18n";

interface ConversationRow {
  id: string;
  type: "direct" | "group";
  name: string | null;
  lastMessage: string | null;
  lastAt: string | null;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 20, paddingBottom: 12,
    },
    headerTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    emptyText: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    emptySub: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
    row: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    avatarCircle: {
      width: 46, height: 46, borderRadius: 23,
      backgroundColor: "rgba(29,158,117,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    rowTitle: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  });
}

export default function MessagesTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { supabase, user } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: memberships } = await supabase
      .from("p2p_conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);
    const convIds = (memberships ?? []).map((m: any) => m.conversation_id);
    if (convIds.length === 0) { setRows([]); setLoading(false); return; }

    const { data: convs } = await supabase
      .from("p2p_conversations")
      .select("id, type, name")
      .in("id", convIds);

    const results: ConversationRow[] = [];
    for (const c of convs ?? []) {
      let name = c.name as string | null;
      if (c.type === "direct") {
        const { data: members } = await supabase
          .from("p2p_conversation_members")
          .select("user_id, p2p_profiles(full_name)")
          .eq("conversation_id", c.id)
          .neq("user_id", user.id)
          .maybeSingle();
        name = (members as any)?.p2p_profiles?.full_name ?? "Direct message";
      }
      const { data: lastMsg } = await supabase
        .from("p2p_messages")
        .select("body, created_at")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      results.push({ id: c.id, type: c.type, name, lastMessage: lastMsg?.body ?? null, lastAt: lastMsg?.created_at ?? null });
    }
    results.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
    setRows(results);
    setLoading(false);
  }, [supabase, user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("tabs.messages")}</Text>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="chatbubbles-outline" size={44} color={colors.borderBeige} />
          <Text style={styles.emptyText}>No conversations yet</Text>
          <Text style={styles.emptySub}>
            Start a conversation from a peer's profile or a study group.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.8}
              onPress={() => router.push(`/messages/${item.id}` as any)}
            >
              <View style={styles.avatarCircle}>
                <Ionicons
                  name={item.type === "group" ? "people" : "person"}
                  size={20}
                  color={colors.primaryGreen}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name ?? "Conversation"}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.lastMessage ?? "No messages yet"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
