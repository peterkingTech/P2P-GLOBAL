import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { getStageFromPoints } from "@/constants/stages";
import { getGrowthJourney, type GrowthJourney } from "@/lib/growthApi";

// The person's growth MILESTONE (server-calculated, 0 = Seed … 4 = Forest Builder) — the one stage
// every tree picture and 3D model follows, so the picture and its label always agree. Shared across
// screens: one request per minute at most. Offline, the last stage seen on this device is used,
// then (first run) the profile's legacy level.

const FRESH_MS = 60_000;
let cache: { userId: string; at: number; journey: GrowthJourney } | null = null;
let inflight: Promise<GrowthJourney> | null = null;
const storeKey = (userId: string) => `growth_stage_${userId}`;

export interface GrowthStageState {
  /** 0-based personal stage index (never Forest of Nations). */
  stageIndex: number;
  journey: GrowthJourney | null;
  /** True until the server's answer (or a stored one) is known. */
  loading: boolean;
}

export function useGrowthStage(): GrowthStageState {
  const { profile } = useAuth();
  const userId = profile?.id ?? "";
  const fallback = getStageFromPoints(profile?.growthLevel ?? 0);
  const [journey, setJourney] = useState<GrowthJourney | null>(cache?.userId === userId ? cache.journey : null);
  const [stored, setStored] = useState<number | null>(null);
  const [loading, setLoading] = useState(!journey);

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(storeKey(userId)).then((v) => { if (v != null && Number.isFinite(Number(v))) setStored(Number(v)); }).catch(() => {});
  }, [userId]);

  const refresh = useCallback(() => {
    if (!userId) return;
    if (cache?.userId === userId && Date.now() - cache.at < FRESH_MS) { setJourney(cache.journey); setLoading(false); return; }
    inflight ??= getGrowthJourney().finally(() => { inflight = null; });
    inflight.then((j) => {
      cache = { userId, at: Date.now(), journey: j };
      setJourney(j);
      AsyncStorage.setItem(storeKey(userId), String(j.stage.stage - 1)).catch(() => {});
    }).catch(() => {}).finally(() => setLoading(false));
  }, [userId]);

  useFocusEffect(refresh);

  const stageIndex = journey ? Math.min(4, Math.max(0, journey.stage.stage - 1)) : stored ?? fallback;
  return { stageIndex, journey, loading: loading && stored == null };
}

/** "3 of 7 requirements met" for the next milestone (counts, never an average), or null at the top. */
export function nextRequirementsMet(journey: GrowthJourney | null): { met: number; total: number } | null {
  if (!journey?.next) return null;
  const items = journey.next.dimensions.filter((d) => d.required).flatMap((d) => d.items);
  return { met: items.filter((i) => i.met).length, total: items.length };
}
