// Extensionless barrel — exists only so `tsc` (which doesn't do Metro's
// platform-extension resolution) can resolve `@/hooks/useAgoraEngine`.
// Metro itself always prefers useAgoraEngine.native.ts / .web.ts over this
// file when resolving actual imports, so this is never loaded at runtime;
// re-exporting from the web stub keeps it side-effect-free (no
// react-native-agora import) if that assumption is ever wrong.
export { useAgoraEngine } from "./useAgoraEngine.web";