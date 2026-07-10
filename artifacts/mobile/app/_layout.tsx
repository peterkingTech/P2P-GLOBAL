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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GrowthToast } from "@/components/GrowthToast";
import { ModuleCelebrationModal } from "@/components/ModuleCelebrationModal";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider, useData } from "@/contexts/DataContext";
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

  useEffect(() => {
    const lang = profile?.appLanguage;
    if (lang && SUPPORTED_LANGUAGES.includes(lang as any) && i18n.language !== lang) {
      i18n.changeLanguage(lang);
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
        headerBackTitleVisible: false,
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
  const { toastEvent, celebrationEvent, dismissToastEvent, dismissCelebrationEvent } = useData();
  const router = useRouter();

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

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
