import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";

// Guiding questions for a peer reviewing someone's Comprehensive Check:
// encouraging, specific feedback — not grading or shaming. Tapping one adds it
// to the feedback as a starter line for the reviewer to finish. The feedback
// is always the reviewer's own words; nothing is written for them.
export const REVIEW_PROMPTS = [
  "What did they explain clearly?",
  "An insight I found helpful:",
  "A question to help you think deeper:",
  "A Scripture or historical detail that might help:",
] as const;

/** The feedback with a starter line added (once), on its own line. */
export function addPrompt(feedback: string, prompt: string): string {
  if (feedback.includes(prompt)) return feedback;
  const base = feedback.replace(/\s+$/, "");
  return `${base ? `${base}\n` : ""}${prompt} `;
}

export default function ReviewPrompts({ feedback, onChange }: { feedback: string; onChange: (next: string) => void }) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>Feedback from you, a fellow peer — be specific and encouraging.</Text>
      <View style={s.row}>
        {REVIEW_PROMPTS.map((p) => (
          <AppButton label={`${p}`} onPress={() => onChange(addPrompt(feedback, p))} variant="secondary" size="sm" accessibilityLabel={`Add prompt: ${p}`} key={p} palette="fixedLight" />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginTop: 10 },
  title: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center", backgroundColor: colors.card },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
});
