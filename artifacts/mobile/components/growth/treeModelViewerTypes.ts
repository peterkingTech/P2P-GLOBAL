export type TreeViewerState = "loading" | "standard" | "detail-loading" | "detailed" | "error";

export interface TreeViewerStatus {
  state: TreeViewerState;
  /** Download progress 0–100 while loading. */
  progress?: number;
  message?: string;
  /** The detailed copy failed to download; the standard copy is still shown. */
  detailFailed?: boolean;
}

export interface TreeModelViewerProps {
  standardUrl: string;
  /** Null when the model has no detailed copy. */
  detailedUrl: string | null;
  /** Known limitations, applied openly (see lib/growthModels.ts). */
  frontOnly?: boolean;
  noCloseUp?: boolean;
  background: string;
  reduceMotion: boolean;
  onStatus: (s: TreeViewerStatus) => void;
  /** Changing this number re-creates the viewer (used for "Try again"). */
  reloadKey?: number;
}

export interface TreeModelViewerHandle {
  zoom: (factor: number) => void;
  reset: () => void;
}
