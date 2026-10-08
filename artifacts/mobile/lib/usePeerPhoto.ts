import { useEffect, useState } from "react";
import { supabase } from "@/contexts/AuthContext";

/**
 * The other person's profile photo for the call screens (incoming, active
 * audio, active video). Starts from a URL the screen was handed (shown at
 * once — expo-image serves it from cache when seen before) and confirms or
 * fills it from p2p_profiles.photo_url, the same source the rest of the app
 * uses. null → the screen shows the standard P2P avatar. Never blocks the
 * call: this only ever upgrades what's on screen.
 */
export function usePeerPhoto(userId: string | undefined, initialUrl?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(initialUrl || null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase.from("p2p_profiles").select("photo_url").eq("id", userId).maybeSingle().then(({ data }) => {
      const fresh = (data as { photo_url?: string | null } | null)?.photo_url;
      if (!cancelled && fresh) setUrl(fresh);
    });
    return () => { cancelled = true; };
  }, [userId]);
  return url;
}
