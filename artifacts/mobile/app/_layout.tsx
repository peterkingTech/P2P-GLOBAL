import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments, usePathname, useGlobalSearchParams } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Alert, AppState, I18nManager, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Real-device forensic fix for the Android 7.1/API 25 (Nox) launch crash
// — see index.js for the actual fix and why it has to live there, not
// here. Calling enableScreens(false) at the top of this file was tried
// first (simpler, more localized) and confirmed via real-device retest
// to NOT resolve the crash: expo-router/entry already finishes
// initializing react-native-screens' native navigator before this
// module is ever evaluated, so the call landed too late to matter.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { registerForPushNotificationsAsync, pathForNotification, registerVoipTokenAsync } from "@/lib/push";
import {
  callSystemActive, callSystemInstalled, configureCallSystem, flushPendingCallSystemEvents,
  getVoipToken, reportSystemIncomingCall, subscribeCallSystemEvents,
} from "@/lib/callSystem";
import { getApiUrl } from "@/lib/apiUrl";
import Constants from "expo-constants";
import { ACCEPT_ACTION, DECLINE_ACTION, dismissCallNotifications, sweepStaleCallNotifications } from "@/lib/callNotifications";
import { supabase } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GrowthToast } from "@/components/GrowthToast";
import { CircleSessionBanner } from "@/components/CircleSessionBanner";
import { FamilyWorshipBanner } from "@/components/FamilyWorshipBanner";
import { MessageBanner } from "@/components/MessageBanner";
import { ModuleCelebrationModal } from "@/components/ModuleCelebrationModal";
import { FruitCelebrationModal } from "@/components/FruitCelebrationModal";
import { CategoryCompletionModal } from "@/components/CategoryCompletionModal";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider, useData } from "@/contexts/DataContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { getStageFromPoints } from "@/constants/stages";
import i18n, { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { usePresenceHeartbeat } from "@/lib/presence";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Screens inside (auth) that authenticated users are allowed to stay on
// (post-signup setup flows). "goals-onboarding" and "journey" were missing
// here before — an authenticated user landing on either got immediately
// bounced back to /(tabs) by the effect below (isAuthenticated && inAuth &&
// !inSetupFlow), since AUTH_SETUP_SCREENS didn't know about them yet.
const AUTH_SETUP_SCREENS = new Set(["profile-setup", "intake", "goals-onboarding", "journey", "username-setup"]);

function AuthGate() {
  const { isAuthenticated, isLoading, profile, isPasswordRecovery } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  // Deep link (lesson/plan/category) opened while signed out — the effect
  // below bounces to onboarding before expo-router can land on that route,
  // so the intended path is saved here and replayed once auth completes.
  const pendingDeepLinkPath = useRef<string | null>(null);

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
    // Forgot Password — a recovery session is a real, authenticated Supabase
    // session (isAuthenticated is true), but the user must land on and stay
    // on reset-password.tsx, not get swept into /(tabs) or the onboarding/
    // journey gates below like a normal login would. isPasswordRecovery is
    // only ever true from the SDK's own PASSWORD_RECOVERY event (see
    // AuthContext), never a guess.
    if (isPasswordRecovery) return;
    const inAuth = segments[0] === "(auth)";
    const screenName = segments[1] as string | undefined;
    const inSetupFlow = inAuth && !!screenName && AUTH_SETUP_SCREENS.has(screenName);
    // All /admin/* routes are guarded by the admin layout which handles
    // its own redirect to /admin/login — the root AuthGate must not
    // intercept them and send the user to onboarding instead.
    const isAdminRoute = segments[0] === "admin";

    if (!isAuthenticated && !inAuth && !isAdminRoute) {
      // Only worth replaying a path that isn't just the default landing
      // screen a fresh, link-free launch would already end up on.
      if (pathname && pathname !== "/" && !pathname.startsWith("/(tabs)")) {
        pendingDeepLinkPath.current = pathname;
      }
      router.replace("/(auth)/onboarding");
      return;
    }
    if (!isAuthenticated || isAdminRoute) return;
    // Wait for the profile fetch to resolve before deciding where an
    // authenticated user belongs — deciding early (while profile is still
    // null) risks a flicker-route to /(tabs) immediately followed by a
    // bounce back into /journey once the real profile arrives.
    if (!profile) return;

    // Existing accounts created before the @username system (or accounts an
    // admin has force-flagged via Admin > Usernames) must pick/change a
    // username before doing anything else — checked ahead of the journey
    // gate since it blocks even users who already finished onboarding.
    const onUsernameSetupScreen = inAuth && screenName === "username-setup";
    const needsUsernameSetup = !profile.username || profile.usernameChangeRequired;

    if (needsUsernameSetup && !onUsernameSetupScreen) {
      router.replace("/(auth)/username-setup" as any);
      return;
    }

    const onJourneyScreen = inAuth && screenName === "journey";
    const journeyIncomplete = !profile.onboardingJourneyCompletedAt;

    if (journeyIncomplete && !inSetupFlow && !onJourneyScreen) {
      router.replace("/(auth)/journey" as any);
    } else if (!journeyIncomplete && inAuth && !inSetupFlow) {
      const target = pendingDeepLinkPath.current;
      pendingDeepLinkPath.current = null;
      router.replace((target ?? "/(tabs)") as any);
    }
  }, [isAuthenticated, isLoading, segments, profile, pathname, router]);

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
  const {
    toastEvent, celebrationEvent, dismissToastEvent, dismissCelebrationEvent,
    fruitCelebrationQueue, dismissCurrentFruitCelebration,
    categoryCompletionQueue, dismissCurrentCategoryCompletion,
  } = useData();
  const router = useRouter();

  // Fruit celebrations take priority over the growth toast/module modal —
  // they're queued one at a time (see DataContext), so only ever one shows.
  const currentFruitCelebration = fruitCelebrationQueue[0] ?? null;
  const currentCategoryCompletion = categoryCompletionQueue[0] ?? null;

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
      {!currentFruitCelebration && currentCategoryCompletion && (
        <CategoryCompletionModal
          completion={currentCategoryCompletion}
          onContinue={dismissCurrentCategoryCompletion}
        />
      )}
    </>
  );
}

