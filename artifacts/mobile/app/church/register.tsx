import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Platform, Modal, FlatList, Image } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useData, Church, ChurchSocialAccountData } from "@/contexts/DataContext";
import { shareChurchInvite } from "@/lib/sharing";
import colors from "@/constants/colors";

const CHURCH_TYPES = [
  { value: "local_church", label: "Local Church" },
  { value: "christian_fellowship", label: "Christian Fellowship" },
  { value: "bible_study_group", label: "Bible Study Group" },
  { value: "campus_ministry", label: "Campus Ministry" },
  { value: "youth_ministry", label: "Youth Ministry" },
  { value: "house_church", label: "House Church" },
  { value: "prayer_group", label: "Prayer Group" },
  { value: "christian_organization", label: "Christian Organization" },
  { value: "mission_organization", label: "Mission Organization" },
  { value: "denomination_network", label: "Denomination / Network" },
  { value: "online_christian_community", label: "Online Christian Community" },
  { value: "other", label: "Other — please specify" },
];

const SOCIAL_PLATFORMS = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "x_twitter", label: "X (Twitter)" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

const DESCRIPTION_MAX = 280;
const MAX_SOCIAL_ACCOUNTS = 8;
const TOTAL_STEPS = 4;

// Picks from a list via a bottom-sheet-style modal — used for Church Type and
// each social media row's Platform, both of which have too many options for
// a chip row.
function PickerField({ label, value, options, onSelect, placeholder }: {
  label: string; value: string | null; options: { value: string; label: string }[];
  onSelect: (v: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setOpen(true)}>
        <Text style={[styles.pickerBtnText, !selected && { color: colors.textMuted }]}>{selected?.label ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.lightGreen} />
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={{ maxHeight: 340 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.optionRow} onPress={() => { onSelect(item.value); setOpen(false); }}>
                  <Text style={styles.optionRowText}>{item.label}</Text>
                  {item.value === value && <Ionicons name="checkmark" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function RegisterChurchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, user, supabase } = useAuth();
  const { registerChurch, checkDuplicateChurch } = useData();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [createdChurch, setCreatedChurch] = useState<Church | null>(null);

  // Step 1 — Church Info
  const [name, setName] = useState("");
  const [churchType, setChurchType] = useState<string | null>(null);
  const [churchTypeOther, setChurchTypeOther] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [locationHidden, setLocationHidden] = useState(false);
  const [website, setWebsite] = useState("");

  // Step 2 — General Overseer / Contact
  const [isPrimaryContact, setIsPrimaryContact] = useState<boolean | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Step 3 — Branding & Social
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<ChurchSocialAccountData[]>([]);

  // Step 4 — Review
  const [duplicates, setDuplicates] = useState<{ id: string; name: string; city: string | null; country: string; website: string | null }[]>([]);
  const [duplicateWarningDismissed, setDuplicateWarningDismissed] = useState(false);

  useEffect(() => {
    if (isPrimaryContact === true) {
      setContactName(profile?.displayName ?? "");
      setContactEmail(profile?.email ?? "");
    }
  }, [isPrimaryContact, profile?.displayName, profile?.email]);

  useEffect(() => {
    if (step !== 4) return;
    setDuplicateWarningDismissed(false);
    checkDuplicateChurch(name.trim(), country.trim() || undefined, website.trim() || undefined).then(setDuplicates);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePickLogo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Please allow photo library access to add a church logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0] || !user) return;
    setUploadingLogo(true);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/church-logo-draft/logo.${ext}`;
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("church-media")
        .upload(path, arrayBuffer, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: true });
      if (uploadError) { Alert.alert("Upload failed", uploadError.message); return; }
      const { data } = supabase.storage.from("church-media").getPublicUrl(path);
      setLogoUrl(`${data.publicUrl}?t=${Date.now()}`);
    } finally {
      setUploadingLogo(false);
    }
  }

  function addSocialRow() {
    if (socialAccounts.length >= MAX_SOCIAL_ACCOUNTS) return;
    setSocialAccounts((prev) => [...prev, { platform: "instagram", handleOrUrl: "" }]);
  }
  function updateSocialRow(i: number, patch: Partial<ChurchSocialAccountData>) {
    setSocialAccounts((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeSocialRow(i: number) {
    setSocialAccounts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    setSubmitting(true);
    const { church, error } = await registerChurch({
      name: name.trim(),
      description: description.trim() || undefined,
      city: city.trim() || undefined,
      country: country.trim(),
      website: website.trim() || undefined,
      contactName: contactName.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      churchType: churchType ?? undefined,
      churchTypeOther: churchType === "other" ? churchTypeOther.trim() || undefined : undefined,
      locationHidden,
      logoUrl: logoUrl ?? undefined,
      socialAccounts: socialAccounts.filter((s) => s.handleOrUrl.trim()),
    });
    setSubmitting(false);
    if (error || !church) {
      Alert.alert("Couldn't register church", error ?? "Please try again.");
      return;
    }
    setCreatedChurch(church);
    setStep(5);
  }

  if (step === 5 && createdChurch) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.confirmTitle}>Your church is ready ✓</Text>
        <Text style={styles.confirmChurchName}>{createdChurch.name}</Text>
        <Text style={styles.confirmLocation}>{[createdChurch.city, createdChurch.country].filter(Boolean).join(", ")}</Text>
        {contactName ? <Text style={styles.confirmRegisteredBy}>Registered by: {contactName}</Text> : null}

        <View style={styles.freeCard}>
          <Text style={styles.freeCardText}>✓ Completely free — no subscription, no payment, no tiers. Every church gets full access to everything, always.</Text>
        </View>

        <Text style={styles.label}>Your church invite link</Text>
        <View style={styles.linkBox}>
          <Text style={styles.linkText} numberOfLines={2}>{createdChurch.inviteLink}</Text>
        </View>
        <Text style={styles.helperText}>Share this link with your congregation to invite them to your church grove.</Text>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={async () => { await Clipboard.setStringAsync(createdChurch.inviteLink); Alert.alert("Copied", "Invite link copied to clipboard."); }}
        >
          <Ionicons name="copy-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.secondaryBtnText}>Copy Invite Link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => shareChurchInvite({ name: createdChurch.name, inviteLink: createdChurch.inviteLink, city: createdChurch.city ?? "", country: createdChurch.country })}
        >
          <Ionicons name="share-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.secondaryBtnText}>Share Invite Link</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/church" as any)}>
          <Text style={styles.primaryBtnText}>Go to My Church</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const step1Valid = !!name.trim() && !!country.trim() && (churchType !== "other" || !!churchTypeOther.trim());
  const step2Valid = isPrimaryContact !== null && (isPrimaryContact || (!!contactName.trim() && !!contactEmail.trim()));

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 24) }]}>
      <TouchableOpacity onPress={() => (step === 1 ? router.back() : setStep(step - 1))} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={colors.lightGreen} />
      </TouchableOpacity>
      <Text style={styles.title}>Register Your Church</Text>
      <Text style={styles.stepIndicator}>Step {step} of {TOTAL_STEPS}</Text>

      {step === 1 && (
        <View style={styles.form}>
          <Field label="Church / Ministry Name" value={name} onChangeText={setName} placeholder="Example: Add Church Name" />
          <PickerField label="Church / Ministry Type" value={churchType} options={CHURCH_TYPES} onSelect={setChurchType} placeholder="Select a type" />
          {churchType === "other" && (
            <Field label="Please specify" value={churchTypeOther} onChangeText={setChurchTypeOther} placeholder="Example: Workplace Christian Fellowship" />
          )}

          <Text style={styles.label}>Tell us about your church (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={(v) => setDescription(v.slice(0, DESCRIPTION_MAX))}
            placeholder="Example: A local Christian community focused on biblical discipleship, prayer and serving our community."
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Text style={styles.charCounter}>{description.length}/{DESCRIPTION_MAX}</Text>

          <Field label="City" value={city} onChangeText={setCity} placeholder="City" />
          <Field label="Country" value={country} onChangeText={setCountry} placeholder="Country" />
          <TouchableOpacity style={styles.checkboxRow} onPress={() => setLocationHidden((v) => !v)}>
            <Ionicons name={locationHidden ? "checkbox" : "square-outline"} size={20} color={colors.accentGreen} />
            <Text style={styles.checkboxLabel}>Physical location not publicly displayed</Text>
          </TouchableOpacity>
          <Field label="Official Website (optional)" value={website} onChangeText={setWebsite} placeholder="https://www.examplechurch.org" autoCapitalize="none" />

          <TouchableOpacity style={[styles.primaryBtn, !step1Valid && styles.btnDisabled]} onPress={() => setStep(2)} disabled={!step1Valid}>
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 2 && (
        <View style={styles.form}>
          <Text style={styles.subtitle}>You'll be registered as this church's General Overseer.</Text>
          <Text style={styles.label}>Are you the primary contact for this church?</Text>
          <View style={styles.yesNoRow}>
            <TouchableOpacity style={[styles.yesNoBtn, isPrimaryContact === true && styles.yesNoBtnActive]} onPress={() => setIsPrimaryContact(true)}>
              <Text style={[styles.yesNoBtnText, isPrimaryContact === true && styles.yesNoBtnTextActive]}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.yesNoBtn, isPrimaryContact === false && styles.yesNoBtnActive]} onPress={() => setIsPrimaryContact(false)}>
              <Text style={[styles.yesNoBtnText, isPrimaryContact === false && styles.yesNoBtnTextActive]}>No</Text>
            </TouchableOpacity>
          </View>

          {isPrimaryContact === false && (
            <>
              <Field label="Contact First & Last Name" value={contactName} onChangeText={setContactName} placeholder="Example: Add Contact's Name" />
              <Field label="Contact Email" value={contactEmail} onChangeText={setContactEmail} placeholder="contact@example.org" keyboardType="email-address" autoCapitalize="none" />
            </>
          )}
          {isPrimaryContact === true && (
            <Text style={styles.helperText}>We'll use your account name and email ({profile?.email ?? ""}) as the church contact.</Text>
          )}

          <TouchableOpacity style={[styles.primaryBtn, !step2Valid && styles.btnDisabled]} onPress={() => setStep(3)} disabled={!step2Valid}>
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 3 && (
        <View style={styles.form}>
          <Text style={styles.label}>Church Logo (optional)</Text>
          <TouchableOpacity style={styles.logoPicker} onPress={handlePickLogo} disabled={uploadingLogo}>
            {uploadingLogo ? (
              <ActivityIndicator color={colors.accentGreen} />
            ) : logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logoPreview} />
            ) : (
              <>
                <Ionicons name="image-outline" size={28} color={colors.lightGreen} />
                <Text style={styles.logoPickerText}>Add a logo</Text>
              </>
            )}
          </TouchableOpacity>
          {logoUrl && (
            <TouchableOpacity onPress={() => setLogoUrl(null)}><Text style={styles.removeLogoText}>Remove logo</Text></TouchableOpacity>
          )}

          <Text style={[styles.label, { marginTop: 20 }]}>Social Media Presence (optional)</Text>
          <Text style={styles.helperText}>Add the social media accounts your church would like members to see on its P2P church profile.</Text>
          {socialAccounts.map((s, i) => (
            <View key={i} style={styles.socialRow}>
              <View style={{ flex: 1 }}>
                <PickerField label="Platform" value={s.platform} options={SOCIAL_PLATFORMS} onSelect={(v) => updateSocialRow(i, { platform: v })} placeholder="Platform" />
              </View>
              <View style={{ flex: 1.4 }}>
                <Field label="Handle / URL" value={s.handleOrUrl} onChangeText={(v) => updateSocialRow(i, { handleOrUrl: v })} placeholder="@examplechurch" autoCapitalize="none" />
              </View>
              <TouchableOpacity style={styles.removeSocialBtn} onPress={() => removeSocialRow(i)}>
                <Ionicons name="close-circle" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          {socialAccounts.length < MAX_SOCIAL_ACCOUNTS && (
            <TouchableOpacity style={styles.addSocialBtn} onPress={addSocialRow}>
              <Ionicons name="add" size={16} color={colors.accentGreen} />
              <Text style={styles.addSocialBtnText}>Add Social Media Account</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(4)}>
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 4 && (
        <View style={styles.form}>
          <Text style={styles.subtitle}>Review Your Church</Text>

          {duplicates.length > 0 && !duplicateWarningDismissed && (
            <View style={styles.duplicateCard}>
              <Text style={styles.duplicateCardTitle}>We found a similar church already registered</Text>
              {duplicates.slice(0, 3).map((d) => (
                <Text key={d.id} style={styles.duplicateCardItem}>• {d.name}{d.city ? `, ${d.city}` : ""}, {d.country}</Text>
              ))}
              <Text style={styles.duplicateCardHelp}>If this is your church, ask its leadership for their invite code instead of registering a duplicate. Otherwise, it's fine to continue.</Text>
              <TouchableOpacity onPress={() => setDuplicateWarningDismissed(true)}><Text style={styles.duplicateCardDismiss}>Continue anyway</Text></TouchableOpacity>
            </View>
          )}

          <ReviewSection title="Church Information">
            <ReviewRow label="Name" value={name} />
            <ReviewRow label="Type" value={churchType === "other" ? churchTypeOther : CHURCH_TYPES.find((t) => t.value === churchType)?.label} />
            {!!description && <ReviewRow label="Description" value={description} />}
            <ReviewRow label="Location" value={[city, country].filter(Boolean).join(", ")} />
            {locationHidden && <ReviewRow label="Location visibility" value="Hidden from public profile" />}
            {!!website && <ReviewRow label="Website" value={website} />}
          </ReviewSection>
          <ReviewSection title="Contact">
            <ReviewRow label="Contact name" value={contactName} />
            <ReviewRow label="Contact email" value={contactEmail} />
          </ReviewSection>
          {socialAccounts.filter((s) => s.handleOrUrl.trim()).length > 0 && (
            <ReviewSection title="Social Media">
              {socialAccounts.filter((s) => s.handleOrUrl.trim()).map((s, i) => (
                <ReviewRow key={i} label={SOCIAL_PLATFORMS.find((p) => p.value === s.platform)?.label ?? s.platform} value={s.handleOrUrl} />
              ))}
            </ReviewSection>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit Church Registration</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.reviewSection}>
      <Text style={styles.reviewSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewRowLabel}>{label}</Text>
      <Text style={styles.reviewRowValue}>{value}</Text>
    </View>
  );
}

function Field(props: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: any; autoCapitalize?: any }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize ?? "words"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  content: { paddingHorizontal: 28, paddingBottom: 60 },
  backBtn: { marginBottom: 20 },
  title: { fontSize: 24, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  stepIndicator: { fontSize: 13, color: colors.lightGreen, opacity: 0.7, marginTop: 4, marginBottom: 24, fontFamily: "Inter_400Regular" },
  form: { gap: 4 },
  subtitle: { fontSize: 15, color: colors.cream, marginBottom: 16, fontFamily: "Inter_600SemiBold" },
  label: { color: colors.lightGreen, fontSize: 13, opacity: 0.75, marginBottom: 6, fontFamily: "Inter_500Medium" },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, padding: 14, color: colors.cream, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  charCounter: { fontSize: 11, color: colors.textMuted, textAlign: "right", marginTop: 4, marginBottom: 12, fontFamily: "Inter_400Regular" },
  helperText: { fontSize: 12, color: colors.textMuted, marginTop: -8, marginBottom: 16, fontFamily: "Inter_400Regular" },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, padding: 14,
  },
  pickerBtnText: { color: colors.cream, fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.darkBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.cream, marginBottom: 10, fontFamily: "Inter_700Bold" },
  optionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  optionRowText: { color: colors.cream, fontSize: 14, fontFamily: "Inter_400Regular" },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16, marginTop: 2 },
  checkboxLabel: { color: colors.lightGreen, fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  yesNoRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  yesNoBtn: { flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
  yesNoBtnActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  yesNoBtnText: { color: colors.lightGreen, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  yesNoBtnTextActive: { color: "#fff" },
  logoPicker: {
    width: 96, height: 96, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 8,
  },
  logoPreview: { width: 96, height: 96, borderRadius: 16 },
  logoPickerText: { color: colors.lightGreen, fontSize: 11, marginTop: 6, fontFamily: "Inter_400Regular" },
  removeLogoText: { color: "#F87171", fontSize: 12, marginBottom: 12, fontFamily: "Inter_500Medium" },
  socialRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  removeSocialBtn: { paddingTop: 34 },
  addSocialBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 20, marginTop: 4 },
  addSocialBtnText: { color: colors.accentGreen, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  duplicateCard: {
    backgroundColor: "rgba(217,119,6,0.1)", borderWidth: 1, borderColor: "rgba(217,119,6,0.3)",
    borderRadius: 12, padding: 14, marginBottom: 16, gap: 4,
  },
  duplicateCardTitle: { color: "#D97706", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  duplicateCardItem: { color: colors.cream, fontSize: 12, fontFamily: "Inter_400Regular" },
  duplicateCardHelp: { color: colors.textMuted, fontSize: 11, marginTop: 4, fontFamily: "Inter_400Regular" },
  duplicateCardDismiss: { color: "#D97706", fontSize: 12, fontWeight: "600", marginTop: 6, fontFamily: "Inter_600SemiBold" },
  reviewSection: { marginBottom: 16 },
  reviewSectionTitle: { color: colors.accentGreen, fontSize: 12, fontWeight: "700", marginBottom: 6, fontFamily: "Inter_700Bold" },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 },
  reviewRowLabel: { color: colors.textMuted, fontSize: 12, fontFamily: "Inter_400Regular" },
  reviewRowValue: { color: colors.cream, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 52, marginTop: 20,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
  confirmTitle: { fontSize: 22, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  confirmChurchName: { fontSize: 18, fontWeight: "700", color: colors.accentGreen, marginTop: 12, fontFamily: "Inter_700Bold" },
  confirmLocation: { fontSize: 13, color: colors.lightGreen, opacity: 0.8, marginTop: 2, fontFamily: "Inter_400Regular" },
  confirmRegisteredBy: { fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: "Inter_400Regular" },
  freeCard: { backgroundColor: "rgba(29,158,117,0.1)", borderWidth: 1, borderColor: "rgba(29,158,117,0.3)", borderRadius: 12, padding: 14, marginTop: 20, marginBottom: 24 },
  freeCardText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium", lineHeight: 18 },
  linkBox: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, padding: 12 },
  linkText: { fontSize: 13, color: colors.cream, fontFamily: "Inter_400Regular" },
  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, height: 46, marginTop: 12,
  },
  secondaryBtnText: { color: colors.accentGreen, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
});