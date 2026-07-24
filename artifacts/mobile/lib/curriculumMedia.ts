import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { supabase } from "@/contexts/AuthContext";

const BUCKET = "curriculum-media";

function extFromUri(uri: string, fallback: string): string {
  const match = uri.split("?")[0].split(".").pop();
  return (match && match.length <= 5 ? match : fallback).toLowerCase();
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    mp3: "audio/mpeg", m4a: "audio/x-m4a", wav: "audio/wav", aac: "audio/aac", mp4: "audio/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

async function uploadToCurriculumMedia(
  uri: string,
  moduleId: string,
  lessonId: string,
  ext: string
): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `curriculum/${moduleId}/${lessonId}/${filename}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: mimeForExt(ext) });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Opens the device image picker and uploads the chosen image. Returns the public URL, or null if cancelled. */
export async function pickAndUploadImage(moduleId: string, lessonId: string): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo library access is required to upload an image.");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
  });
  if (result.canceled || !result.assets.length) return null;

  const asset = result.assets[0];
  const ext = extFromUri(asset.uri, "jpg");
  return uploadToCurriculumMedia(asset.uri, moduleId, lessonId, ext === "jpg" ? "jpg" : ext);
}

/** Opens the device file picker for audio and uploads the chosen file. Returns the public URL, or null if cancelled. */
export async function pickAndUploadAudio(moduleId: string, lessonId: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const ext = extFromUri(asset.uri, "m4a");
  return uploadToCurriculumMedia(asset.uri, moduleId, lessonId, ext);
}