// Incoming call detection — DataContext sets incomingCall the instant a
// p2p_incoming_calls row targeting this user arrives over realtime (see the
// subscription there). This just navigates to the ringing screen, the same
// pattern GrowthCelebrationHost uses for fruit celebrations — it works
// regardless of which screen the user is currently on, since it's mounted
// once at the root alongside the rest of the app.
// Screens that mean "already on (or being rung for) a call". A second
// ordinary call never interrupts one of these — there's no call waiting —
// it's marked "busy" instead, which the caller's screen shows as "Busy".
const BUSY_CALL_PATHS = ["/call/audio", "/call/video", "/call/group", "/call/church", "/call/room", "/call/prayer", "/call/incoming"];

function IncomingCallHost() {
  const { incomingCall, dismissIncomingCall } = useData();
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{ callId?: string }>();
  const shownForCallId = useRef<string | null>(null);

  useEffect(() => {
    if (!incomingCall || shownForCallId.current === incomingCall.callId) return;
    shownForCallId.current = incomingCall.callId;
    // Already on screen for this very call (e.g. opened from its push, then
    // realtime's catch-up read delivered it again) — nothing to do.
    if (routeParams.callId === incomingCall.callId) { dismissIncomingCall(); return; }
    const busy = incomingCall.callType !== "crisis" && BUSY_CALL_PATHS.some((p) => pathname?.startsWith(p));
    if (busy) {
      console.log("CALL INCOMING TRACE: busy, not ringing", { callId: incomingCall.callId, pathname });
      void supabase.from("p2p_incoming_calls")
        .update({ status: "busy", responded_at: new Date().toISOString() })
        .eq("id", incomingCall.callId).eq("status", "ringing")
        .then(() => dismissCallNotifications(incomingCall.callId));
      dismissIncomingCall();
      return;
    }
    // Native phone-call integration (lib/callSystem.ts). iOS always rings
    // through CallKit (its own UI, foreground included). Android rings
    // natively when the app isn't on screen; on screen, the app's ringing
    // screen below shows it and Telecom is only told about it. Crisis calls
    // (can't be declined) and group invitations keep the app's screen.
    if (callSystemActive() && incomingCall.callType !== "crisis" && !incomingCall.invitationId) {
      const info = {
        callId: incomingCall.callId, channelName: incomingCall.channelName, callType: incomingCall.callType,
        callerId: incomingCall.callerId, callerName: incomingCall.callerName,
        conversationId: incomingCall.conversationId, callLogId: incomingCall.callLogId,
        callerPhotoUrl: incomingCall.callerPhotoUrl,
      };
      const ringNatively = Platform.OS === "ios" || AppState.currentState !== "active";
      reportSystemIncomingCall(info, ringNatively);
      if (ringNatively) { dismissIncomingCall(); return; }
    }
    // CALL INCOMING TRACE (automatic-second-call investigation).
    console.log("CALL INCOMING TRACE: IncomingCallHost navigating", {
      callId: incomingCall.callId, channelName: incomingCall.channelName,
      callerId: incomingCall.callerId, timestamp: new Date().toISOString(),
    });
    const navigate = incomingCall.callType === "crisis" ? router.replace : router.push;
    // Crisis calls interrupt whatever the recipient is doing — including an
    // active call screen — by replacing the current route instead of
    // stacking on top of it; every other call type still pushes so the
    // recipient can dismiss back to where they were.
    navigate({
      pathname: "/call/incoming",
      params: {
        callId: incomingCall.callId,
        channelName: incomingCall.channelName,
        callType: incomingCall.callType,
        callerId: incomingCall.callerId,
        callerName: incomingCall.callerName,
        conversationId: incomingCall.conversationId ?? "",
        callLogId: incomingCall.callLogId ?? "",
        invitationId: incomingCall.invitationId ?? "",
        callerPhotoUrl: incomingCall.callerPhotoUrl ?? "",
      },
    } as any);
    dismissIncomingCall();
    // pathname/routeParams are read, not watched: only a newly arriving
    // call is judged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall, dismissIncomingCall, router]);

  return null;
}

// Native phone-call integration (lib/callSystem.ts): configures the native
// side, registers the iOS VoIP token, and acts on native call events —
// including ones queued before JS started (Answer tapped on the lock screen
// while the app was launching).
function CallSystemHost() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated || !callSystemInstalled()) return;
    let cancelled = false;
    const apiUrl = getApiUrl();
    const scheme = (Constants.expoConfig?.scheme as string | undefined) || "p2pglobalbiblestudy";
    configureCallSystem(apiUrl, scheme, true);
    // Server switch (NATIVE_CALLS_ANDROID / NATIVE_CALLS_IOS) — off means
    // back to the plain push + in-app ringing path, no new build needed.
    fetch(`${apiUrl}/calls/config`)
      .then((r) => r.json())
      .then((cfg) => {
        if (cancelled) return;
        const flags = cfg?.nativeCallSystem ?? {};
        configureCallSystem(apiUrl, scheme, (Platform.OS === "ios" ? flags.ios : flags.android) !== false);
      })
      .catch(() => { /* keep the default */ });

    const unsubscribe = subscribeCallSystemEvents((event) => {
      switch (event.type) {
        case "answered": {
          // CallKit Answer → the app's ringing screen settles and joins,
          // exactly like an in-app Accept.
          const c = event.call;
          router.replace({
            pathname: "/call/incoming",
            params: {
              callId: c.callId, channelName: c.channelName, callType: c.callType,
              callerId: c.callerId, callerName: c.callerName,
              conversationId: c.conversationId ?? "", callLogId: c.callLogId ?? "",
              callerPhotoUrl: c.callerPhotoUrl ?? "",
              invitationId: "", action: "accept",
            },
          } as any);
          break;
        }
        case "declined":
          // Native already told the server when it had the push's decline
          // token; a call that arrived over realtime has none, so settle it here.
          void supabase.from("p2p_incoming_calls")
            .update({ status: "declined", responded_at: new Date().toISOString() })
            .eq("id", event.callId).eq("status", "ringing");
          break;
        case "callBack":
          router.push({ pathname: "/call/callback", params: { peerId: event.peerId, peerName: event.peerName, callType: event.callType } } as any);
          break;
        case "voipToken":
          void registerVoipTokenAsync(event.token);
          break;
      }
    });
    flushPendingCallSystemEvents();
    const voipToken = getVoipToken();
    if (voipToken) void registerVoipTokenAsync(voipToken);
    return () => { cancelled = true; unsubscribe(); };
  }, [isAuthenticated, router]);

  return null;
}

