import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import { redeemLink } from "@/lib/scriptureCollectionsApi";

// A Scripture collection link opened in the app (from the website preview or
// a scan). The server checks the link (revoked, expired, full), blocks and
// child accounts, then gives this signed-in person access at the link's level.
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export default function CollectionLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !TOKEN_RE.test(token)) { setError("This link isn't valid."); return; }
    let live = true;
    redeemLink(token)
      .then((r) => { if (live) router.replace({ pathname: "/scripture-collections/[id]", params: { id: r.id } } as any); })
      .catch((e: any) => { if (live) setError(e?.message ?? "This link is no longer available."); });
    return () => { live = false; };
  }, [token]);

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: "Shared Scripture" }} />
      {error ? (
        <>
          <Ionicons name="link-outline" size={34} color={c.textMuted} />
          <Text style={s.text}>{error}</Text>
          <Text style={s.muted}>Ask the person who shared it for a new link.</Text>
          <AppButton label="My Scripture Collections" variant="secondary" onPress={() => router.replace("/scripture-collections" as any)} />
        </>
      ) : (
        <>
          <ActivityIndicator color={c.accentGreen} accessibilityLabel="Opening" />
          <Text style={s.muted}>Opening the shared Scripture…</Text>
        </>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    text: { fontSize: 16, color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    muted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
