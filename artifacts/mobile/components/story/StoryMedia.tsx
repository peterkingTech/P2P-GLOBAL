import React, { useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import VideoRecorder from "@/components/VideoRecorder";
import { AppButton, IconButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";

// The photo-or-video attachment shared by the story forms (Kingdom Wins,
// Mission stories, prayer testimonies). Each feature keeps its own storage
// bucket, upload function, record type, privacy and moderation — only the
// picking / previewing / removing and the upload hand-off live here.

export type PickedPhoto = { uri: string; mimeType?: string; fileName?: string | null };
export type StoryMediaFields = { id?: string; mediaType?: "video" | "photo"; mediaPath?: string; mediaDurationSeconds?: number };

/** The attachment state for one form: at most one photo or one video. */
export function useStoryMedia() {
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  return {
    videoUri, videoDuration, photo,
    attachVideo: (uri: string, seconds: number) => { setPhoto(null); setVideoUri(uri); setVideoDuration(seconds); },
    removeVideo: () => { setVideoUri(null); setVideoDuration(0); },
    removePhoto: () => setPhoto(null),
    async pickPhoto() {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showAlert("Photo access needed", "Please allow photo library access to add a picture."); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setVideoUri(null); setVideoDuration(0);
      setPhoto({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName });
    },
  };
}
export type StoryMedia = ReturnType<typeof useStoryMedia>;

/**
 * Uploads whatever is attached with the feature's own upload functions.
 * Returns the media fields for the record ({} when nothing is attached), or
 * null after telling the person the upload failed.
 */
type UploadOpts<U> = {
  userId: string;
  uploadVideo: (uri: string, userId: string) => Promise<U | null>;
  uploadPhoto?: (photo: PickedPhoto, userId: string) => Promise<U | null>;
  /** The new record's id from an upload result (entryId / storyId / testimonyId). */
  idOf: (uploaded: U) => string;
};
/** Video-only features (no uploadPhoto) get video-only fields. */
export async function uploadStoryMedia<U extends { mediaPath: string }>(media: StoryMedia, opts: UploadOpts<U> & { uploadPhoto?: undefined }): Promise<(StoryMediaFields & { mediaType?: "video" }) | null>;
export async function uploadStoryMedia<U extends { mediaPath: string }>(media: StoryMedia, opts: UploadOpts<U>): Promise<StoryMediaFields | null>;
export async function uploadStoryMedia<U extends { mediaPath: string }>(media: StoryMedia, opts: UploadOpts<U>): Promise<StoryMediaFields | null> {
  if (media.videoUri) {
    const uploaded = await opts.uploadVideo(media.videoUri, opts.userId);
    if (!uploaded) { showAlert("Couldn't upload your video", "Please check your connection and try again."); return null; }
    return { id: opts.idOf(uploaded), mediaType: "video", mediaPath: uploaded.mediaPath, mediaDurationSeconds: media.videoDuration };
  }
  if (media.photo && opts.uploadPhoto) {
    const uploaded = await opts.uploadPhoto(media.photo, opts.userId);
    if (!uploaded) { showAlert("Couldn't upload your photo", "Please check your connection and try again."); return null; }
    return { id: opts.idOf(uploaded), mediaType: "photo", mediaPath: uploaded.mediaPath };
  }
  return {};
}

/** The attachment section: label, then the preview of what's attached or the ways to add one. */
export function StoryMediaField({ media, disabled, allowPhoto = true, photoHeight = 180 }: {
  media: StoryMedia; disabled?: boolean; allowPhoto?: boolean; photoHeight?: number;
}) {
  const { colors: c } = useTheme();
  return (
    <View>
      <Text style={[styles.label, { color: c.textDark }]}>{allowPhoto ? "Media (optional — a photo or a video, not both)" : "Video (optional)"}</Text>
      {media.photo ? (
        <View style={styles.photoBox}>
          <Image source={{ uri: media.photo.uri }} style={[styles.photo, { height: photoHeight, backgroundColor: c.borderBeige }]} resizeMode="cover"
            accessibilityLabel="Attached photo" />
          <View style={styles.removeOnPhoto}>
            <IconButton icon="close" onPress={media.removePhoto} variant="overlay" size="sm" accessibilityLabel="Remove photo" />
          </View>
        </View>
      ) : media.videoUri ? (
        <View style={[styles.videoBox, { backgroundColor: c.card, borderColor: c.borderBeige }]}>
          <Ionicons name="videocam" size={16} color={c.accentGreen} />
          <Text style={[styles.videoText, { color: c.textDark }]}>Video attached ({media.videoDuration}s)</Text>
          <IconButton icon="close-circle" onPress={media.removeVideo} size="sm" color={c.textMuted} accessibilityLabel="Remove video" />
        </View>
      ) : (
        <>
          {allowPhoto && <AppButton label="Add Photo" onPress={media.pickPhoto} variant="outline" icon="image-outline" disabled={disabled} style={{ marginBottom: 10 }} />}
          <VideoRecorder disabled={disabled} onSubmit={async (localUri, durationSeconds) => media.attachVideo(localUri, durationSeconds)} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 16, marginBottom: 6 },
  photoBox: { borderRadius: 12, overflow: "hidden", position: "relative" },
  photo: { width: "100%", borderRadius: 12 },
  removeOnPhoto: { position: "absolute", top: 4, right: 4 },
  videoBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingLeft: 12, paddingVertical: 4 },
  videoText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
});