// Peer Circle "Start Session" invite — unlike IncomingCallHost this doesn't
// auto-navigate (it's not a ringing call), it renders a dismissible banner
// the member can tap to join whenever they're ready.
function CircleSessionBannerHost() {
  const { circleSessionInvite, dismissCircleSessionInvite } = useData();
  const router = useRouter();

  if (!circleSessionInvite) return null;

  return (
    <CircleSessionBanner
      circleName={circleSessionInvite.circleName}
      onPress={() => {
        const invite = circleSessionInvite;
        dismissCircleSessionInvite();
        router.push({
          pathname: "/call/group",
          params: { circleId: invite.circleId, channelName: invite.channelName },
        } as any);
      }}
      onDismiss={dismissCircleSessionInvite}
    />
  );
}

// Family Worship invite — same non-navigating, dismissible-banner pattern
// as CircleSessionBannerHost above.
function FamilyWorshipBannerHost() {
  const { familyWorshipInvite, dismissFamilyWorshipInvite } = useData();
  const router = useRouter();

  if (!familyWorshipInvite) return null;

  return (
    <FamilyWorshipBanner
      hostName={familyWorshipInvite.hostName}
      onPress={() => {
        const invite = familyWorshipInvite;
        dismissFamilyWorshipInvite();
        router.push({
          pathname: "/family/worship/[sessionId]",
          params: { sessionId: invite.sessionId },
        } as any);
      }}
      onDismiss={dismissFamilyWorshipInvite}
    />
  );
}

