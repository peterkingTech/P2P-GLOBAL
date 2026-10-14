import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { supabase } from "@/contexts/AuthContext";
import {
  DEFAULT_UPDATE_MESSAGE,
  choosePolicy,
  enforcementApplies,
  evaluateVersion,
  isMissingPolicyTable,
  pickNativeBuild,
  policyFromRow,
  updateInstructions,
  type FetchResult,
  type MobilePlatform,
  type VersionPolicy,
  type VersionStatus,
} from "@/lib/appVersionPolicy";

// Server-controlled minimum supported build (migration 186). Never blocks the
// app while checking, offline, or when anything is unknown — only a positive
// "this build is below the minimum" shows the update screen, and then none of
// the app (auth, data, realtime) is mounted.

const CACHE_KEY = "@p2p/appVersionPolicy/v1";
const RECHECK_MS = 15 * 60 * 1000;

// ExpoApplication is already compiled into iOS and Android builds (it is a
// dependency of expo-notifications — verified with expo-modules-autolinking),
// so it is read through the optional native-module loader: no new package,
// and null (→ unknown, never blocking) if it is ever absent.
const ExpoApplication = requireOptionalNativeModule<{ nativeBuildVersion?: string | null }>("ExpoApplication");

/** The real native build number (iOS CFBundleVersion / Android versionCode). */
export function currentNativeBuild(): number | null {
  return pickNativeBuild({
    platform: Platform.OS,
    applicationBuild: ExpoApplication?.nativeBuildVersion,
    iosConstantsBuild: (Constants.platform as { ios?: { buildNumber?: unknown } } | undefined)?.ios?.buildNumber,
  });
}

async function readCache(platform: MobilePlatform): Promise<VersionPolicy | null> {
  try { return policyFromRow(JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? "null"), platform); } catch { return null; }
}
async function writeCache(policy: VersionPolicy | null) {
  try {
    if (policy) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(policy));
    else await AsyncStorage.removeItem(CACHE_KEY);
  } catch { /* cache is best-effort */ }
}

async function fetchPolicy(platform: MobilePlatform): Promise<FetchResult> {
  try {
    const { data, error } = await supabase
      .from("p2p_app_version_policy")
      .select("platform, min_supported_build, update_url, message")
      .eq("platform", platform)
      .maybeSingle();
    if (error) return isMissingPolicyTable(error) ? { ok: true, policy: null } : { ok: false };
    return { ok: true, policy: policyFromRow(data, platform) };
  } catch {
    return { ok: false };
  }
}

export function AppVersionGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<VersionStatus>("unknown");
  const [policy, setPolicy] = useState<VersionPolicy | null>(null);
  const lastCheck = useRef(0);
  const platform = Platform.OS as MobilePlatform;
  const applies = enforcementApplies({ isDev: __DEV__, platform: Platform.OS });

  const check = useCallback(async () => {
    if (!applies) return;
    lastCheck.current = Date.now();
    const build = currentNativeBuild();
    const cached = await readCache(platform);
    const fresh = await fetchPolicy(platform);
    if (fresh.ok) await writeCache(fresh.policy);
    const chosen = choosePolicy(fresh, cached);
    setPolicy(chosen);
    setStatus(evaluateVersion(build, chosen));
  }, [applies, platform]);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && Date.now() - lastCheck.current > RECHECK_MS) void check();
    });
    return () => sub.remove();
  }, [check]);

  if (status !== "outdated") return <>{children}</>;
  return <UpdateRequiredScreen policy={policy} platform={platform} onRetry={() => { void check(); }} />;
}

export function UpdateRequiredScreen({ policy, platform, onRetry }: { policy: VersionPolicy | null; platform: MobilePlatform; onRetry: () => void }) {
  const url = policy?.updateUrl ?? null;
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text style={styles.title} accessibilityRole="header">Update required</Text>
      <Text style={styles.body}>{policy?.message ?? DEFAULT_UPDATE_MESSAGE}</Text>
      {url ? (
        <TouchableOpacity
          style={styles.primary}
          onPress={() => { void Linking.openURL(url).catch(() => {}); }}
          accessibilityRole="button"
          accessibilityLabel="Update P2P Global"
        >
          <Text style={styles.primaryText}>Update</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.hint}>{updateInstructions(platform)}</Text>
      )}
      <TouchableOpacity style={styles.secondary} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Check again">
        <Text style={styles.secondaryText}>Check again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#06110D", alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  title: { color: "#FFFFFF", fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  body: { color: "#D7E2DC", fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, maxWidth: 480 },
  hint: { color: "#A9BBB2", fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 480 },
  primary: { backgroundColor: "#2E8B57", paddingVertical: 14, paddingHorizontal: 36, borderRadius: 12, minWidth: 200, alignItems: "center" },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondary: { paddingVertical: 12, paddingHorizontal: 24 },
  secondaryText: { color: "#A9BBB2", fontSize: 15, fontFamily: "Inter_500Medium" },
});
