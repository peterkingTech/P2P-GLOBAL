import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

// /about-p2p — kept for old links, Settings in older builds, the admin preview (?preview=1) and links that open one
// film (?play=<id>). About P2P is a full screen inside the More tab, beside Prayer and Discover (owner 2026-11-26:
// "I still want this screen as a full screen"), so every way in goes there, with its parameters.
export default function AboutP2PRedirect() {
  const params = useLocalSearchParams<{ play?: string; preview?: string }>();
  const extra = `${params.play ? `&play=${encodeURIComponent(String(params.play))}` : ""}${params.preview === "1" ? "&preview=1" : ""}`;
  return <Redirect href={`/(tabs)/more?section=about${extra}` as any} />;
}
