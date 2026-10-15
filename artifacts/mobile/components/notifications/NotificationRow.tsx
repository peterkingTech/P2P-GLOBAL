import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { Avatar } from "@/components/Avatar";
import { notificationAccessibilityLabel, notificationIdentity, notificationText, relativeTime, type NotificationLike } from "@/lib/notificationModel";

// Official app icon (assets/images/icon.png) as the P2P brand mark.
const P2P_MARK = require("../../assets/images/icon.png");

interface Props {
  n: NotificationLike;
  category?: { emoji: string; label: string } | null;
  busy?: boolean;
  onPress: () => void;
  now?: number;
}

// One Notification Center row: who (left), what (middle), P2P mark + time +
// unread dot (right). System events show the P2P mark on the left instead of
// a person, and don't repeat it on the right.
export function NotificationRow({ n, category, busy, onPress, now = Date.now() }: Props) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const who = notificationIdentity(n);
  const { headline, detail } = notificationText(n);
  return (
    <TouchableOpacity
      style={styles.main} onPress={onPress} disabled={busy} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={notificationAccessibilityLabel(n, now)} accessibilityState={{ busy: !!busy }}
    >
      {who.kind === "person" ? (
        <Avatar photoUrl={who.photoUrl} name={who.name} size={44} />
      ) : (
        <View style={styles.systemMark}><Image source={P2P_MARK} style={styles.systemMarkImage} accessibilityIgnoresInvertColors /></View>
      )}
      <View style={styles.middle}>
        {category ? <Text style={styles.category} numberOfLines={1}>{category.emoji} {category.label}</Text> : null}
        <Text style={[styles.headline, !n.isRead && styles.headlineUnread]} numberOfLines={1}>{headline}</Text>
        {detail ? <Text style={styles.detail} numberOfLines={2}>{detail}</Text> : null}
      </View>
      <View style={styles.right}>
        {who.kind === "person" ? <Image source={P2P_MARK} style={styles.brand} accessibilityIgnoresInvertColors /> : null}
        <Text style={styles.time}>{relativeTime(n.createdAt, now)}</Text>
        {busy ? <ActivityIndicator size="small" color={c.accentGreen} /> : !n.isRead ? <View style={styles.unreadDot} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    main: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 },
    systemMark: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    systemMarkImage: { width: 36, height: 36, borderRadius: 8 },
    middle: { flex: 1, minWidth: 0 },
    category: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", marginBottom: 2 },
    headline: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    headlineUnread: { fontWeight: "700", fontFamily: "Inter_700Bold" },
    detail: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 1 },
    right: { alignItems: "flex-end", justifyContent: "space-between", gap: 6, minWidth: 34 },
    brand: { width: 18, height: 18, borderRadius: 4, opacity: 0.9 },
    time: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.accentGreen },
  });
}

export default NotificationRow;
