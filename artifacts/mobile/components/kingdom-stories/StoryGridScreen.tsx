import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, useWindowDimensions } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors as T, type as TT, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import type { StoryCard } from "@/lib/kingdomStoriesApi";
import { StoryPosterCard } from "@/components/kingdom-stories/DiscoverRow";

// One dark grid page for Kingdom Stories lists (library shelves, browse all,
// a collection): header, optional controls, loading / error / empty states.
export default function StoryGridScreen({ title, subtitle, controls, stories, loading, error, onRetry, emptyText, onEndReached, footerLoading }: {
  title: string; subtitle?: string | null; controls?: React.ReactNode; stories: StoryCard[]; loading: boolean; error?: string | null;
  onRetry?: () => void; emptyText: string; onEndReached?: () => void; footerLoading?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cols = width >= 1100 ? 6 : width >= 800 ? 5 : width >= 560 ? 4 : 3;
  const cardW = Math.floor((Math.min(width, 1200) - 32 - (cols - 1) * 10) / cols);
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/kingdom-stories" as any))} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={T.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={styles.sub} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </View>
      {controls}
      {loading && !stories.length ? <ActivityIndicator color={T.growth} style={{ marginTop: 40 }} />
        : error && !stories.length ? (
          <View style={styles.empty}>
            <Ionicons name="cloud-offline-outline" size={28} color={T.textTertiary} />
            <Text style={styles.emptyText}>{error}</Text>
            {onRetry ? <TouchableOpacity onPress={onRetry} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></TouchableOpacity> : null}
          </View>
        ) : (
          <FlatList
            key={cols}
            data={stories}
            numColumns={cols}
            keyExtractor={(s) => s.id}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 14, maxWidth: 1200, width: "100%", alignSelf: "center" }}
            renderItem={({ item }) => <StoryPosterCard story={item} width={cardW} onPress={() => router.push(`/kingdom-stories/${item.id}` as any)} />}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.4}
            ListFooterComponent={footerLoading ? <ActivityIndicator color={T.growth} style={{ marginVertical: 16 }} /> : null}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="book-outline" size={28} color={T.textTertiary} /><Text style={styles.emptyText}>{emptyText}</Text></View>}
          />
        )}
    </View>
  );
}

export function PillRow<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View style={styles.pills} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => (
        <TouchableOpacity key={o.value} onPress={() => onChange(o.value)} style={[styles.pill, value === o.value && styles.pillOn]}
          accessibilityRole="tab" accessibilityState={{ selected: value === o.value }} accessibilityLabel={o.label}>
          <Text style={[styles.pillText, value === o.value && styles.pillTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.background },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, marginBottom: 8 },
  iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  title: { color: T.textPrimary, fontSize: 20, lineHeight: 26, fontFamily: "Inter_700Bold" },
  sub: { color: T.textTertiary, ...TT.caption },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  pill: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center", backgroundColor: T.surfaceRaised, borderWidth: 1, borderColor: T.borderFaint },
  pillOn: { backgroundColor: T.growth, borderColor: T.growth },
  pillText: { color: T.textSecondary, ...TT.caption, fontFamily: "Inter_600SemiBold" },
  pillTextOn: { color: "#fff" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 50, paddingHorizontal: 40 },
  emptyText: { color: T.textTertiary, ...TT.caption, textAlign: "center" },
  retry: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center", paddingHorizontal: 16 },
  retryText: { color: T.growth, ...TT.bodyEmph },
});
