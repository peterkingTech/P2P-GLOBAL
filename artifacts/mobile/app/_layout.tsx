import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Alert, I18nManager, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GrowthToast } from "@/components/GrowthToast";
import { ModuleCelebrationModal } from "@/components/ModuleCelebrationModal";
import { FruitCelebrationModal } from "@/components/FruitCelebrationModal";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider, useData } from "@/contexts/DataContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { getStageFromPoints } from "@/constants/stages";
import i18n, { SUPPORTED_LANGUAGES } from "@/lib/i18n";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Screens inside (auth) that authenticated users are allowed to stay on
// (post-signup setup flows)
const AUTH_SETUP_SCREENS = new Set(["profile-setup", "intake"]);

function AuthGate() {
  const { isAuthenticated, isLoading, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

  useEffect(() => {
    const lang = profile?.appLanguage;
    if (!lang) return;

    if (SUPPORTED_LANGUAGES.includes(lang as any) && i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }

    // RTL layout — requires an app reload to take effect in React Native.
    // I18nManager.isRTL reflects the PREVIOUS session's setting until reload.
    // On web, I18nManager has no effect on layout direction (CSS handles it),
    // so skip this block entirely to prevent an infinite reload loop.
    if (Platform.OS !== "web") {
      const shouldBeRTL = RTL_LANGUAGES.has(lang);
      if (shouldBeRTL !== I18nManager.isRTL) {
        I18nManager.allowRTL(shouldBeRTL);
        I18nManager.forceRTL(shouldBeRTL);
        Alert.alert(
          shouldBeRTL ? "Right-to-Left Layout" : "Left-to-Right Layout",
          "The app layout direction has changed. Please restart the app to apply the new direction.",
          [{ text: "OK" }]
        );
      }
    }
  }, [profile?.appLanguage]);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "(auth)";
    const screenName = segments[1] as string | undefined;
    const inSetupFlow = inAuth && !!screenName && AUTH_SETUP_SCREENS.has(screenName);
    // All /admin/* routes are guarded by the admin layout which handles
    // its own redirect to /admin/login — the root AuthGate must not
    // intercept them and send the user to onboarding instead.
    const isAdminRoute = segments[0] === "admin";

    if (!isAuthenticated && !inAuth && !isAdminRoute) {
      router.replace("/(auth)/onboarding");
    } else if (isAuthenticated && inAuth && !inSetupFlow) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, isLoading, segments]);

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: "#1D9E75",
        headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
    </Stack>
  );
}

function GrowthCelebrationHost() {
  const { toastEvent, celebrationEvent, dismissToastEvent, dismissCelebrationEvent, fruitCelebrationQueue, dismissCurrentFruitCelebration } = useData();
  const router = useRouter();

  // Fruit celebrations take priority over the growth toast/module modal —
  // they're queued one at a time (see DataContext), so only ever one shows.
  const currentFruitCelebration = fruitCelebrationQueue[0] ?? null;

  return (
    <>
      {toastEvent && (
        <GrowthToast label={toastEvent.label} onDismiss={dismissToastEvent} />
      )}
      {celebrationEvent && (
        <ModuleCelebrationModal
          label={celebrationEvent.label.replace(/ completed$/i, "")}
          onWatchGrowth={() => {
            const prevStage = getStageFromPoints(celebrationEvent.scoreBefore);
            dismissCelebrationEvent();
            router.push({
              pathname: "/living-tree",
              params: { prevStage: String(prevStage) },
            });
          }}
          onDismiss={dismissCelebrationEvent}
        />
      )}
      {currentFruitCelebration && (
        <FruitCelebrationModal
          celebration={currentFruitCelebration}
          onViewFruits={() => {
            dismissCurrentFruitCelebration();
            router.push("/fruit");
          }}
          onContinue={dismissCurrentFruitCelebration}
        />
      )}
    </>
  );
}

function RootLayoutNav() {
  return (
    <AuthProvider>
      <DataProvider>
        <AuthGate />
        <GrowthCelebrationHost />
      </DataProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Restore saved app language from AsyncStorage on every launch
  useEffect(() => {
    AsyncStorage.getItem("@p2p/appLanguage").then((saved) => {
      if (saved && SUPPORTED_LANGUAGES.includes(saved as any) && i18n.language !== saved) {
        i18n.changeLanguage(saved);
      }
    }).catch(() => {});
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#06110D" }}>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
