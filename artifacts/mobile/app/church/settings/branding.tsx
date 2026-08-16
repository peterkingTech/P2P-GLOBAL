import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, Image } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { resolveMediaUpload } from "@/lib/mediaUpload";
import colors from "@/constants/colors";

export default function ChurchBrandingSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { supabase } = useAuth();
  const { userChurch, isChurchCreator, updateChurch, loadUserChurch } = useData();
  const [logoUrl, setLogoUrl] = useState(userChurch?.logoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handlePick() {
    if (!userChurch) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Please allow photo library access to change the church logo."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const { ext, contentType } = resolveMediaUpload(asset);
      const path = `${userChurch.id}/logo/logo.${ext}`;
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage.from("church-media").upload(path, arrayBuffer, { contentType, upsert: true });
      if (uploadError) { Alert.alert("Upload failed", uploadError.message); return; }
      const { data } = supabase.storage.from("church-media").getPublicUrl(path);
      const newUrl = `${data.publicUrl}?t=${Date.now()}`;
      setSaving(true);
      const { error } = await updateChurch(userChurch.id, { logoUrl: newUrl });
      setSaving(false);
      if (error) { Alert.alert("Couldn't save logo", error); return; }
      setLogoUrl(newUrl);
      await loadUserChurch();
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!userChurch) return;
    setSaving(true);
    const { error } = await updateChurch(userChurch.id, { logoUrl: "" });
    setSaving(false);
    if (error) { Alert.alert("Couldn't remove logo", error); return; }
    setLogoUrl(null);
    await loadUserChurch();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Branding</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!isChurchCreator && (
          <View style={styles.lockBanner}>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <Text style={styles.lockBannerText}>Only the General Overseer can change this.</Text>
          </View>
        )}

        <Text style={styles.label}>Church Logo</Text>
        {!logoUrl && <Text style={styles.helperText}>No church logo uploaded. Add a logo to personalize your church profile.</Text>}
        <TouchableOpacity style={styles.logoPicker} onPress={handlePick} disabled={!isChurchCreator || uploading || saving}>
          {uploading || saving ? (
            <ActivityIndicator color={colors.accentGreen} />
          ) : logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logoPreview} />
          ) : (
            <>
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
              {isChurchCreator && <Text style={styles.logoPickerText}>Add a logo</Text>}
            </>
          )}
        </TouchableOpacity>
        {isChurchCreator && logoUrl && (
          <View style={styles.logoActionsRow}>
            <TouchableOpacity onPress={handlePick}><Text style={styles.actionText}>Replace</Text></TouchableOpacity>
            <TouchableOpacity onPress={handleRemove}><Text style={styles.actionTextDestructive}>Remove</Text></TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { padding: 20, paddingBottom: 60 },
  lockBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  lockBannerText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  label: { fontSize: 13, color: colors.textMid, marginBottom: 6, fontFamily: "Inter_500Medium" },
  helperText: { fontSize: 12, color: colors.textMuted, marginBottom: 10, fontFamily: "Inter_400Regular" },
  logoPicker: {
    width: 120, height: 120, borderRadius: 20, borderWidth: 1, borderColor: colors.borderBeige,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.card,
  },
  logoPreview: { width: 120, height: 120, borderRadius: 20 },
  logoPickerText: { color: colors.textMid, fontSize: 11, marginTop: 6, fontFamily: "Inter_400Regular" },
  logoActionsRow: { flexDirection: "row", gap: 20, marginTop: 12 },
  actionText: { color: colors.accentGreen, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  actionTextDestructive: { color: "#B91C1C", fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});