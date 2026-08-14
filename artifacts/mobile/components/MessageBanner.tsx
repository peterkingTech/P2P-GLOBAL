import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";
import { OfficialBadge } from "@/components/OfficialBadge";
import type { OfficialAccountType } from "@/contexts/AuthContext";

interface MessageBannerProps {
  senderName: string;
  senderPhotoUrl: string | null;
  senderIsOfficial: boolean;
  senderOfficialType: OfficialAccountType | null;
  messageBody: string;
  onPress: () => void;
  onDismiss: () => void;
}

export function MessageBanner({
  senderName, senderPhotoUrl, senderIsOfficial, senderOfficialType, messageBody, onPress, onDismiss,
}: MessageBannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [translateY, opacity]);

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY }], opacity }]}>
      <TouchableOpacity style={styles.pill} onPress={onPress} activeOpacity={0.85}>
        {senderPhotoUrl ? (
          <Image source={{ uri: senderPhotoUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={16} color="#fff" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.senderRow}>
            <Text style={styles.sender} numberOfLines={1}>{senderName}</Text>
            {senderIsOfficial && senderOfficialType && <OfficialBadge accountType={senderOfficialType} size="small" />}
          </View>
          <Text style={styles.message} numberOfLines={1}>{messageBody}</Text>
        </View>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 1000, alignItems: "center" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 10, width: "100%",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 12,
    shadowColor: "#000", shadowOpacity: 0.12, shadowOffset: { width: 0, height: 3 }, shadowRadius: 8, elevation: 4,
  },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarPlaceholder: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center",
  },
  senderRow: { flexDirection: "row", alignItems: "center" },
  sender: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", flexShrink: 1 },
  message: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
});