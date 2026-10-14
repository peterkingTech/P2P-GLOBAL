import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { Card, Chip, studioStyles as ss } from "@/components/studio/StudioUI";

// Distribution & Engagement. No distribution channel (social, email
// newsletters, push campaigns for stories) and no engagement tracking for
// Kingdom Stories exist in this codebase, so this screen states the actual
// sharing rules and links to the real workflows instead of showing controls
// or numbers that would not be real.

export default function StudioDistribution() {
  const router = useRouter();
  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.content}>
      <Card>
        <View style={ss.row}>
          <Text style={[ss.h2, { flex: 1 }]} accessibilityRole="header">Distribution channels</Text>
          <Chip label="Not available yet" tone="grey" />
        </View>
        <Text style={ss.body}>No external distribution channels are connected, so the Studio cannot send or share content anywhere outside the app. Publishing makes a story visible in the app only; publishing does not send notifications.</Text>
      </Card>

      <Card>
        <Text style={ss.h2} accessibilityRole="header">Sharing rules in the app today</Text>
        <Rule icon="book-outline" title="Kingdom Stories" text="Admin-curated history. Official distribution is reserved for the P2P team (content admins, marketing and super admins) once a story is published. Members keep the app's existing share button on published stories." />
        <Rule icon="sparkles-outline" title="Kingdom Wins" text="Personal testimonies. Only published testimonies shared with the P2P network are visible; the author's consent and the moderation queue decide that. The Studio never shares or features them." />
      </Card>

      <Card>
        <View style={ss.row}>
          <Text style={[ss.h2, { flex: 1 }]} accessibilityRole="header">Engagement</Text>
          <Chip label="Not measured" tone="grey" />
        </View>
        <Text style={ss.body}>Story views, reads, shares and reach are not recorded by the app, so no engagement numbers are shown. Counts that are recorded (publications, review activity, scheduled jobs) are in Analytics.</Text>
        <TouchableOpacity onPress={() => router.push("/admin/studio/analytics" as any)} accessibilityRole="link" style={styles.link}>
          <Text style={styles.linkText}>Open Analytics & Reports</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/admin/moderation" as any)} accessibilityRole="link" style={styles.link}>
          <Text style={styles.linkText}>Open the moderation queue (reports and flags)</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
        </TouchableOpacity>
      </Card>
    </ScrollView>
  );
}

function Rule({ icon, title, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; text: string }) {
  return (
    <View style={styles.rule}>
      <Ionicons name={icon} size={18} color={colors.primaryGreen} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ss.title}>{title}</Text>
        <Text style={ss.body}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 6 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  linkText: { color: colors.primaryGreen, fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
