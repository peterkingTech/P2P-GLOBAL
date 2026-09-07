// Bare barrel — resolved by `tsc` for type-checking only (this project's
// tsconfig doesn't do Metro-style platform-suffix resolution on its own,
// same reason hooks/useAgoraEngine.ts exists as a barrel over
// useAgoraEngine.native.ts/.web.ts). Metro itself resolves the platform
// variant automatically at bundle time for any import of this bare path —
// this file's own content is never what actually ships; it only needs to
// have no native-only import so `tsc` can safely open it.
export { default } from "./YouTubePlayer.web";
export type { YouTubePlayerProps } from "./youTubePlayerTypes";