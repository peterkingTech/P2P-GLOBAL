import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking, Platform } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

export interface VerifiedLocation {
  city: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

async function getVerifiedLocation(): Promise<VerifiedLocation> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    const err: any = new Error("Location permission denied");
    err.denied = true;
    throw err;
  }

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

  const [place] = await Location.reverseGeocodeAsync({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  });
  if (!place || !place.country) throw new Error("Could not determine your location");

  return {
    city: place.city || place.subregion || "",
    country: place.country,
    countryCode: place.isoCountryCode || "",
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

type State = "idle" | "requesting" | "success" | "error" | "denied";

interface Props {
  onVerified: (location: VerifiedLocation) => void | Promise<void>;
  onSkip?: () => void;
  compact?: boolean;
}

export function LocationVerifier({ onVerified, onSkip, compact }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<VerifiedLocation | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleDetect() {
    setState("requesting");
    try {
      const location = await getVerifiedLocation();
      setResult(location);
      setState("success");
    } catch (e: any) {
      if (e.denied) setState("denied");
      else { setErrorMsg(e.message ?? "Could not get your location"); setState("error"); }
    }
  }

  async function handleConfirm() {
    if (!result) return;
    await onVerified(result);
  }

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {state === "idle" && (
        <View style={styles.center}>
          <Text style={styles.icon}>🌍</Text>
          <Text style={styles.title}>Set Your Location</Text>
          <Text style={styles.subtitle}>
            Your location helps us match you with nearby peer guides and show your country on your profile.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleDetect}>
            <Text style={styles.primaryBtnText}>Detect My Location</Text>
          </TouchableOpacity>
          {onSkip && (
            <TouchableOpacity style={styles.skipBtn} onPress={onSkip}>
              <Text style={styles.skipBtnText}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {state === "requesting" && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accentGreen} size="large" />
          <Text style={styles.subtitle}>📡 Getting your location…</Text>
        </View>
      )}

      {state === "success" && result && (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle" size={36} color={colors.accentGreen} />
          <Text style={styles.title}>Location verified</Text>
          <Text style={styles.resultText}>
            {result.city ? `${result.city} · ` : ""}{result.country}
          </Text>
          <Text style={styles.subtitle}>This is your verified location</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleDetect}>
              <Text style={styles.secondaryBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm}>
              <Text style={styles.primaryBtnText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {state === "error" && (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color="#B45309" />
          <Text style={styles.title}>Could not get location</Text>
          <Text style={styles.subtitle}>{errorMsg}. Please enable location access in your device settings to verify your location.</Text>
          <View style={styles.btnRow}>
            {onSkip && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={onSkip}>
                <Text style={styles.secondaryBtnText}>Skip for now</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleDetect}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {state === "denied" && (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.textMuted} />
          <Text style={styles.title}>Location access was denied</Text>
          <Text style={styles.subtitle}>
            Without location, we'll show your profile without a country. You can enable it later in settings.
          </Text>
          <View style={styles.btnRow}>
            {onSkip && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={onSkip}>
                <Text style={styles.secondaryBtnText}>Continue without location</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => (Platform.OS === "web" ? handleDetect() : Linking.openSettings())}
            >
              <Text style={styles.primaryBtnText}>{Platform.OS === "web" ? "Try Again" : "Open Settings"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export default LocationVerifier;

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 20 },
    cardCompact: { padding: 14, borderRadius: 12 },
    center: { alignItems: "center", gap: 10 },
    icon: { fontSize: 32 },
    title: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    subtitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    resultText: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    primaryBtn: { backgroundColor: c.accentGreen, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 4 },
    primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtn: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginTop: 4 },
    secondaryBtnText: { color: c.textMid, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    skipBtn: { paddingVertical: 6, marginTop: 2 },
    skipBtnText: { color: c.textMuted, fontSize: 13, fontFamily: "Inter_500Medium" },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  });
}