// The Completion Moment (Prompt 6) — DataContext sets pendingCompletionMoment
// the instant a user's 12th Core Curriculum module is detected complete, but
// navigation must never interrupt a lesson mid-session. This host just waits
// until the user isn't on a lesson screen, then fires the one-time
// navigation and clears the flag so it can't re-fire.
function CompletionMomentHost() {
  const { pendingCompletionMoment, dismissPendingCompletionMoment } = useData();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!pendingCompletionMoment) return;
    if (segments[0] === "lesson") return; // still mid-lesson — wait for the session to end
    dismissPendingCompletionMoment();
    router.push("/completion" as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompletionMoment, segments]);

  return null;
}

// New message on a conversation the user isn't currently viewing — see
// handleIncomingMessageForBanner in DataContext, same host pattern as
// CircleSessionBannerHost above.
function MessageBannerHost() {
  const { incomingMessageBanner, dismissMessageBanner } = useData();
  const router = useRouter();

  if (!incomingMessageBanner) return null;

  return (
    <MessageBanner
      senderName={incomingMessageBanner.senderName}
      senderPhotoUrl={incomingMessageBanner.senderPhotoUrl}
      senderIsOfficial={incomingMessageBanner.senderIsOfficial}
      senderOfficialType={incomingMessageBanner.senderOfficialType}
      messageBody={incomingMessageBanner.messageBody}
      onPress={() => {
        const conversationId = incomingMessageBanner.conversationId;
        dismissMessageBanner();
        router.push(`/messages/${conversationId}` as any);
      }}
      onDismiss={dismissMessageBanner}
    />
  );
}

