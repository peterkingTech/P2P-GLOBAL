import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, ActivityIndicator, Image, Switch } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { MIN_SIGNUP_AGE, isValidCalendarDate, toISODate, ageFromISODate, parseDMY, isoToDMY } from "@/lib/dateOfBirth";
import DateOfBirthInput from "@/components/DateOfBirthInput";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { LocationVerifier, VerifiedLocation } from "@/components/LocationVerifier";
import { getFlagEmoji } from "@/lib/countryGeo";
import { resolveMediaUpload } from "@/lib/mediaUpload";
import MinistryRolePicker, { MINISTRY_ROLE_OPTIONS } from "@/components/MinistryRolePicker";
import { MinistryRole } from "@/contexts/AuthContext";
import { AppButton } from "@/components/ui";
import { timeAgo } from "@/lib/timeFormat";
import { showAlert } from "@/lib/alerts";
import { Avatar } from "@/components/Avatar";



export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, user, updateProfile, signOut, supabase } = useAuth();
  const { verificationStatus, loadVerificationStatus } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  useEffect(() => {
    loadVerificationStatus();
  }, [loadVerificationStatus]);

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [dob, setDob] = useState(profile?.dateOfBirth ? isoToDMY(profile.dateOfBirth) : "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  // Discovery's Nearby search links here with ?verifyLocation=1 to open the verifier directly.
  const { verifyLocation } = useLocalSearchParams<{ verifyLocation?: string }>();
  const [showLocationVerifier, setShowLocationVerifier] = useState(verifyLocation === "1");
  const [showMinistryPicker, setShowMinistryPicker] = useState(false);
  const [savingMinistryRole, setSavingMinistryRole] = useState(false);
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [savingBio, setSavingBio] = useState(false);

  const nextChangeDate = profile?.usernameChangedAt
    ? new Date(new Date(profile.usernameChangedAt).getTime() + 90 * 24 * 60 * 60 * 1000)
    : null;
  const changeAllowed = !nextChangeDate || nextChangeDate.getTime() <= Date.now();

  async function handleSaveBio() {
    setSavingBio(true);
    const err = await updateProfile({ bio: bio.trim() });
    setSavingBio(false);
    if (err) showAlert("Couldn't save", err);
  }

  async function handleSaveProfile() {
    let dateOfBirth: string | undefined;
    if (dob.trim()) {
      const parsed = parseDMY(dob);
      if (!parsed || !isValidCalendarDate(parsed.year, parsed.month, parsed.day)) {
        showAlert("Invalid date", "Please enter a valid date in DD.MM.YYYY format");
        return;
      }
      dateOfBirth = toISODate(parsed.year, parsed.month, parsed.day);
      if (ageFromISODate(dateOfBirth) < MIN_SIGNUP_AGE) {
        showAlert("Can't save", `You must be at least ${MIN_SIGNUP_AGE} years old to use this app.`);
        return;
      }
    }
    setSavingProfile(true);
    const err = await updateProfile({ displayName: displayName.trim(), ...(dateOfBirth ? { dateOfBirth } : {}) });
    setSavingProfile(false);
    if (err) showAlert("Couldn't save", err);
    else showAlert("Saved", "Your profile has been updated.");
  }

  async function handlePickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert("Permission needed", "Please allow photo library access to change your profile photo.");
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
      const { ext, contentType } = resolveMediaUpload(asset);
      const path = `${user.id}/avatar.${ext}`;
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, arrayBuffer, { contentType, upsert: true });
      if (uploadError) {
        showAlert("Upload failed", uploadError.message);
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const err = await updateProfile({ avatarUrl: `${data.publicUrl}?t=${Date.now()}` });
      if (err) showAlert("Couldn't save photo", err);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSaveEmail() {
    if (!email.trim() || email.trim() === profile?.email) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setSavingEmail(false);
    if (error) showAlert("Couldn't update email", error.message);
    else showAlert("Check your inbox", "We sent a confirmation link to your new email address.");
  }

  async function handleChangePassword() {
    if (newPassword.length < 6) {
      showAlert("Too short", "Password must be at least 6 characters.");
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) showAlert("Couldn't change password", error.message);
    else {
      setNewPassword("");
      setShowPasswordField(false);
      showAlert("Password changed", "Your password has been updated.");
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

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Account" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <TouchableOpacity accessibilityRole="button" onPress={handlePickPhoto} disabled={uploadingPhoto} style={styles.avatarWrap}>
            <Avatar photoUrl={profile?.avatarUrl} name={profile?.displayName} size={84} style={styles.avatarImg} />
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

          <AppButton label="Save Profile" onPress={handleSaveProfile} disabled={savingProfile} loading={savingProfile} />
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push("/settings/change-username" as any)}>
          <Text style={styles.fieldLabel}>Username</Text>
          <View style={styles.usernameRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.usernameValue}>@{profile?.username ?? "not set"}</Text>
              {nextChangeDate && (
                <Text style={styles.locationSub}>Next change available {nextChangeDate.toLocaleDateString()}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Ministry Role</Text>
          <TouchableOpacity accessibilityRole="button"
            style={[styles.usernameRow, { justifyContent: "space-between" }]}
            onPress={() => setShowMinistryPicker((v) => !v)}
          >
            <Text style={[styles.usernameValue, { flex: 1 }]}>
              {MINISTRY_ROLE_OPTIONS.find((o) => o.key === profile?.ministryRole)?.emoji ?? "🌱"}{" "}
              {MINISTRY_ROLE_OPTIONS.find((o) => o.key === profile?.ministryRole)?.label ?? "New to faith"}
            </Text>
            <Text style={styles.changeLinkText}>{showMinistryPicker ? "Cancel" : "Change →"}</Text>
          </TouchableOpacity>
          {showMinistryPicker && (
            <View style={{ marginTop: 14 }}>
              <MinistryRolePicker
                value={profile?.ministryRole ?? null}
                onSelect={async (role: MinistryRole) => {
                  setSavingMinistryRole(true);
                  await updateProfile({ ministryRole: role, ministryRoleUpdatedAt: new Date().toISOString() });
                  setSavingMinistryRole(false);
                  setShowMinistryPicker(false);
                }}
              />
              {savingMinistryRole && <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 12 }} />}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell people a little about yourself"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={280}
          />
          <AppButton label="Save Bio" onPress={handleSaveBio} disabled={savingBio} loading={savingBio} />
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Public profile visibility</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Anyone can view my profile</Text>
            <Switch
              value={profile?.profileVisibility === "public"}
              onValueChange={(v: boolean) => { updateProfile({ profileVisibility: v ? "public" : "peers" }); }}
              trackColor={{ true: colors.accentGreen }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show my real name publicly</Text>
            <Switch
              value={profile?.showRealNamePublicly ?? true}
              onValueChange={(v: boolean) => { updateProfile({ showRealNamePublicly: v }); }}
              trackColor={{ true: colors.accentGreen }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show my progress publicly</Text>
            <Switch
              value={profile?.showProgressPublicly ?? true}
              onValueChange={(v: boolean) => { updateProfile({ showProgressPublicly: v }); }}
              trackColor={{ true: colors.accentGreen }}
            />
          </View>
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push("/settings/blocked-users" as any)}>
          <View style={styles.usernameRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Blocked Users</Text>
              <Text style={styles.locationSub}>Manage who you've blocked</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push("/settings/verification" as any)}>
          <Text style={styles.fieldLabel}>Verification</Text>
          <View style={styles.usernameRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <Ionicons
                name={verificationStatus?.isVerified ? "checkmark-circle" : verificationStatus?.status === "pending" ? "time-outline" : "ellipse-outline"}
                size={16}
                color={verificationStatus?.isVerified ? colors.accentGreen : verificationStatus?.status === "pending" ? colors.amber : colors.textMuted}
              />
              <Text style={styles.usernameValue}>
                {verificationStatus?.isVerified ? "Identity Verified" : verificationStatus?.status === "pending" ? "Verification Pending" : "Not Verified"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

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
            <AppButton label="Update Email" onPress={handleSaveEmail} disabled={savingEmail} loading={savingEmail} />
          )}
        </View>

        <View style={styles.card}>
          {!showPasswordField ? (
            <AppButton label="Change Password" onPress={() => setShowPasswordField(true)} variant="tertiary" size="sm" icon="lock-closed-outline" />
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
              <AppButton label="Save New Password" onPress={handleChangePassword} disabled={savingPassword} loading={savingPassword} />
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Location</Text>
          {showLocationVerifier ? (
            <LocationVerifier onVerified={handleLocationVerified} onSkip={() => setShowLocationVerifier(false)} compact />
          ) : (
            <TouchableOpacity accessibilityRole="button" style={styles.locationRow} onPress={() => setShowLocationVerifier(true)}>
              <Ionicons name="location-outline" size={18} color={colors.accentGreen} />
              <View style={{ flex: 1 }}>
                {profile?.locationVerified ? (
                  <>
                    <Text style={styles.locationText}>
                      {getFlagEmoji(profile.country)} {profile.country}{profile.city ? ` · ${profile.city}` : ""} <Text style={{ color: colors.accentGreen }}>✓ Verified</Text>
                    </Text>
                    {profile.locationVerifiedAt && (
                      <Text style={styles.locationSub}>Verified {timeAgo(profile.locationVerifiedAt, "long")}</Text>
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

        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push("/settings/account-status" as any)}>
          <View style={styles.usernameRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Account status</Text>
              <Text style={styles.locationSub}>Take a break · Delete account</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
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
    usernameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    usernameValue: { fontSize: 15, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    changeLinkText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
    toggleLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium", flex: 1, marginRight: 10 },
    input: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 10, padding: 12, color: c.textDark, fontSize: 14,
      fontFamily: "Inter_400Regular", marginBottom: 14,
    },
    locationRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    locationText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    locationSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  });
}