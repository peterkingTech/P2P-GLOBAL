import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Image, Dimensions } from "react-native";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// A small shared photo viewer for any private bucket that uses the
// signed-URL pattern (mission-media, kingdom-wins-media, ...) — avoids
// writing the same fetch-signed-url-then-render-Image logic per screen.
interface Props { bucket: string; path: string }

const SCREEN_WIDTH = Dimensions.get("window").width;
const HEIGHT = Math.round((SCREEN_WIDTH - 40) * (3 / 4));

export default function SignedPhotoView({ bucket, path }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.signedUrl) setFailed(true); else setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [bucket, path]);

  if (failed) return null;
  if (!url) return <View style={[styles.box, { height: HEIGHT }]}><ActivityIndicator color={colors.accentGreen} /></View>;
  return <Image source={{ uri: url }} style={[styles.image, { height: HEIGHT }]} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", borderRadius: 12, backgroundColor: colors.cardBeige },
});
