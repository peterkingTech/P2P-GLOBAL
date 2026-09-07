// The provider boundary Shared Media sits behind. YouTube is the only
// adapter implemented in Phase 1 — this file exists so a future provider
// (Spotify, Apple Music, ...) plugs in without the room/player code caring
// which one it's talking to, and so the UI can gracefully degrade instead
// of faking controls a provider doesn't actually support.

export type MediaProviderId = "youtube";

export interface MediaProviderCapabilities {
  canPlay: boolean;
  canPause: boolean;
  canSeek: boolean;
  canReportPosition: boolean;
  canQueue: boolean;
}

export interface SharedMediaRef {
  provider: MediaProviderId;
  externalId: string;
}

export interface SharedMediaMetadata {
  title: string;
  thumbnailUrl: string | null;
  authorName: string | null;
  // Not every provider adapter can supply this without a keyed/paid API —
  // YouTube's credential-free oEmbed endpoint doesn't return it, so the
  // youtube adapter always reports null here rather than pulling in the
  // YouTube Data API just for a duration label.
  durationSeconds: number | null;
}

export interface MediaProviderAdapter {
  id: MediaProviderId;
  capabilities: MediaProviderCapabilities;
  /** True if the given input (a pasted URL, typically) belongs to this provider. */
  matches(input: string): boolean;
  /** Extracts this provider's external id from a URL or bare id. Null if unrecognized/invalid. */
  extractId(input: string): string | null;
  /** Best-effort metadata lookup — must not throw; return null on any failure. */
  getMetadata(externalId: string): Promise<SharedMediaMetadata | null>;
}