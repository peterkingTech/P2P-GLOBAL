import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { AppButton } from "@/components/ui";
import { joinWithLink } from "@/lib/groupsApi";

// Opened from a shared invite link (/groups/join?t=<token>). The server checks the link (revoked,
// expired, used up, closed, blocked) and either joins the person or files a request for an admin.
export default function JoinScreen() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const [state, setState] = useState<{ kind: "working" } | { kind: "requested" } | { kind: "error"; message: string }>({ kind: "working" });

  useEffect(() => {
    if (!t) { setState({ kind: "error", message: "This invite link is incomplete." }); return; }
    let live = true;
    joinWithLink(String(t)).then((r) => {
      if (!live) return;
      if (r.status === "requested") { setState({ kind: "requested" }); return; }
      router.replace((r.type === "community" ? `/groups/community/${r.targetId}` : `/messages/${r.targetId}`) as any);
    }).catch((e: any) => live && setState({ kind: "error", message: e?.message ?? "This invite link can't be used." }));
    return () => { live = false; };
  }, [t, router]);

  return (
    <View style={[styles.screen, { backgroundColor: c.lightCream, paddingTop: insets.top + 40 }]}>
      {state.kind === "working" ? <><ActivityIndicator color={c.accentGreen} accessibilityLabel="Joining" /><Text style={[styles.text, { color: c.textMid }]}>Opening your invitation…</Text></> : (
        <>
          <Ionicons name={state.kind === "requested" ? "hourglass-outline" : "link-outline"} size={44} color={c.primaryGreen} />
          <Text style={[styles.title, { color: c.textDark }]}>{state.kind === "requested" ? "Request sent" : "Can't join"}</Text>
          <Text style={[styles.text, { color: c.textMid }]}>{state.kind === "requested" ? "An administrator will review your request. You'll be notified when you're added." : state.message}</Text>
          <AppButton label="Go to Groups" variant="secondary" onPress={() => router.replace({ pathname: "/(tabs)/messages", params: { section: "groups" } } as any)} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", gap: 14, paddingHorizontal: 28 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  text: { fontSize: 14.5, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
});
