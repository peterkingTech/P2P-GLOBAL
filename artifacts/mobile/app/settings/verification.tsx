import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, Image, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";

const MIN_ACCOUNT_AGE_DAYS = 14;

type Method = "selfie_note" | "video_selfie";
type Step = "intro" | "method" | "instructions" | "preview";

const DECLINE_REASON_LABELS: Record<string, string> = {
  face_mismatch: "The photo did not clearly match your profile photo.",
  image_unclear: "The photo or video was too dark or unclear to confirm your identity.",
  no_note_visible: "The note with your username and date wasn't visible or readable.",
  note_incorrect: "The note didn't show the correct username or date.",
  suspected_fake: "We couldn't confirm this was a live, unedited photo or video.",
  other: "We were unable to verify your identity with the submission provided.",
};

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function VerificationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { verificationStatus, loadVerificationStatus, submitVerification, withdrawVerification, toggleBadgeVisibility } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("intro");
  const [method, setMethod] = useState<Method | null>(null);
  const [asset, setAsset] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmChecks, setConfirmChecks] = useState({ face: false, note: false, reviewed: false, deleted: false });

  useEffect(() => {
    loadVerificationStatus().finally(() => setLoading(false));
  }, [loadVerificationStatus]);

  const accountAgeDays = profile?.createdAt ? Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / (24 * 60 * 60 * 1000)) : 0;
  const hasPhoto = !!profile?.avatarUrl;
  const meetsRequirements = hasPhoto && accountAgeDays >= MIN_ACCOUNT_AGE_DAYS;

  function resetFlow() {
    setStep("intro");
    setMethod(null);
    setAsset(null);
    setConfirmChecks({ face: false, note: false, reviewed: false, deleted: false });
  }

  async function pickMedia(m: Method) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert("Camera access needed", "Please allow camera access to take your verification selfie.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync(
      m === "video_selfie"
        ? { mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 10, cameraType: ImagePicker.CameraType.front, quality: 0.8 }
        : { mediaTypes: ImagePicker.MediaTypeOptions.Images, cameraType: ImagePicker.CameraType.front, quality: 0.8 }
    );
    if (result.canceled || !result.assets?.[0]) return;
    const picked = result.assets[0];
    const ext = picked.uri.split(".").pop()?.toLowerCase() ?? (m === "video_selfie" ? "mp4" : "jpg");
    const type = m === "video_selfie" ? `video/${ext === "mov" ? "quicktime" : "mp4"}` : `image/${ext === "png" ? "png" : "jpeg"}`;
    setAsset({ uri: picked.uri, name: `verification.${ext}`, type });
    setStep("preview");
  }

  function chooseMethod(m: Method) {
    setMethod(m);
    setStep("instructions");
  }

  async function handleSubmit() {
    if (!method || !asset) return;
    setSubmitting(true);
    const err = await submitVerification(method, asset.uri, asset.name, asset.type);
    setSubmitting(false);
    if (err) {
      showAlert("Couldn't submit", err);
      return;
    }
    resetFlow();
  }

  function confirmWithdraw() {
    Alert.alert(
      "Withdraw your application?",
      "Your submitted photo/video will be deleted immediately. You can reapply anytime.",
      [
        { text: "Keep Application", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: handleWithdraw },
      ]
    );
  }

  async function handleWithdraw() {
    setWithdrawing(true);
    const err = await withdrawVerification();
    setWithdrawing(false);
    if (err) showAlert("Couldn't withdraw", err);
  }

  const allChecked = confirmChecks.face && confirmChecks.note && confirmChecks.reviewed && confirmChecks.deleted;

  if (loading || !verificationStatus) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
        <SettingsSubHeader title="Verification" />
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Verification" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>

        {verificationStatus.status === "approved" && (
          <View style={styles.card}>
            <View style={styles.approvedHeaderRow}>
              <View style={styles.checkCircle}><Ionicons name="checkmark" size={16} color="#fff" /></View>
              <Text style={styles.approvedTitle}>You are Verified</Text>
            </View>
            {verificationStatus.approvedAt && (
              <Text style={styles.mutedLine}>Verified since {new Date(verificationStatus.approvedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</Text>
            )}
            <Text style={styles.bodyText}>Your blue tick is visible on your profile and everywhere your username appears.</Text>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Show my verification badge</Text>
              <Switch
                value={verificationStatus.badgeVisible}
                onValueChange={(v: boolean) => { toggleBadgeVisibility(v); }}
                trackColor={{ true: colors.accentGreen }}
              />
            </View>
            <Text style={styles.hintText}>Hide this if you prefer not to display the badge on your profile.</Text>

            <Text style={styles.sectionLabel}>VERIFICATION DETAILS</Text>
            <Text style={styles.detailLine}>Method: {verificationStatus.method === "selfie_note" ? "Selfie with note" : verificationStatus.method === "video_selfie" ? "Short video selfie" : "Manually granted"}</Text>
            <Text style={styles.detailLine}>Submission: Permanently deleted ✓</Text>
          </View>
        )}

        {verificationStatus.status === "pending" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Verification Pending</Text>
            <Text style={styles.bodyText}>Your application is being reviewed.</Text>
            {verificationStatus.submittedAt && (
              <Text style={styles.mutedLine}>
                Submitted: {new Date(verificationStatus.submittedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} at {new Date(verificationStatus.submittedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </Text>
            )}
            <Text style={styles.mutedLine}>Estimated decision: within 72 hours</Text>
            <Text style={styles.hintText}>Your submission will be permanently deleted after a decision is made.</Text>
            <TouchableOpacity style={styles.withdrawBtn} onPress={confirmWithdraw} disabled={withdrawing}>
              {withdrawing ? <ActivityIndicator color="#B91C1C" size="small" /> : <Text style={styles.withdrawBtnText}>Withdraw Application</Text>}
            </TouchableOpacity>
          </View>
        )}

        {verificationStatus.status === "declined" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Verification Declined</Text>
            <Text style={styles.bodyText}>We were unable to verify your identity with the submission provided.</Text>
            <View style={styles.reasonBox}>
              <Text style={styles.reasonText}>
                {DECLINE_REASON_LABELS[verificationStatus.declineReason ?? "other"]}
              </Text>
            </View>
            {verificationStatus.canReapplyAt && (
              <Text style={styles.mutedLine}>
                You can reapply from: {new Date(verificationStatus.canReapplyAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </Text>
            )}
            <Text style={styles.sectionLabel}>TIPS FOR REAPPLYING</Text>
            <Text style={styles.tipLine}>✓ Use natural or bright indoor lighting</Text>
            <Text style={styles.tipLine}>✓ Make sure your face fills most of the frame</Text>
            <Text style={styles.tipLine}>✓ Ensure the note text is clearly readable</Text>
            <Text style={styles.tipLine}>✓ Use a fresh photo — not a screenshot</Text>
            {verificationStatus.canReapplyAt && new Date(verificationStatus.canReapplyAt).getTime() <= Date.now() && (
              <TouchableOpacity style={styles.primaryBtn} onPress={resetFlow}>
                <Text style={styles.primaryBtnText}>Apply Again</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {(verificationStatus.status === "unverified" || verificationStatus.status === "revoked") && step === "intro" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Get Verified on P2P Global</Text>
            <Text style={styles.tipLine}>✓ Build trust with peer guides and learners</Text>
            <Text style={styles.tipLine}>✓ Appear higher in matching results</Text>
            <Text style={styles.tipLine}>✓ Access verified-only circles</Text>
            <Text style={styles.tipLine}>✓ Show the blue tick on your profile</Text>

            <Text style={styles.sectionLabel}>REQUIREMENTS</Text>
            <View style={styles.reqRow}>
              <Ionicons name={hasPhoto ? "checkmark-circle" : "close-circle"} size={16} color={hasPhoto ? colors.accentGreen : "#F87171"} />
              <Text style={styles.reqText}>{hasPhoto ? "Profile photo added — good" : "Add a profile photo first"}</Text>
            </View>
            <View style={styles.reqRow}>
              <Ionicons name={accountAgeDays >= MIN_ACCOUNT_AGE_DAYS ? "checkmark-circle" : "close-circle"} size={16} color={accountAgeDays >= MIN_ACCOUNT_AGE_DAYS ? colors.accentGreen : "#F87171"} />
              <Text style={styles.reqText}>
                {accountAgeDays >= MIN_ACCOUNT_AGE_DAYS ? `Account age: ${accountAgeDays} days — good` : `Account age: ${accountAgeDays} of ${MIN_ACCOUNT_AGE_DAYS} days required`}
              </Text>
            </View>

            {!hasPhoto && (
              <TouchableOpacity style={styles.primaryBtnOutline} onPress={() => router.push("/settings/account" as any)}>
                <Text style={styles.primaryBtnOutlineText}>Go to Profile Settings</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, !meetsRequirements && styles.primaryBtnDisabled]}
              onPress={() => setStep("method")}
              disabled={!meetsRequirements}
            >
              <Text style={styles.primaryBtnText}>Start Verification →</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "method" && (
          <View>
            <Text style={styles.flowTitle}>Choose your verification method</Text>
            <Text style={styles.flowSubtitle}>Both methods are quick, free, and private. Your submission is reviewed within 72 hours and deleted immediately after the decision.</Text>

            <TouchableOpacity style={styles.methodCard} onPress={() => chooseMethod("selfie_note")}>
              <Text style={styles.methodTitle}>📸 Selfie with a note</Text>
              <Text style={styles.methodBody}>
                Write your @username and today's date on a piece of paper and take a clear selfie holding it.
              </Text>
              <Text style={styles.methodExample}>Example: "@{profile?.username ?? "yourusername"}  {new Date().toLocaleDateString("en-GB")}"</Text>
              <Text style={styles.tipLine}>✓ Easiest method</Text>
              <Text style={styles.tipLine}>✓ Reviewed within 24–72 hours</Text>
              <View style={styles.chooseBtn}><Text style={styles.chooseBtnText}>Choose this</Text></View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.methodCard} onPress={() => chooseMethod("video_selfie")}>
              <Text style={styles.methodTitle}>🎥 Short video selfie</Text>
              <Text style={styles.methodBody}>
                Record a 3–5 second video clearly showing your face. No note needed — just look directly at the camera and move your head slightly so we can confirm it's a real person.
              </Text>
              <Text style={styles.tipLine}>✓ Quick — under 10 seconds</Text>
              <Text style={styles.tipLine}>✓ Reviewed within 24–72 hours</Text>
              <View style={styles.chooseBtn}><Text style={styles.chooseBtnText}>Choose this</Text></View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.backLink} onPress={resetFlow}><Text style={styles.backLinkText}>Cancel</Text></TouchableOpacity>
          </View>
        )}

        {step === "instructions" && method && (
          <View>
            <Text style={styles.flowTitle}>{method === "selfie_note" ? "Selfie with Note" : "Short Video Selfie"}</Text>

            {method === "selfie_note" ? (
              <>
                <Text style={styles.flowSubtitle}>Write this on a piece of paper:</Text>
                <View style={styles.noteBox}>
                  <Text style={styles.noteBoxText}>@{profile?.username ?? "yourusername"}</Text>
                  <Text style={styles.noteBoxText}>{new Date().toLocaleDateString("en-GB")}</Text>
                </View>
                <Text style={styles.flowSubtitle}>Then take a clear selfie:</Text>
                <Text style={styles.tipLine}>✓ Face clearly visible — no sunglasses</Text>
                <Text style={styles.tipLine}>✓ Paper clearly readable</Text>
                <Text style={styles.tipLine}>✓ Good lighting</Text>
                <Text style={styles.tipLine}>✓ Your face matches your profile photo</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => pickMedia("selfie_note")}>
                  <Text style={styles.primaryBtnText}>📷 Take Photo</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.flowSubtitle}>Record a 3–5 second video:</Text>
                <Text style={styles.tipLine}>✓ Look directly at the camera</Text>
                <Text style={styles.tipLine}>✓ Slowly turn your head left then right</Text>
                <Text style={styles.tipLine}>✓ No filters or effects</Text>
                <Text style={styles.tipLine}>✓ Good lighting — face clearly visible</Text>
                <Text style={styles.tipLine}>✓ Your face must match your profile photo</Text>
                <Text style={styles.hintText}>Max file size: 50MB · Accepted formats: MP4, MOV</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => pickMedia("video_selfie")}>
                  <Text style={styles.primaryBtnText}>🎥 Record Video</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.privacyPromise}>
              Privacy promise: Your {method === "video_selfie" ? "video" : "photo"} is reviewed by our team and permanently deleted after the decision. It is never shown to other users.
            </Text>

            <TouchableOpacity style={styles.backLink} onPress={() => setStep("method")}><Text style={styles.backLinkText}>← Back</Text></TouchableOpacity>
          </View>
        )}

        {step === "preview" && asset && method && (
          <View>
            <Text style={styles.flowTitle}>Review your submission</Text>
            {method === "selfie_note" ? (
              <Image source={{ uri: asset.uri }} style={styles.previewImage} />
            ) : (
              <View style={styles.previewVideoPlaceholder}>
                <Ionicons name="videocam" size={32} color={colors.accentGreen} />
                <Text style={styles.mutedLine}>Video ready to submit</Text>
              </View>
            )}
            <Text style={styles.mutedLine}>Submission type: {method === "selfie_note" ? "Selfie with note" : "Video selfie"}</Text>

            <Text style={styles.sectionLabel}>BEFORE SUBMITTING CONFIRM</Text>
            {([
              ["face", "My face is clearly visible"],
              ["note", method === "selfie_note" ? "The note shows my @username and today's date" : "My video clearly shows my face moving"],
              ["reviewed", "I understand this will be reviewed by the P2P Global team"],
              ["deleted", "I understand the submission will be deleted after review"],
            ] as const).map(([key, label]) => (
              <TouchableOpacity key={key} style={styles.checkRow} onPress={() => setConfirmChecks((p) => ({ ...p, [key]: !p[key] }))}>
                <Ionicons name={confirmChecks[key] ? "checkbox" : "square-outline"} size={20} color={confirmChecks[key] ? colors.accentGreen : colors.textMuted} />
                <Text style={styles.checkLabel}>{label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={[styles.primaryBtn, !allChecked && styles.primaryBtnDisabled]} onPress={handleSubmit} disabled={!allChecked || submitting}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Submit for Review</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.backLink} onPress={() => setStep("instructions")}><Text style={styles.backLinkText}>Start Over</Text></TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 18, marginBottom: 16 },
    cardTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, marginBottom: 10, fontFamily: "Inter_700Bold" },
    approvedHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    checkCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
    approvedTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    bodyText: { fontSize: 14, color: c.textMid, lineHeight: 20, marginTop: 4, marginBottom: 8, fontFamily: "Inter_400Regular" },
    mutedLine: { fontSize: 12, color: c.textMuted, marginBottom: 4, fontFamily: "Inter_400Regular" },
    hintText: { fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 12, fontStyle: "italic", fontFamily: "Inter_400Regular" },
    sectionLabel: { fontSize: 11, fontWeight: "700", color: c.textMuted, marginTop: 14, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter_700Bold" },
    detailLine: { fontSize: 13, color: c.textDark, marginBottom: 4, fontFamily: "Inter_400Regular" },
    toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
    toggleLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium", flex: 1, marginRight: 10 },
    withdrawBtn: { marginTop: 16, borderWidth: 1.5, borderColor: "#B91C1C", borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
    withdrawBtnText: { color: "#B91C1C", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    reasonBox: { backgroundColor: c.lightCream, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, padding: 12, marginTop: 8, marginBottom: 8 },
    reasonText: { fontSize: 13, color: c.textDark, lineHeight: 19, fontFamily: "Inter_400Regular" },
    tipLine: { fontSize: 13, color: c.textMid, marginBottom: 6, fontFamily: "Inter_400Regular" },
    reqRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    reqText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular" },
    primaryBtn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 48, alignItems: "center", justifyContent: "center", marginTop: 16 },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
    primaryBtnOutline: { borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center", marginTop: 12 },
    primaryBtnOutlineText: { color: c.accentGreen, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    flowTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, marginBottom: 8, fontFamily: "Inter_700Bold" },
    flowSubtitle: { fontSize: 13, color: c.textMid, lineHeight: 19, marginBottom: 12, fontFamily: "Inter_400Regular" },
    methodCard: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 14 },
    methodTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, marginBottom: 6, fontFamily: "Inter_700Bold" },
    methodBody: { fontSize: 13, color: c.textMid, lineHeight: 19, marginBottom: 8, fontFamily: "Inter_400Regular" },
    methodExample: { fontSize: 12, color: c.textMuted, marginBottom: 10, fontStyle: "italic", fontFamily: "Inter_400Regular" },
    chooseBtn: { backgroundColor: c.accentGreen, borderRadius: 10, height: 40, alignItems: "center", justifyContent: "center", marginTop: 10 },
    chooseBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
    noteBox: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 16, alignItems: "center", marginBottom: 16 },
    noteBoxText: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    privacyPromise: { fontSize: 12, color: c.textMuted, marginTop: 16, lineHeight: 18, fontFamily: "Inter_400Regular" },
    backLink: { alignItems: "center", marginTop: 16, paddingVertical: 6 },
    backLinkText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium" },
    previewImage: { width: "100%", aspectRatio: 1, borderRadius: 14, marginBottom: 12, backgroundColor: c.card },
    previewVideoPlaceholder: {
      width: "100%", height: 160, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 12,
    },
    checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
    checkLabel: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular" },
  });
}