// Push notification device registration + tap handling. Registration only
// runs once a real session exists (registering to an anonymous auth.uid()
// would be meaningless); tap routing reuses pathForNotification's narrow
// map — a direct link for message-family types, the Notification Center
// for everything else, letting its existing handlePress logic (already
// built for the in-app row-tap case) do the "is this still valid" checks
// rather than duplicating them here. Cold-start taps (app was fully killed)
// arrive via getLastNotificationResponseAsync; taps while JS is already
// running (foreground or backgrounded-but-alive) arrive via the live
// listener — both funnel through the same handleResponse so a tap is never
// handled twice or missed depending on app state.
function PushNotificationHost() {
  const { isAuthenticated, profile } = useAuth();
  const router = useRouter();
  const registeredForUserId = useRef<string | null>(null);
  const handledNotificationIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) return;
    if (registeredForUserId.current === profile.id) return;
    registeredForUserId.current = profile.id;
    void registerForPushNotificationsAsync();
  }, [isAuthenticated, profile?.id]);

  useEffect(() => {
    function handleResponse(response: Notifications.NotificationResponse) {
      const id = response.notification.request.identifier;
      if (handledNotificationIds.current.has(id)) return;
      handledNotificationIds.current.add(id);
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const notificationType = (data?.notificationType as string | undefined) ?? null;
      const callAction = response.actionIdentifier === ACCEPT_ACTION ? "accept"
        : response.actionIdentifier === DECLINE_ACTION ? "decline" : undefined;
      const path = pathForNotification(notificationType, data, callAction);
      // Incoming-call taps use replace, not push: IncomingCallHost below
      // already navigates to this exact same screen the instant realtime
      // detects the call (foreground/background-but-alive case) — a push
      // tap arriving after that already happened would otherwise stack a
      // second copy of the ringing screen instead of landing on the one
      // already there. Cold start has nothing to replace, so this is a
      // normal first navigation in that case.
      if (notificationType === "incoming_call") router.replace(path as any);
      else router.push(path as any);
    }

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, [router]);

  // A push can't be withdrawn server-side, so an "Incoming call" entry can
  // outlive its call while the app was backgrounded or closed. Clear any
  // such stale entry on launch and on every return to the foreground.
  useEffect(() => {
    if (!isAuthenticated) return;
    void sweepStaleCallNotifications(supabase);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sweepStaleCallNotifications(supabase);
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  return null;
}

function PresenceHost() {
  const { isAuthenticated, profile } = useAuth();
  usePresenceHeartbeat(isAuthenticated ? profile?.id : null);
  return null;
}

function RootLayoutNav() {
  return (
    <AuthProvider>
      <DataProvider>
        <AuthGate />
        <GrowthCelebrationHost />
        <IncomingCallHost />
        <CallSystemHost />
        <CircleSessionBannerHost />
        <FamilyWorshipBannerHost />
        <CompletionMomentHost />
        <MessageBannerHost />
        <PushNotificationHost />
        <PresenceHost />
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
        <ErrorBoundary
          onError={(error, stackTrace) => {
            // The boundary previously caught render exceptions silently —
            // "Something went wrong" gave no clue which screen or provider
            // threw, or why. This logs the real error/component stack so it
            // shows up in Metro/device logs (and __DEV__'s own error-details
            // modal already surfaces it in the UI); no PII or tokens are
            // logged, just the error message and React's component stack.
            console.error("[ErrorBoundary] Uncaught render error:", error, "\nComponent stack:", stackTrace);
          }}
        >
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
