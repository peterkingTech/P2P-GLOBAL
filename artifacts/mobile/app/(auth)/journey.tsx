import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Animated,
  Image,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";
import MinistryRolePicker from "@/components/MinistryRolePicker";
import colors from "@/constants/colors";

// The Integration and Onboarding Journey — 5 mandatory steps every new user
// goes through after registration/profile-setup, before Module 1. Anchored
// in Romans 15:7. See AuthGate in app/_layout.tsx for how this is enforced
// (redirects any authenticated user whose onboarding_journey_completed_at
// is still null here, exactly once).

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const TREE_NAME_SUGGESTIONS = [
  "e.g. Spiritual Growth Journey",
  "e.g. My Faith Walk",
  "e.g. Rooted in Christ",
  "e.g. Growing in Grace",
  "e.g. Kingdom Journey",
  "e.g. Walking with God",
];

interface PeerGuide {
  id: string;
  fullName: string;
  photoUrl: string | null;
  country: string | null;
  bio: string | null;
}

export default function JourneyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, updateProfile, refreshProfile } = useAuth();
  const { modules, lessons } = useData();

  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [peerGuide, setPeerGuide] = useState<PeerGuide | null>(null);
  const [peerGuideLoading, setPeerGuideLoading] = useState(true);
  const [greeting, setGreeting] = useState("");
  const [savingStep1, setSavingStep1] = useState(false);

  // Step 2
  const [storyComingFrom, setStoryComingFrom] = useState("");
  const [storyWhyToday, setStoryWhyToday] = useState("");
  const [storyAnythingElse, setStoryAnythingElse] = useState("");
  const [savingStep2, setSavingStep2] = useState(false);

  // Step 3
  const [prayed, setPrayed] = useState(false);
  const [wantsPeerPrayer, setWantsPeerPrayer] = useState<boolean | null>(null);
  const [notifyingPeerGuide, setNotifyingPeerGuide] = useState(false);

  // Step 4
  const [treeName, setTreeName] = useState("");
  const [savingStep4, setSavingStep4] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const seedScale = useRef(new Animated.Value(0.4)).current;
  const seedOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % TREE_NAME_SUGGESTIONS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Step 5
  const [beginning, setBeginning] = useState(false);

  useEffect(() => {
    if (step !== 4) return;
    seedScale.setValue(0.4);
    seedOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(seedScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.timing(seedOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [step]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      setPeerGuideLoading(true);
      const { data: link } = await supabase
        .from("p2p_discipleship_links")
        .select("mentor_id")
        .eq("disciple_id", profile.id)
        .eq("active", true)
        .maybeSingle();
      if (link?.mentor_id && !cancelled) {
        const { data: mentor } = await supabase
          .from("p2p_profiles")
          .select("id, full_name, photo_url, country, bio")
          .eq("id", link.mentor_id)
          .maybeSingle();
        if (mentor && !cancelled) {
          setPeerGuide({
            id: mentor.id,
            fullName: mentor.full_name ?? "Your peer guide",
            photoUrl: mentor.photo_url ?? null,
            country: mentor.country ?? null,
            bio: mentor.bio ?? null,
          });
        }
      }
      if (!cancelled) setPeerGuideLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  function goNext() {
    setStep((s) => (Math.min(5, s + 1) as Step));
  }

  async function handleStep1Continue() {
    if (greeting.trim() && profile?.id) {
      setSavingStep1(true);
      try {
        await supabase.from("p2p_profiles").update({ greeting_to_peer_guide: greeting.trim() }).eq("id", profile.id);
      } catch {}
      setSavingStep1(false);
    }
    goNext();
  }

  async function handleStep2Continue() {
    if (profile?.id) {
      setSavingStep2(true);
      try {
        await supabase.from("p2p_profiles").update({
          story_answers: {
            coming_from: storyComingFrom.trim() || null,
            why_today: storyWhyToday.trim() || null,
            anything_else: storyAnythingElse.trim() || null,
          },
        }).eq("id", profile.id);
      } catch {}
      setSavingStep2(false);
    }
    goNext();
  }

  async function handlePeerPrayerChoice(yes: boolean) {
    setWantsPeerPrayer(yes);
    if (yes && profile?.id) {
      setNotifyingPeerGuide(true);
      try {
        await authedFetch("/discipleship/notify-peer-guide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: profile.id,
            title: "A prayer request",
            message: `${profile.displayName?.split(" ")[0] ?? "Your disciple"} has begun their journey and would love to pray with you in your first session.`,
          }),
        });
      } catch {}
      setNotifyingPeerGuide(false);
    }
  }

  async function handleStep4Continue() {
    if (profile?.id && treeName.trim()) {
      setSavingStep4(true);
      try {
        await supabase.from("p2p_profiles").update({ tree_name: treeName.trim() }).eq("id", profile.id);
      } catch {}
      setSavingStep4(false);
    }
    goNext();
  }

  const module1 = modules.find((m) => m.level === 1) ?? modules[0] ?? null;
  const module1FirstLesson = module1
    ? [...lessons].filter((l) => l.moduleId === module1.id).sort((a, b) => a.order - b.order)[0] ?? null
    : null;

  // Shared completion side-effects — marks onboarding done and notifies the
  // peer guide. Called from the normal step-5 path (non-leaders) and from
  // both step-6 buttons (ministry leaders), so it only runs once per user
  // regardless of which path they take.
  async function completeOnboarding() {
    if (!profile?.id) return;
    await updateProfile({
      onboardingJourneyCompletedAt: new Date().toISOString(),
      growthLevel: Math.max(profile.growthLevel ?? 0, 4), // 4 = Sprout stage threshold
    });
    await refreshProfile();
    if (peerGuide) {
      authedFetch("/discipleship/notify-peer-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: profile.id,
          title: "Ready for Module 1",
          message: `${profile.displayName?.split(" ")[0] ?? "Your disciple"} has completed the onboarding journey and is ready to begin Module 1.`,
        }),
      }).catch(() => {});
    }
  }

  // Step 5's "Begin Module 1" button — ministry leaders see one more step
  // (Step 6, Your Congregation) before completion; everyone else completes
  // immediately and jumps straight into the lesson, unchanged from before.
  async function handleStep5Continue() {
    if (!profile?.id) { router.replace("/(tabs)"); return; }
    if (profile.isMinistryLeader) { setStep(6); return; }
    setBeginning(true);
    try {
      await completeOnboarding();
    } finally {
      setBeginning(false);
    }
    if (module1FirstLesson) {
      router.replace(`/lesson/${module1FirstLesson.id}` as any);
    } else {
      router.replace("/(tabs)/learn" as any);
    }
  }

  async function handleRegisterChurchNow() {
    setBeginning(true);
    try {
      await completeOnboarding();
    } finally {
      setBeginning(false);
    }
    router.replace("/church/register" as any);
  }

  async function handleChurchLater() {
    setBeginning(true);
    try {
      await completeOnboarding();
    } finally {
      setBeginning(false);
    }
    router.replace("/(tabs)" as any);
  }

  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);
  const totalSteps = profile?.isMinistryLeader ? 6 : 5;

  // Ministry-role capture is required at registration, but the actual
  // registration flow (register -> intake -> profile-setup) reliably gets
  // raced out by AuthGate's own redirect-to-/journey-once-authenticated
  // logic (app/_layout.tsx) before a fresh user ever sees those screens —
  // confirmed live, not theoretical. journey.tsx is the one screen AuthGate
  // itself guarantees every new user reaches, so it's the real enforcement
  // point: gate the whole journey behind this choice rather than relying on
  // profile-setup.tsx (still built, still useful if that flow is ever
  // reached some other way, just not the guarantee).
  if (profile && !profile.ministryRoleUpdatedAt) {
    return (
      <View style={[styles.root, { paddingTop: topPad }]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>What Best Describes You?</Text>
          <Text style={styles.subtitle}>
            This helps us tailor your experience — including church tools if you lead a congregation.
          </Text>
          <MinistryRolePicker
            value={profile.ministryRole ?? null}
            onSelect={async (role) => {
              await updateProfile({ ministryRole: role, ministryRoleUpdatedAt: new Date().toISOString() });
              await refreshProfile();
            }}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.progressRow}>
        {Array.from({ length: totalSteps }, (_, idx) => idx + 1).map((i) => (
          <View key={i} style={[styles.progressDot, i <= step && styles.progressDotActive]} />
        ))}
      </View>
      <Text style={styles.stepOf}>Step {step} of {totalSteps}</Text>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && (
          <>
            <Text style={styles.title}>Meet Your Peer Guide</Text>
            <Text style={styles.peerGuideExplainer}>
              A peer guide is a fellow believer who is one step ahead of you{"\n"}
              on the discipleship journey. They are not a pastor or a teacher —{"\n"}
              they are simply someone who has walked this path before you and{"\n"}
              is ready to walk alongside you now.
              {"\n\n"}
              Your peer guide will go through every lesson with you, answer{"\n"}
              your questions, review your reflections, and pray with you.{"\n"}
              Think of them as a spiritual friend with a little more experience.
            </Text>
            <View style={styles.verseBlock}>
              <Text style={styles.verseText}>"Accept one another, just as Christ accepted you."</Text>
              <Text style={styles.verseRef}>Romans 15:7</Text>
            </View>

            {peerGuideLoading ? (
              <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 24 }} />
            ) : peerGuide ? (
              <View style={styles.guideCard}>
                {peerGuide.photoUrl ? (
                  <Image source={{ uri: peerGuide.photoUrl }} style={styles.guideAvatar} />
                ) : (
                  <View style={[styles.guideAvatar, styles.guideAvatarPlaceholder]}>
                    <Text style={styles.guideAvatarInitial}>{peerGuide.fullName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={styles.guideName}>{peerGuide.fullName}</Text>
                {peerGuide.country && <Text style={styles.guideCountry}>{peerGuide.country}</Text>}
                {peerGuide.bio && <Text style={styles.guideBio}>{peerGuide.bio}</Text>}
              </View>
            ) : (
              <View style={styles.waitingCard}>
                <Ionicons name="hourglass-outline" size={26} color={colors.accentGreen} />
                <Text style={styles.waitingText}>
                  Your peer guide is being matched. You can begin your journey while we find the right person for you.
                </Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>Send a greeting</Text>
            <TextInput
              style={styles.textArea}
              value={greeting}
              onChangeText={setGreeting}
              placeholder="Write a short introduction to your peer guide…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleStep1Continue} disabled={savingStep1}>
              {savingStep1 ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>Share Your Story</Text>
            <Text style={styles.subtitle}>Your peer guide wants to know you — not just your answers</Text>

            <Text style={styles.fieldLabel}>Where are you coming from in life right now?</Text>
            <TextInput
              style={styles.textArea}
              value={storyComingFrom}
              onChangeText={setStoryComingFrom}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.fieldLabel}>What made you take this step today?</Text>
            <TextInput
              style={styles.textArea}
              value={storyWhyToday}
              onChangeText={setStoryWhyToday}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.fieldLabel}>Is there anything you want your peer guide to know about you?</Text>
            <TextInput
              style={styles.textArea}
              value={storyAnythingElse}
              onChangeText={setStoryAnythingElse}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.privacyNote}>All answers are private — only visible to your peer guide.</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleStep2Continue} disabled={savingStep2}>
              {savingStep2 ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.title}>Pray Together</Text>
            <Text style={styles.subtitle}>Begin your journey with prayer</Text>

            <View style={styles.prayerCard}>
              <Text style={styles.prayerText}>
                Lord Jesus, I am taking this step today.{"\n"}
                I want to know You more deeply.{"\n"}
                I want to grow in Your Word.{"\n"}
                I ask You to guide me through this journey.{"\n"}
                Thank You for the person who will walk alongside me.{"\n"}
                May this be the beginning of something that changes my life.{"\n"}
                Amen.
              </Text>
            </View>

            {!prayed ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setPrayed(true)}>
                <Text style={styles.primaryBtnText}>I prayed this</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Would you like your peer guide to pray with you?</Text>
                <View style={styles.yesNoRow}>
                  <TouchableOpacity
                    style={[styles.yesNoBtn, wantsPeerPrayer === true && styles.yesNoBtnActive]}
                    onPress={() => handlePeerPrayerChoice(true)}
                    disabled={notifyingPeerGuide}
                  >
                    <Text style={[styles.yesNoBtnText, wantsPeerPrayer === true && styles.yesNoBtnTextActive]}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.yesNoBtn, wantsPeerPrayer === false && styles.yesNoBtnActive]}
                    onPress={() => handlePeerPrayerChoice(false)}
                    disabled={notifyingPeerGuide}
                  >
                    <Text style={[styles.yesNoBtnText, wantsPeerPrayer === false && styles.yesNoBtnTextActive]}>Not now</Text>
                  </TouchableOpacity>
                </View>
                {wantsPeerPrayer === true && (
                  <Text style={styles.confirmNote}>
                    {notifyingPeerGuide ? "Letting your peer guide know…" : "Your peer guide has been notified."}
                  </Text>
                )}

                <TouchableOpacity style={styles.primaryBtn} onPress={goNext}>
                  <Text style={styles.primaryBtnText}>Continue</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <Text style={styles.title}>Plant Your Tree</Text>
            <Text style={styles.subtitle}>Every forest begins with one seed</Text>

            <Text style={styles.explanationText}>
              In P2P Global, your spiritual growth is shown as a living tree. As you complete lessons, your roots
              grow deeper. As you guide others, branches spread. As you bear fruit, the forest grows.
            </Text>

            <Animated.View style={[styles.seedWrap, { opacity: seedOpacity, transform: [{ scale: seedScale }] }]}>
              <Text style={styles.seedEmoji}>🌰</Text>
            </Animated.View>
            <Text style={styles.currentStageLabel}>Current stage: Seed</Text>

            <Text style={styles.fieldLabel}>Give your tree a name</Text>
            <TextInput
              style={styles.input}
              value={treeName}
              onChangeText={setTreeName}
              placeholder={TREE_NAME_SUGGESTIONS[placeholderIndex]}
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.treeNameNote}>You can always change this later in your profile settings.</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleStep4Continue} disabled={savingStep4}>
              {savingStep4 ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Plant My Tree</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 5 && (
          <>
            <Text style={styles.title}>You are ready</Text>
            <Text style={styles.subtitle}>Your journey begins now</Text>

            <View style={styles.moduleCard}>
              <Text style={styles.moduleCardTitle}>
                {module1 ? module1.title : "Module 1: Your New Identity in Christ"}
              </Text>
              <Text style={styles.moduleCardDesc}>
                {module1?.description || "Discover who you truly are in Christ. This is where everything begins."}
              </Text>
            </View>

            {peerGuide && (
              <Text style={styles.withGuideText}>You will go through this with {peerGuide.fullName}</Text>
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleStep5Continue} disabled={beginning}>
              {beginning ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Begin Module 1</Text>}
            </TouchableOpacity>

            <Text style={styles.footerVerse}>Romans 15:7 — Accept one another, just as Christ accepted you.</Text>
          </>
        )}

        {step === 6 && (
          <>
            <Text style={styles.title}>⛪ Your Congregation</Text>
            <Text style={styles.subtitle}>
              P2P Global has a free Church Discipleship Portal for pastors and church leaders.
            </Text>

            <View style={styles.moduleCard}>
              <Text style={styles.moduleCardDesc}>
                See your congregation's discipleship activity in real time. Manage cohorts. Support your members.
                {"\n\n"}Completely free. Always.
              </Text>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleRegisterChurchNow} disabled={beginning}>
              {beginning ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Register My Church Now →</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleChurchLater} disabled={beginning}>
              <Text style={styles.secondaryBtnText}>I will do this later →</Text>
            </TouchableOpacity>

            <Text style={styles.footerVerse}>Romans 15:7 — Accept one another, just as Christ accepted you.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  progressRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderBeige },
  progressDotActive: { backgroundColor: colors.accentGreen },
  stepOf: { textAlign: "center", fontSize: 11, color: colors.textMuted, fontFamily: "Inter_500Medium", marginTop: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  content: { paddingHorizontal: 24, paddingTop: 20 },

  title: { fontSize: 24, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 20, lineHeight: 20 },

  peerGuideExplainer: {
    fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 20, marginBottom: 20, paddingHorizontal: 8,
  },
  verseBlock: { alignItems: "center", marginBottom: 24, paddingHorizontal: 12 },
  verseText: { fontSize: 15, color: colors.textDark, fontStyle: "italic", textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 22 },
  verseRef: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 6 },

  guideCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 20, alignItems: "center", marginBottom: 24,
  },
  guideAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 10 },
  guideAvatarPlaceholder: { backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  guideAvatarInitial: { color: "#fff", fontSize: 26, fontWeight: "700", fontFamily: "Inter_700Bold" },
  guideName: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  guideCountry: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  guideBio: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, lineHeight: 19 },

  waitingCard: {
    backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(29,158,117,0.2)",
    padding: 20, alignItems: "center", gap: 10, marginBottom: 24,
  },
  waitingText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginTop: 12 },
  textArea: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 14, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 80, textAlignVertical: "top",
  },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 14, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  privacyNote: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 16, textAlign: "center" },
  treeNameNote: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },

  prayerCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 20, marginBottom: 20,
  },
  prayerText: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 26, textAlign: "center" },

  yesNoRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  yesNoBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
    borderWidth: 1.5, borderColor: colors.borderBeige, backgroundColor: colors.card,
  },
  yesNoBtnActive: { borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
  yesNoBtnText: { fontSize: 14, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  yesNoBtnTextActive: { color: colors.accentGreen },
  confirmNote: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium", textAlign: "center", marginBottom: 8 },

  explanationText: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center", marginBottom: 24 },
  seedWrap: { alignItems: "center", justifyContent: "center", marginBottom: 12 },
  seedEmoji: { fontSize: 64 },
  currentStageLabel: { textAlign: "center", fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginBottom: 20 },

  moduleCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 18, marginBottom: 16,
  },
  moduleCardTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
  moduleCardDesc: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
  withGuideText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 20 },
  footerVerse: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center", marginTop: 20 },

  primaryBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center", marginTop: 16,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },

  secondaryBtn: {
    borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center", marginTop: 10,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  secondaryBtnText: { color: colors.textMid, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});