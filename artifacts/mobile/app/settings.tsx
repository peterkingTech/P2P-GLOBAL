import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  Switch,
  ActivityIndicator,
  Image,
  Modal,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "zh", label: "中文" },
  { code: "ar", label: "العربية" },
];

const VISIBILITY_OPTIONS = [
  { value: "public" as const, label: "Public", desc: "Anyone in the app can view your profile" },
  { value: "peers" as const, label: "Peers only", desc: "Only confirmed peers can view your profile" },
  { value: "private" as const, label: "Private", desc: "Your profile is hidden from search & directory" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, updateProfile, supabase, user } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [country, setCountry] = useState(profile?.country ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [locating, setLocating] = useState(false);
  const [langPickerOpen, setLangPickerOpen] = useState<"app" | "content" | null>(null);
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  async function handlePickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Please allow photo library access to change your profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0] || !user) return;

    setUploadingPhoto(true);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/avatar.${ext}`;
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, arrayBuffer, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: true });
      if (uploadError) {
        Alert.alert("Upload failed", uploadError.message);
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      const err = await updateProfile({ avatarUrl: publicUrl });
      if (err) Alert.alert("Couldn't save photo", err);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    try {
      const Location = await import("expo-location");
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow location access to auto-fill your city & country.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const place = places[0];
      if (place) {
        setCity(place.city ?? place.subregion ?? "");
        setCountry(place.country ?? "");
      }
    } catch {
      Alert.alert("Couldn't detect location", "Please enter your city and country manually.");
    } finally {
      setLocating(false);
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    const err = await updateProfile({
      displayName: displayName.trim(),
      bio: bio.trim(),
      city: city.trim() || undefined,
      country: country.trim() || undefined,
    });
    setSaving(false);
    if (err) Alert.alert("Couldn't save", err);
    else Alert.alert("Saved", "Your profile has been updated.");
  }

  async function toggleNotifications(key: "notificationsEnabled" | "notifyPrayer" | "notifyMessages" | "notifyGroups", value: boolean) {
    await updateProfile({ [key]: value } as any);
  }

  async function setVisibility(value: "public" | "peers" | "private") {
    setVisibilityOpen(false);
    await updateProfile({ profileVisibility: value });
  }

  async function setLanguage(kind: "app" | "content", code: string) {
    setLangPickerOpen(null);
    await updateProfile(kind === "app" ? { appLanguage: code } : { contentLanguage: code });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Photo */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handlePickPhoto} disabled={uploadingPhoto} style={styles.avatarWrap}>
            {profile?.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{profile?.displayName?.charAt(0)?.toUpperCase() ?? "?"}</Text>
              </View>
            )}
            <View style={styles.cameraBadge}>
              {uploadingPhoto ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
            </View>
          </TouchableOpacity>
          <Text style={styles.changePhotoText}>Tap to change photo</Text>
        </View>

        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textMuted} />

          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell others a little about yourself..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            maxLength={280}
          />

          <View style={styles.rowBetween}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TouchableOpacity onPress={handleUseCurrentLocation} disabled={locating} style={styles.useLocationBtn}>
              {locating ? (
                <ActivityIndicator size="small" color={colors.accentGreen} />
              ) : (
                <>
                  <Ionicons name="locate-outline" size={14} color={colors.accentGreen} />
                  <Text style={styles.useLocationText}>Use current location</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={colors.textMuted} />
          <TextInput style={[styles.input, { marginTop: 8 }]} value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={colors.textMuted} />

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Profile</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <SettingSwitchRow
            label="All notifications"
            value={profile?.notificationsEnabled ?? true}
            onChange={(v) => toggleNotifications("notificationsEnabled", v)}
          />
          <SettingSwitchRow
            label="Prayer requests"
            value={profile?.notifyPrayer ?? true}
            disabled={!(profile?.notificationsEnabled ?? true)}
            onChange={(v) => toggleNotifications("notifyPrayer", v)}
          />
          <SettingSwitchRow
            label="Messages"
            value={profile?.notifyMessages ?? true}
            disabled={!(profile?.notificationsEnabled ?? true)}
            onChange={(v) => toggleNotifications("notifyMessages", v)}
          />
          <SettingSwitchRow
            label="Groups"
            value={profile?.notifyGroups ?? true}
            disabled={!(profile?.notificationsEnabled ?? true)}
            onChange={(v) => toggleNotifications("notifyGroups", v)}
            last
          />
        </View>

        <Text style={styles.sectionTitle}>Language</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.linkRow} onPress={() => setLangPickerOpen("app")}>
            <Text style={styles.fieldLabel}>App language</Text>
            <View style={styles.linkRowRight}>
              <Text style={styles.linkRowValue}>{LANGUAGES.find((l) => l.code === profile?.appLanguage)?.label ?? "English"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.linkRowLast]} onPress={() => setLangPickerOpen("content")}>
            <Text style={styles.fieldLabel}>Bible study language</Text>
            <View style={styles.linkRowRight}>
              <Text style={styles.linkRowValue}>{LANGUAGES.find((l) => l.code === profile?.contentLanguage)?.label ?? "English"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Privacy</Text>
        <View style={styles.card}>
          <TouchableOpacity style={[styles.linkRow, styles.linkRowLast]} onPress={() => setVisibilityOpen(true)}>
            <Text style={styles.fieldLabel}>Profile visibility</Text>
            <View style={styles.linkRowRight}>
              <Text style={styles.linkRowValue}>{VISIBILITY_OPTIONS.find((v) => v.value === profile?.profileVisibility)?.label ?? "Peers only"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Language picker */}
      <Modal visible={!!langPickerOpen} animationType="slide" transparent onRequestClose={() => setLangPickerOpen(null)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{langPickerOpen === "app" ? "App Language" : "Bible Study Language"}</Text>
              <TouchableOpacity onPress={() => setLangPickerOpen(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            {LANGUAGES.map((l) => (
              <TouchableOpacity key={l.code} style={styles.optionRow} onPress={() => setLanguage(langPickerOpen!, l.code)}>
                <Text style={styles.optionLabel}>{l.label}</Text>
                {(langPickerOpen === "app" ? profile?.appLanguage : profile?.contentLanguage) === l.code && (
                  <Ionicons name="checkmark" size={18} color={colors.accentGreen} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Visibility picker */}
      <Modal visible={visibilityOpen} animationType="slide" transparent onRequestClose={() => setVisibilityOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Profile Visibility</Text>
              <TouchableOpacity onPress={() => setVisibilityOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            {VISIBILITY_OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.value} style={styles.optionRow} onPress={() => setVisibility(opt.value)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  <Text style={styles.optionDesc}>{opt.desc}</Text>
                </View>
                {profile?.profileVisibility === opt.value && <Ionicons name="checkmark" size={18} color={colors.accentGreen} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SettingSwitchRow({
  label,
  value,
  onChange,
  disabled,
  last,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.switchRow, last && styles.linkRowLast]}>
      <Text style={[styles.fieldLabel, disabled && { opacity: 0.4 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatarWrap: { position: "relative" },
  avatarCircle: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: "rgba(29,158,117,0.15)",
    borderWidth: 3, borderColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center",
  },
  avatarImg: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: colors.accentGreen },
  avatarInitial: { fontSize: 32, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  cameraBadge: {
    position: "absolute", bottom: -2, right: -2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.lightCream,
  },
  changePhotoText: { fontSize: 12, color: colors.textMuted, marginTop: 10, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 24,
  },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
  input: {
    backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, padding: 12, color: colors.textDark, fontSize: 14,
    fontFamily: "Inter_400Regular", marginBottom: 14,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  useLocationBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  useLocationText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  saveBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 12, height: 46,
    alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  switchRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  linkRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  linkRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  linkRowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkRowValue: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.lightCream,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "85%",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  closeBtn: { padding: 4 },
  optionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  optionLabel: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_500Medium" },
  optionDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
});
