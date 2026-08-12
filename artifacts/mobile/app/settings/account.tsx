import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Alert, ActivityIndicator, Image } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { MIN_SIGNUP_AGE, isValidCalendarDate, toISODate, ageFromISODate, parseDMY, isoToDMY } from "@/lib/dateOfBirth";
import DateOfBirthInput from "@/components/DateOfBirthInput";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { LocationVerifier, VerifiedLocation } from "@/components/LocationVerifier";
import { getApiUrl } from "@/lib/apiUrl";
import { getFlagEmoji } from "@/lib/countryGeo";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, user, updateProfile, signOut, supabase } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [dob, setDob] = useState(profile?.dateOfBirth ? isoToDMY(profile.dateOfBirth) : "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLocationVerifier, setShowLocationVerifier] = useState(false);

  async function handleSaveProfile() {
    let dateOfBirth: string | undefined;
    if (dob.trim()) {
      const parsed = parseDMY(dob);
      if (!parsed || !isValidCalendarDate(parsed.year, parsed.month, parsed.day)) {
        Alert.alert("Invalid date", "Please enter a valid date in DD.MM.YYYY format");
        return;
      }
      dateOfBirth = toISODate(parsed.year, parsed.month, parsed.day);
      if (ageFromISODate(dateOfBirth) < MIN_SIGNUP_AGE) {
        Alert.alert("Can't save", `You must be at least ${MIN_SIGNUP_AGE} years old to use this app.`);
        return;
      }
    }
    setSavingProfile(true);
    const err = await updateProfile({ displayName: displayName.trim(), ...(dateOfBirth ? { dateOfBirth } : {}) });
    setSavingProfile(false);
    if (err) Alert.alert("Couldn't save", err);
    else Alert.alert("Saved", "Your profile has been updated.");
  }

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
      const err = await updateProfile({ avatarUrl: `${data.publicUrl}?t=${Date.now()}` });
      if (err) Alert.alert("Couldn't save photo", err);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSaveEmail() {
    if (!email.trim() || email.trim() === profile?.email) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setSavingEmail(false);
    if (error) Alert.alert("Couldn't update email", error.message);
    else Alert.alert("Check your inbox", "We sent a confirmation link to your new email address.");
  }

  async function handleChangePassword() {
    if (newPassword.length < 6) {
      Alert.alert("Too short", "Password must be at least 6 characters.");
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) Alert.alert("Couldn't change password", error.message);
    else {
      setNewPassword("");
      setShowPasswordField(false);
      Alert.alert("Password changed", "Your password has been updated.");
    }
  }

  async function handleLocationVerified(location: VerifiedLocation) {
    await updateProfile({
      city: location.city || undefined,
      country: location.country,
      countryCode: location.countryCode || undefined,
      latitude: location.latitude,
      longitude: location.longitude,
      locationVerified: true,
      locationVerifiedAt: new Date().toISOString(),
    });
    setShowLocationVerifier(false);
  }

  function confirmDeleteAccount() {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your profile and everything tied to it. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete Account", style: "destructive", onPress: handleDeleteAccount },
      ]
    );
  }

  async function handleDeleteAccount() {
    if (!user?.id) return;
    setDeleting(true);
    try {
      const res = await fetch(`${getApiUrl()}/account/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong.");
      }
      await signOut();
      router.replace("/(auth)/onboarding" as any);
    } catch (e: any) {
      Alert.alert("Couldn't delete account", e.message ?? "Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Account" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
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

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Full name</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textMuted} />

          <Text style={styles.fieldLabel}>Date of birth</Text>
          <DateOfBirthInput value={dob} onChangeText={setDob} style={styles.input} />

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Profile</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={[styles.input, { marginBottom: 8 }]}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={colors.textMuted}
          />
          {email.trim() !== profile?.email && (
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEmail} disabled={savingEmail}>
              {savingEmail ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Update Email</Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          {!showPasswordField ? (
            <TouchableOpacity style={styles.changePwBtn} onPress={() => setShowPasswordField(true)}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.changePwBtnText}>Change Password</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.fieldLabel}>New password</Text>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="Min. 6 characters"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={handleChangePassword} disabled={savingPassword}>
                {savingPassword ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save New Password</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Location</Text>
          {showLocationVerifier ? (
            <LocationVerifier onVerified={handleLocationVerified} onSkip={() => setShowLocationVerifier(false)} compact />
          ) : (
            <TouchableOpacity style={styles.locationRow} onPress={() => setShowLocationVerifier(true)}>
              <Ionicons name="location-outline" size={18} color={colors.accentGreen} />
              <View style={{ flex: 1 }}>
                {profile?.locationVerified ? (
                  <>
                    <Text style={styles.locationText}>
                      {getFlagEmoji(profile.country)} {profile.country}{profile.city ? ` · ${profile.city}` : ""} <Text style={{ color: colors.accentGreen }}>✓ Verified</Text>
                    </Text>
                    {profile.locationVerifiedAt && (
                      <Text style={styles.locationSub}>Verified {timeAgo(profile.locationVerifiedAt)}</Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.locationText}>Location not set</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={styles.deleteBtn} onPress={confirmDeleteAccount} disabled={deleting}>
          {deleting ? <ActivityIndicator color="#B91C1C" size="small" /> : (
            <>
              <Ionicons name="trash-outline" size={16} color="#B91C1C" />
              <Text style={styles.deleteBtnText}>Delete Account</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    avatarSection: { alignItems: "center", marginBottom: 24 },
    avatarWrap: { position: "relative" },
    avatarCircle: {
      width: 84, height: 84, borderRadius: 42,
      backgroundColor: "rgba(29,158,117,0.15)", borderWidth: 3, borderColor: c.accentGreen,
      alignItems: "center", justifyContent: "center",
    },
    avatarImg: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: c.accentGreen },
    avatarInitial: { fontSize: 32, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    cameraBadge: {
      position: "absolute", bottom: -2, right: -2, width: 28, height: 28, borderRadius: 14,
      backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center",
      borderWidth: 2, borderColor: c.lightCream,
    },
    changePhotoText: { fontSize: 12, color: c.textMuted, marginTop: 10, fontFamily: "Inter_400Regular" },
    card: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16,
    },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
    input: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 10, padding: 12, color: c.textDark, fontSize: 14,
      fontFamily: "Inter_400Regular", marginBottom: 14,
    },
    saveBtn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    changePwBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 4 },
    changePwBtnText: { fontSize: 14, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    locationRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    locationText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    locationSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    deleteBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      borderWidth: 1.5, borderColor: "#B91C1C", borderRadius: 14, height: 50, marginTop: 8,
    },
    deleteBtnText: { fontSize: 14, fontWeight: "700", color: "#B91C1C", fontFamily: "Inter_700Bold" },
  });
}