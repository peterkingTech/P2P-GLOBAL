import type { MediaProviderAdapter, SharedMediaMetadata } from "./types";

// Matches the video id out of every common YouTube URL shape, or a bare
// 11-character id typed/pasted directly. Deliberately does NOT accept
// arbitrary youtube.com URLs (e.g. a channel or playlist page) as valid —
// this is the guard the old SyncedMediaPlayer never had, which is what let
// a non-playable link reach expo-av and throw an unhandled NotSupportedError.
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const URL_PATTERNS = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
];

function extractId(input: string): string | null {
  const trimmed = input.trim();
  if (ID_PATTERN.test(trimmed)) return trimmed;
  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function matches(input: string): boolean {
  const trimmed = input.trim();
  return ID_PATTERN.test(trimmed) || /youtube\.com|youtu\.be/i.test(trimmed);
}

// YouTube's public oEmbed endpoint — no API key, no OAuth, exactly the
// "minimum provider metadata necessary" this feature calls for. Must never
// throw: a metadata miss should degrade to "no title available", not break
// Shared Media.
async function getMetadata(externalId: string): Promise<SharedMediaMetadata | null> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${externalId}`;
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`);
    if (!res.ok) return null;
    const body = await res.json();
    return {
      title: body.title ?? "Untitled video",
      thumbnailUrl: body.thumbnail_url ?? null,
      authorName: body.author_name ?? null,
    };
  } catch {
    return null;
  }
}

export const youtubeProvider: MediaProviderAdapter = {
  id: "youtube",
  capabilities: { canPlay: true, canPause: true, canSeek: true, canReportPosition: true, canQueue: true },
  matches,
  extractId,
  getMetadata,
};