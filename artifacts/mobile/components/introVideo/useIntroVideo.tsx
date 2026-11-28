import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import IntroVideoPlayer from "@/components/introVideo/IntroVideoPlayer";
import {
  fetchIntroManifest, loadIntroViews, logIntroEvent, ONBOARDING_VIDEOS, shouldAutoShow,
  type IntroVideoId, type IntroVideoInfo, type IntroView,
} from "@/lib/introVideos";

// The one gate every placement uses (brief §3–§4): on a screen's first visit it decides — from this account's
// viewing status — whether the introduction opens by itself, and renders the player.
//   const intro = useIntroVideo("07", "learning");
//   return <>{screen}{intro.element}</>;
// `active` is true while the introduction is open; `settled` once the decision is made (and the video closed).
// Never blocks a screen when the catalogue or status cannot be loaded: the screen simply shows as before.
export function useIntroVideo(id: IntroVideoId, context: string, opts: { enabled?: boolean; onDone?: (completed: boolean) => void } = {}) {
  const { profile } = useAuth();
  const { i18n } = useTranslation();
  const enabled = opts.enabled !== false;
  const [video, setVideo] = useState<IntroVideoInfo | null>(null);
  const [view, setView] = useState<IntroView | undefined>(undefined);
  const [mode, setMode] = useState<"required" | "optional">("required");
  const [active, setActive] = useState(false);
  const [settled, setSettled] = useState(false);
  const decided = useRef(false);
  const onDone = useRef(opts.onDone); onDone.current = opts.onDone;

  useEffect(() => {
    if (!enabled || decided.current) return;
    if (!profile?.id) return;   // signed-in placements only (the first launch uses FirstLaunchFilm)
    decided.current = true;
    let off = false;
    (async () => {
      try {
        const [{ views, reliable }, manifest] = await Promise.all([loadIntroViews(profile.id), fetchIntroManifest(i18n.language || "en")]);
        const v = manifest.videos.find((x) => x.id === id) ?? null;
        const d = shouldAutoShow(id, views, { reliable, accountCreatedAt: profile.createdAt });
        if (off) return;
        // 2026-11-28: never open by itself while the film is not online (media null) — it could only say "not available"
        if (!v || !v.media || !d.show) { setSettled(true); onDone.current?.(false); return; }
        setVideo(v); setView(views[id]); setMode(d.mustComplete ? "required" : "optional"); setActive(true);
        logIntroEvent(id, "intro_shown", { context, language: i18n.language });
      } catch {
        if (!off) { setSettled(true); onDone.current?.(false); }
      }
    })();
    return () => { off = true; };
  }, [enabled, profile?.id, profile?.createdAt, id, context, i18n.language]);

  const finish = useCallback((r: { completed: boolean }) => {
    setActive(false); setSettled(true); onDone.current?.(r.completed);
  }, []);

  const element = active && video ? (
    <IntroVideoPlayer visible video={video} mode={mode} context={context} userId={profile?.id} view={view}
      offerAutoOff={!ONBOARDING_VIDEOS.includes(id)} onFinished={finish} />
  ) : null;
  return { element, active, settled };
}

/** Drop-in for a screen: renders nothing except the introduction when it opens by itself. */
export function IntroVideoGate({ id, context, enabled, onDone }: { id: IntroVideoId; context: string; enabled?: boolean; onDone?: (completed: boolean) => void }) {
  return useIntroVideo(id, context, { enabled, onDone }).element;
}
