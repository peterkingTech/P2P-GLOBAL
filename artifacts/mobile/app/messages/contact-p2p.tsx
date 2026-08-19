import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Modal, Image, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "@/contexts/AuthContext";
import { useData, ContactDepartment } from "@/contexts/DataContext";
import colors from "@/constants/colors";

interface DeptInfo {
  key: ContactDepartment; label: string; icon: string; description: string; estimatedResponse: string;
}
const DEPARTMENTS: DeptInfo[] = [
  { key: "help_request", label: "Help Request Department", icon: "🆘", description: "For personal help and support needs", estimatedResponse: "within 24 to 48 hours" },
  { key: "crisis_response", label: "Crisis Response Department", icon: "🛡️", description: "For urgent pastoral needs", estimatedResponse: "as soon as possible" },
  { key: "p2p_support", label: "P2P Support Department", icon: "💬", description: "For app issues and technical questions", estimatedResponse: "within 24 to 48 hours" },
  { key: "marketing", label: "Marketing Department", icon: "📢", description: "For partnerships, feedback, and suggestions", estimatedResponse: "within 3 to 5 business days" },
];

const THANK_YOU_MESSAGES: Record<ContactDepartment, string> = {
  help_request: "Thank you for reaching out to the Help Request Department. A member of our pastoral team will respond to you as soon as possible.",
  crisis_response: "Thank you for contacting the Crisis Response Department. Our team will respond as quickly as possible.",
  p2p_support: "Thank you for messaging the P2P Support Department. A member of the team will reach out to you as soon as possible.",
  marketing: "Thank you for your message to the Marketing Department. We read every message and appreciate your feedback.",
};

