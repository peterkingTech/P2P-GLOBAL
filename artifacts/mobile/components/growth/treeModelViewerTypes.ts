import type { TreeViewerConfig } from "@/lib/treeViewerHtml";

export type TreeViewerState = "loading" | "standard" | "detail-loading" | "detailed" | "error";

export interface TreeViewerStatus {
  state: TreeViewerState;
  /** Download progress 0–100 while loading. */
  progress?: number;
  message?: string;
  /** The detailed copy failed to download; the standard copy is still shown. */
  detailFailed?: boolean;
  /** Modular tree: number of part meshes drawn, or a part that failed to load. */
  parts?: number;
  partFailed?: string;
}

export interface TreeModelViewerProps {
  standardUrl: string;
  /** Null when the model has no detailed copy. */
  detailedUrl: string | null;
  /** Known limitations, applied openly (a flat relief turns only a little; no close-up copy limits zoom). */
  frontOnly?: boolean;
  noCloseUp?: boolean;
  background: string;
  reduceMotion: boolean;
  onStatus: (s: TreeViewerStatus) => void;
  /** Modular Growth Tree parts (lib/treeViewerHtml.ts TreeViewerConfig.parts). */
  parts?: TreeViewerConfig["parts"];
  /** A part was tapped: its attachment id (e.g. "fruit:<evidence id>"). */
  onSelect?: (id: string | null) => void;
  /** Changing this number re-creates the viewer (used for "Try again"). */
  reloadKey?: number;
  /** Living tree: wind in the canopy at start (never with reduced motion). */
  wind?: boolean;
  /** The body's trunk base / height / canopy radius (its anchors), for the wind; else measured from the model. */
  windFrame?: TreeViewerConfig["windFrame"];
  /** A card: no gestures or buttons, framed close (the app handles taps). */
  compact?: boolean;
  /** Stop drawing (screen not visible, app in the background). */
  paused?: boolean;
}

export type TreeView = "full" | "roots" | "canopy";
export interface TreeModelViewerHandle {
  zoom: (factor: number) => void;
  reset: () => void;
  /** Move the camera to the whole tree, its roots or its canopy. */
  view: (mode: TreeView) => void;
  setWind: (on: boolean) => void;
}
