import React, { useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Banner, Chip, Pager, Pill, StateView, nativeTone, studioStyles as ss } from "@/components/studio/StudioUI";
import { getMedia } from "@/lib/studioApi";
import { NATIVE_STATUS_LABELS, deviceTimeZone, formatInZone } from "@/lib/studioModel";

// Media Library: every image and video attached to a Kingdom Story, with
// the story it belongs to. Files live in a private storage bucket; uploading,
// replacing, captioning and removing happen in the story editor (which
// enforces the live-story lock), so this screen lists and links only.

const PAGE_SIZE = 25;

export default function StudioMedia() {
  const router = useRouter();
  const tz = deviceTimeZone();
  const [type, setType] = useState<"" | "image" | "video">("");
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useStudioQuery(() => getMedia({ page, pageSize: PAGE_SIZE, mediaType: type || undefined }), [page, type]);

  return (
    <View style={ss.screen}>
      <View style={styles.filters}>
        <View style={ss.row} accessibilityRole="radiogroup" accessibilityLabel="Media type">
          {([["", "All"], ["image", "Images"], ["video", "Videos"]] as const).map(([v, l]) => <Pill key={v} label={l} selected={type === v} onPress={() => { setType(v); setPage(0); }} />)}
        </View>
        <Banner tone="info" text="Kingdom Story media. To add, replace, caption or remove a file, open its story in the editor. Media of a live story is locked until the story is unpublished." />
      </View>
      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : data ? (
        <FlatList
          data={data.items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={ss.content}
          onRefresh={reload}
          refreshing={loading}
          ListEmptyComponent={<StateView empty emptyText={type ? "No media of this type." : "No Kingdom Story media yet."} />}
          ListFooterComponent={data.total > PAGE_SIZE ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
          renderItem={({ item: m }) => (
            <View style={styles.row}>
              <Ionicons name={m.mediaType === "video" ? "videocam-outline" : "image-outline"} size={22} color={colors.textMid} accessibilityLabel={m.mediaType === "video" ? "Video" : "Image"} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={ss.title} numberOfLines={1}>{m.caption || m.fileName}</Text>
                <View style={ss.row}>
                  {m.isCover ? <Chip label="Cover" tone="green" /> : null}
                  {m.storyStatus ? <Chip label={`Story: ${NATIVE_STATUS_LABELS[m.storyStatus] ?? m.storyStatus}`} tone={nativeTone(m.storyStatus)} /> : null}
                  {m.durationSeconds ? <Chip label={`${Math.round(m.durationSeconds)} s`} /> : null}
                </View>
                <Text style={ss.meta}>{m.storyTitle ?? "(story removed)"} · added {formatInZone(m.createdAt, tz)}</Text>
              </View>
              <TouchableOpacity style={styles.open} onPress={() => router.push(`/admin/kingdom-stories/${m.sourceId}` as any)} accessibilityRole="button" accessibilityLabel={`Open story ${m.storyTitle ?? ""}`}>
                <Text style={styles.openText}>Open story</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, flexWrap: "wrap" },
  open: { paddingHorizontal: 12, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff", justifyContent: "center" },
  openText: { fontSize: 13, color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
});
