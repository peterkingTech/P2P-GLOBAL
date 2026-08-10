import React from "react";
import { TextInput, TextStyle, StyleProp } from "react-native";
import colors from "@/constants/colors";
import { formatDobInput } from "@/lib/dateOfBirth";

interface DateOfBirthInputProps {
  value: string;
  onChangeText: (v: string) => void;
  style?: StyleProp<TextStyle>;
}

// A single masked DD.MM.YYYY input — dots are auto-inserted as the user
// types (see formatDobInput), and the raw value passed up is always in this
// display format; callers parse it with parseDMY at submit time.
export default function DateOfBirthInput({ value, onChangeText, style }: DateOfBirthInputProps) {
  return (
    <TextInput
      style={style}
      value={value}
      onChangeText={(text) => onChangeText(formatDobInput(text))}
      placeholder="DD.MM.YYYY"
      placeholderTextColor={colors.textMuted}
      keyboardType="number-pad"
      maxLength={10}
    />
  );
}