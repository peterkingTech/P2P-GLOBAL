import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { currentNativeBuild } from "@/components/AppVersionGate";
import { shouldReportBuild } from "@/lib/appVersionPolicy";
import { isMissingFunction } from "@/lib/profileColumns";

// Reports this build's native build number for the signed-in user, once per
// session (migration 187: p2p_report_client_build — identity is the session,
// no user id is sent). This is the adoption evidence that decides when older
// builds can be retired (migration 185) or blocked (migration 186). Silent on
// failure; a server without 187 is ignored for the rest of the session.
export function ClientBuildReporter() {
  const { profile } = useAuth();
  const done = useRef<string | null>(null);

  useEffect(() => {
    const userId = profile?.id;
    if (!userId) return;
    const build = currentNativeBuild();
    const platform = Platform.OS;
    if (!shouldReportBuild({ isDev: __DEV__, platform, build })) return;
    const key = `${userId}:${platform}:${build}`;
    if (done.current === key) return;
    done.current = key;
    void supabase
      .rpc("p2p_report_client_build", { p_platform: platform, p_build: build })
      .then(({ error }) => {
        // Missing function (server without 187): don't retry this session.
        // Anything else (offline, profile not created yet): retry on the next profile load.
        if (error && !isMissingFunction(error)) done.current = null;
      }, () => { done.current = null; });
  }, [profile?.id]);

  return null;
}
