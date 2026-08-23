import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// My Discipleship hub — My Discipleship Phase 2's top-level split. This
// screen is intentionally thin: it only chooses between the two
// discipleship experiences and holds no data-fetching of its own.
// - Journey ("Where am I?") lives at my-discipleship/journey.tsx.
// - Journal ("What am I learning/remembering/praying about/becoming?")
//   lives at my-discipleship/journal.tsx.

export default function MyDiscipleshipHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Discipleship</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={s.heroSub}>Walk with others. Help them grow. Remember what God is doing in you.</Text>

        <TouchableOpacity style={s.hubCard} activeOpacity={0.85} onPress={() => router.push("/my-discipleship/journey" as any)}>
          <Text style={s.hubCardEmoji}>🌱</Text>
          <Text style={s.hubCardTitle}>My Discipleship Journey</Text>
          <Text style={s.hubCardSub}>Your relationships, learning, growth and impact.</Text>
          <View style={s.hubCardBtn}>
            <Text style={s.hubCardBtnText}>Open Journey</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={s.hubCard} activeOpacity={0.85} onPress={() => router.push("/my-discipleship/journal" as any)}>
          <Text style={s.hubCardEmoji}>📖</Text>
          <Text style={s.hubCardTitle}>My Discipleship Journal</Text>
          <Text style={s.hubCardSub}>Reflect, remember, pray and grow.</Text>
          <View style={s.hubCardBtn}>
            <Text style={s.hubCardBtnText}>Open Journal</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },
    heroSub: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 24 },

    hubCard: {
      backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige,
      padding: 22, marginBottom: 16,
    },
    hubCardEmoji: { fontSize: 30, marginBottom: 10 },
    hubCardTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
    hubCardSub: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 16 },
    hubCardBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
    hubCardBtnText: { fontSize: 13, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    hubCardBtnMuted: {
      alignSelf: "flex-start", backgroundColor: c.cardBeige, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    hubCardBtnMutedText: { fontSize: 11, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  });
}