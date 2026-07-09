import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot, useRouter, useSegments } from "expo-router";
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

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Screens inside (auth) that authenticated users are allowed to stay on
// (post-signup setup flows)
const AUTH_SETUP_SCREENS = new Set(["profile-setup", "intake"]);

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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

  return <Slot />;
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
            dismissCelebrationEvent();
            router.push("/living-tree");
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