function SentConfirmation({ department, referenceNumber }: { department: DeptInfo | undefined; referenceNumber: string }) {
  const router = useRouter();
  return (
    <View style={styles.confirmationContainer}>
      <View style={styles.confirmationIcon}>
        <Text style={{ fontSize: 48 }}>✉️</Text>
      </View>
      <Text style={styles.confirmationTitle}>Message sent</Text>
      <Text style={styles.confirmationBody}>
        {THANK_YOU_MESSAGES[department?.key ?? "p2p_support"]}
      </Text>
      <View style={styles.referenceBox}>
        <Text style={styles.referenceLabel}>Your reference number:</Text>
        <Text style={styles.referenceNumber}>{referenceNumber}</Text>
        <Text style={styles.referenceHint}>Keep this for your records</Text>
      </View>
      <Text style={styles.replyNote}>We will reply via your P2P Global messages inbox.</Text>
      <TouchableOpacity style={styles.viewMessagesButton} onPress={() => router.push("/messages/my-contact-messages" as any)}>
        <Text style={styles.viewMessagesText}>View My Sent Messages</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/(tabs)/messages" as any)}>
        <Text style={styles.backText}>Back to Messages</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ContactP2P() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { sendContactMessage } = useData();

  const [department, setDepartment] = useState<ContactDepartment | "">("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [showDepartmentPicker, setShowDepartmentPicker] = useState(false);

  const selectedDept = DEPARTMENTS.find((d) => d.key === department);

  async function handleSend() {
    if (!department) return;
    setSending(true);
    setSendError(null);
    const result = await sendContactMessage({ toDepartment: department, subject: subject.trim(), body: body.trim() });
    setSending(false);
    if (!result.success || !result.referenceNumber) {
      setSendError(result.error ?? "Failed to send message. Please try again.");
      return;
    }
    setReferenceNumber(result.referenceNumber);
    setSent(true);
  }

  if (sent) return <SentConfirmation department={selectedDept} referenceNumber={referenceNumber} />;

  const subjectValid = subject.trim().length >= 5;
  const bodyValid = body.trim().length >= 20;
  const canSend = !!department && subjectValid && bodyValid && !sending;

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + (Platform.OS === "web" ? 20 : 12), paddingBottom: insets.bottom + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contact P2P Global</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>FROM</Text>
          <View style={styles.fromBox}>
            {profile?.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.fromAvatar} />
            ) : (
              <View style={styles.fromAvatarFallback}>
                <Text style={styles.fromAvatarFallbackText}>{profile?.displayName?.charAt(0)?.toUpperCase() ?? "?"}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.fromUsername}>@{profile?.username ?? "you"}</Text>
              <Text style={styles.fromName}>{profile?.displayName}</Text>
              <Text style={styles.fromEmail}>{user?.email}</Text>
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>TO</Text>
          <TouchableOpacity style={styles.departmentPicker} onPress={() => setShowDepartmentPicker(true)}>
            {selectedDept ? (
              <View style={styles.selectedDept}>
                <Text style={{ fontSize: 18 }}>{selectedDept.icon}</Text>
                <Text style={styles.selectedDeptLabel}>{selectedDept.label}</Text>
              </View>
            ) : (
              <Text style={styles.placeholderText}>Select department ▼</Text>
            )}
          </TouchableOpacity>
        </View>

        <Modal visible={showDepartmentPicker} transparent animationType="slide" onRequestClose={() => setShowDepartmentPicker(false)}>
          <View style={styles.pickerModal}>
            <View style={styles.pickerCard}>
              <Text style={styles.pickerTitle}>Select Department</Text>
              {DEPARTMENTS.map((dept) => (
                <TouchableOpacity
                  key={dept.key}
                  style={styles.deptOption}
                  onPress={() => { setDepartment(dept.key); setShowDepartmentPicker(false); }}
                >
                  <Text style={{ fontSize: 20 }}>{dept.icon}</Text>
                  <View style={styles.deptOptionText}>
                    <Text style={styles.deptOptionLabel}>{dept.label}</Text>
                    <Text style={styles.deptOptionDesc}>{dept.description}</Text>
                    <Text style={styles.deptOptionEta}>Response {dept.estimatedResponse}</Text>
                  </View>
                  {department === dept.key && <Ionicons name="checkmark" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowDepartmentPicker(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>SUBJECT</Text>
          <TextInput
            style={styles.subjectInput}
            value={subject}
            onChangeText={setSubject}
            placeholder="Brief description of your message"
            placeholderTextColor={colors.textMuted}
            maxLength={200}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>MESSAGE</Text>
          <TextInput
            style={styles.messageInput}
            value={body}
            onChangeText={setBody}
            placeholder="Write your message here..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={8}
            maxLength={2000}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{body.length}/2000</Text>
        </View>

        {sendError && <Text style={styles.errorText}>{sendError}</Text>}

        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!canSend}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={styles.sendButtonText}>Send Message</Text>
            </>
          )}
        </TouchableOpacity>

        {body.length > 0 && body.trim().length < 20 && (
          <Text style={styles.validationHint}>Message must be at least 20 characters</Text>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 16 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, gap: 18 },
  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  fromBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12,
  },
  fromAvatar: { width: 40, height: 40, borderRadius: 20 },
  fromAvatarFallback: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
  fromAvatarFallbackText: { fontSize: 16, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  fromUsername: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  fromName: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  fromEmail: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  departmentPicker: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 14, minHeight: 50, justifyContent: "center",
  },
  placeholderText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  selectedDept: { flexDirection: "row", alignItems: "center", gap: 10 },
  selectedDeptLabel: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  pickerModal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  pickerCard: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  pickerTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
  deptOption: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  deptOptionText: { flex: 1, gap: 2 },
  deptOptionLabel: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  deptOptionDesc: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  deptOptionEta: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  cancelButton: { alignItems: "center", paddingVertical: 14, marginTop: 6 },
  cancelText: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  subjectInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 14, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  messageInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 14, minHeight: 140, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  charCount: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "right" },
  errorText: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium" },
  sendButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 52,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  validationHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -8 },

  confirmationContainer: { flex: 1, backgroundColor: colors.lightCream, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  confirmationIcon: { marginBottom: 4 },
  confirmationTitle: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  confirmationBody: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  referenceBox: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14,
    padding: 18, alignItems: "center", gap: 4, marginTop: 8, width: "100%",
  },
  referenceLabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  referenceNumber: { fontSize: 18, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  referenceHint: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  replyNote: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center" },
  viewMessagesButton: {
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center",
    width: "100%", marginTop: 10,
  },
  viewMessagesText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  backButton: { alignItems: "center", paddingVertical: 10 },
  backText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
});