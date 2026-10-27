import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { describeError } from "@/lib/studioModel";

// Shared Publishing Studio building blocks, styled with the admin
// dashboard's existing palette (constants/colors) and Inter type scale.

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Loading / empty / error / permission-denied / not-installed states, with a retry where it can help. */
export function StateView({ loading, error, empty, emptyText, onRetry }: {
  loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string; onRetry?: () => void;
}) {
  if (loading) {
    return (
      <View style={s.state} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator color={colors.primaryGreen} />
        <Text style={s.stateText}>Loading…</Text>
      </View>
    );
  }
  if (error) {
    const d = describeError(error);
    const icon: IconName = d.kind === "permission" || d.kind === "unauthenticated" ? "lock-closed-outline"
      : d.kind === "not_installed" ? "construct-outline" : d.kind === "network" ? "cloud-offline-outline" : "alert-circle-outline";
    const retryable = d.kind !== "permission" && d.kind !== "unauthenticated";
    return (
      <View style={s.state} accessibilityRole="alert">
        <Ionicons name={icon} size={30} color={d.kind === "permission" ? colors.textMuted : colors.amber} />
        <Text style={s.stateTitle}>{d.title}</Text>
        <Text style={s.stateText}>{d.message}</Text>
        {retryable && onRetry ? <Button label="Try again" icon="refresh" tone="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={s.state}>
        <Ionicons name="file-tray-outline" size={28} color={colors.textMuted} />
        <Text style={s.stateText}>{emptyText ?? "Nothing here yet."}</Text>
      </View>
    );
  }
  return null;
}

/** Inline result banner after an action (success or error). */
export function Banner({ tone, text, onDismiss }: { tone: "success" | "error" | "info"; text: string; onDismiss?: () => void }) {
  const bg = tone === "success" ? "#E3F4EC" : tone === "error" ? "#FBE7E4" : colors.cardBeige;
  const fg = tone === "success" ? colors.primaryGreen : tone === "error" ? "#9B2C1F" : colors.textMid;
  return (
    <View style={[s.banner, { backgroundColor: bg }]} accessibilityRole={tone === "error" ? "alert" : "summary"} accessibilityLiveRegion="polite">
      <Ionicons name={tone === "success" ? "checkmark-circle" : tone === "error" ? "alert-circle" : "information-circle"} size={16} color={fg} />
      <Text style={[s.bannerText, { color: fg }]}>{text}</Text>
      {onDismiss ? (
        <TouchableOpacity onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss message" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={16} color={fg} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const CHIP_TONES = {
  green: { bg: "#E3F4EC", fg: colors.primaryGreen },
  amber: { bg: "#FBF0DC", fg: "#8A5410" },
  red: { bg: "#FBE7E4", fg: "#9B2C1F" },
  grey: { bg: colors.cardBeige, fg: colors.textMid },
  blue: { bg: "#E4EEF8", fg: "#1F4E79" },
};
export type ChipTone = keyof typeof CHIP_TONES;
export const nativeTone = (s: string): ChipTone => (s === "published" ? "green" : s === "submitted" || s === "review" ? "amber" : "grey");
export const reviewTone = (r: string): ChipTone => (r === "approved" ? "green" : r === "changes_requested" ? "red" : r === "in_review" ? "amber" : "grey");
/** Status label: always text (never color alone). */
export function Chip({ label, tone = "grey" }: { label: string; tone?: ChipTone }) {
  const t = CHIP_TONES[tone];
  return <View style={[s.chip, { backgroundColor: t.bg }]}><Text style={[s.chipText, { color: t.fg }]}>{label}</Text></View>;
}

export function Button({ label, onPress, icon, tone = "primary", disabled, busy, accessibilityHint }: {
  label: string; onPress: () => void; icon?: IconName; tone?: "primary" | "secondary" | "danger"; disabled?: boolean; busy?: boolean; accessibilityHint?: string;
}) {
  const style = tone === "primary" ? s.btnPrimary : tone === "danger" ? s.btnDanger : s.btnSecondary;
  const fg = tone === "secondary" ? colors.primaryGreen : "#fff";
  return (
    <TouchableOpacity
      style={[s.btn, style, (disabled || busy) && s.btnDisabled]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={15} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Selectable filter / option pill. */
export function Pill({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[s.pill, selected && s.pillActive, disabled && s.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      aria-selected={selected}
    >
      <Text style={[s.pillText, selected && s.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Confirmation dialog for consequential actions. A Modal rather than
 * Alert.alert so it works the same on web and native, and can collect a note.
 */
export function ConfirmDialog({ visible, title, message, confirmLabel, tone = "primary", notePrompt, noteRequired, confirmText, busy, onConfirm, onCancel }: {
  visible: boolean; title: string; message: string; confirmLabel: string; tone?: "primary" | "danger";
  notePrompt?: string; noteRequired?: boolean;
  /** When set, the note field must equal this text exactly (e.g. "PERMANENTLY DELETE"). */
  confirmText?: string;
  busy?: boolean;
  onConfirm: (note: string) => void; onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => { if (visible) setNote(""); }, [visible]);
  // Keep showing the last content while the dialog fades out, so it never
  // flashes empty after the caller clears what it was confirming.
  const shown = useRef({ title, message, confirmLabel, tone, notePrompt, noteRequired, confirmText });
  if (visible) shown.current = { title, message, confirmLabel, tone, notePrompt, noteRequired, confirmText };
  const c = shown.current;
  const blocked = (!!c.noteRequired && !note.trim()) || (!!c.confirmText && note.trim() !== c.confirmText);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.dialog} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={s.dialogTitle}>{c.title}</Text>
          <Text style={s.dialogText}>{c.message}</Text>
          {c.notePrompt ? (
            <>
              <Text style={s.label} nativeID="studio-confirm-note">{c.notePrompt}{c.noteRequired && !c.confirmText ? " (required)" : ""}</Text>
              <TextInput
                style={[s.input, { minHeight: c.confirmText ? 44 : 70 }]}
                value={note}
                onChangeText={setNote}
                multiline={!c.confirmText}
                autoCapitalize={c.confirmText ? "characters" : "sentences"}
                autoCorrect={!c.confirmText}
                maxLength={2000}
                accessibilityLabelledBy="studio-confirm-note"
                accessibilityLabel={c.notePrompt}
              />
            </>
          ) : null}
          <View style={s.dialogRow}>
            <Button label="Cancel" tone="secondary" onPress={onCancel} disabled={busy || !visible} />
            <Button label={c.confirmLabel} tone={c.tone} onPress={() => onConfirm(note.trim())} disabled={blocked || !visible} busy={busy}
              accessibilityHint={blocked ? (c.confirmText ? `Type ${c.confirmText} first` : "Enter a note first") : undefined} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Previous / next paging with a readable "x–y of N" label. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const from = total ? page * pageSize + 1 : 0, to = Math.min(total, (page + 1) * pageSize);
  return (
    <View style={s.pager}>
      <Button label="Previous" icon="chevron-back" tone="secondary" disabled={page === 0} onPress={() => onPage(page - 1)} accessibilityHint="Show the previous page" />
      <Text style={s.pagerText} accessibilityLiveRegion="polite">{total ? `${from}–${to} of ${total}` : "No results"}</Text>
      <Button label="Next" icon="chevron-forward" tone="secondary" disabled={(page + 1) * pageSize >= total} onPress={() => onPage(page + 1)} accessibilityHint="Show the next page" />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export const studioStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 14, gap: 12, paddingBottom: 40 },
  h2: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  body: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  title: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
});

const s = StyleSheet.create({
  state: { alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  stateTitle: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  stateText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 460 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  chipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 9, paddingHorizontal: 14, minHeight: 44, minWidth: 44 },
  btnPrimary: { backgroundColor: colors.primaryGreen },
  btnDanger: { backgroundColor: "#B91C1C" },
  btnSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.borderBeige },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pill: { paddingHorizontal: 12, minHeight: 44, minWidth: 44, justifyContent: "center", borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  pillActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  pillText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  pillTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 460, backgroundColor: colors.lightCream, borderRadius: 14, padding: 18, gap: 10 },
  dialogTitle: { fontSize: 16, color: colors.textDark, fontFamily: "Inter_700Bold" },
  dialogText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
  dialogRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  label: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 8 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 6 },
  pagerText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
});
