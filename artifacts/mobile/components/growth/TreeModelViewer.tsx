// Bare barrel for `tsc` only (same pattern as components/family/YouTubePlayer.tsx): Metro resolves
// TreeModelViewer.native.tsx / TreeModelViewer.web.tsx at bundle time.
export { default } from "./TreeModelViewer.web";
export type { TreeModelViewerHandle, TreeModelViewerProps, TreeViewerStatus, TreeViewerState } from "./treeModelViewerTypes";
