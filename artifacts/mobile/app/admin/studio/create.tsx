import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { Card, Chip, studioStyles as ss } from "@/components/studio/StudioUI";
import { STUDIO_EDIT_ROLES } from "@/lib/studioModel";
import { AppButton } from "@/components/ui";

// Create Content: one entry point that hands off to each content type's
// EXISTING editor and workflow. Types without an admin editor say so
// instead of offering a control that would not work.

const CURRICULUM_ROLES = ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_content"]; // admin nav "Content"

export default function StudioCreate() {
  const router = useRouter();
  const { profile } = useAuth();
  const role = profile?.role ?? "";
  const options: { key: string; icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; text: string; path: string | null; allowed: boolean; unavailable?: string }[] = [
    { key: "story", icon: "book-outline", title: "Kingdom Story", text: "Documented Christian history. Created as a draft in the story editor, then reviewed and published through the Studio.", path: "/admin/kingdom-stories/create", allowed: STUDIO_EDIT_ROLES.includes(role) },
    { key: "curriculum", icon: "library-outline", title: "Curriculum or plan", text: "Opens the Curriculum Manager, where curricula and plans are written and published with their own published switch.", path: "/admin/curriculum", allowed: CURRICULUM_ROLES.includes(role) },
    { key: "pray", icon: "flower-outline", title: "Pray the Word devotional", text: "Pray the Word topics and paths are managed through their existing admin tools.", path: null, allowed: false, unavailable: "No admin screen yet" },
    { key: "announcement", icon: "megaphone-outline", title: "Church announcement", text: "Announcements belong to a church and are written and scheduled by its leaders in the church portal, not here.", path: null, allowed: false, unavailable: "Managed in the church portal" },
    { key: "win", icon: "sparkles-outline", title: "Kingdom Win", text: "Testimonies are shared by members themselves and approved in the moderation queue. Admins do not create them.", path: null, allowed: false, unavailable: "Created by members" },
  ];
  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.content}>
      <Text style={ss.h2} accessibilityRole="header">Create content</Text>
      <Text style={ss.meta}>Each type keeps its own editor and rules.</Text>
      {options.map((o) => (
        <Card key={o.key}>
          <View style={[ss.row, { flexWrap: "nowrap", alignItems: "flex-start" }]}>
            <Ionicons name={o.icon} size={22} color={colors.primaryGreen} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={ss.title}>{o.title}</Text>
              <Text style={ss.body}>{o.text}</Text>
            </View>
          </View>
          {o.path && o.allowed ? (
            <AppButton label="Start" onPress={() => router.push(o.path as any)} icon="arrow-forward" iconPosition="trailing" accessibilityLabel={`Create ${o.title}`} style={{ alignSelf: "flex-start" }} palette="fixedLight" />
          ) : (
            <Chip label={o.unavailable ?? "Your role cannot create this"} tone="grey" />
          )}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  go: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: colors.primaryGreen, borderRadius: 9, paddingHorizontal: 16, minHeight: 44 },
  goText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
