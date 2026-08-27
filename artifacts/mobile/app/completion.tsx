import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, BackHandler, ActivityIndicator, TouchableOpacity, Dimensions } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import LivingTree from "@/components/LivingTree";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

// The Completion Moment — a 4-phase, mostly-non-skippable cinematic
// experience that fires exactly once, the moment DataContext detects all 12
// Core Curriculum modules are complete (see checkCurriculumCompletion /
// pendingCompletionMoment / CompletionMomentHost in _layout.tsx).

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
type Phase = 1 | 2 | 3 | 4;

interface Letter {
  letterText: string;
  writtenAt: string | null;
  peerGuideName: string;
}

export default function CompletionMomentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, updateProfile } = useAuth();
  const { treeData, treeMentees, forestStats, modules, fruitCatalog, userFruits } = useData();

  const [phase, setPhase] = useState<Phase>(1);

  // Hardware back is blocked during phases 1-3 — this is a ceremony, not a
  // browsable screen, until the user reaches the final commission choice.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => phase < 4);
    return () => sub.remove();
  }, [phase]);

  const categoryByFruitKey = useMemo(() => new Map(fruitCatalog.map((f) => [f.fruitKey, f.category])), [fruitCatalog]);
  const treeFruits = useMemo(
    () => userFruits.map((f) => ({ fruitKey: f.fruitKey, category: categoryByFruitKey.get(f.fruitKey) ?? "special", awardedAt: f.awardedAt })),
    [userFruits, categoryByFruitKey]
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={[styles.progressRow, { top: insets.top + 12 }]}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.progressDot, i <= phase && styles.progressDotActive]} />
        ))}
      </View>

      {phase === 1 && <Phase1TreeTransforms treeData={treeData} fruits={treeFruits} onDone={() => setPhase(2)} />}
      {phase === 2 && (
        <Phase2Letter
          learnerId={profile?.id ?? null}
          learnerName={profile?.displayName ?? "A disciple"}
          onContinue={() => setPhase(3)}
        />
      )}
      {phase === 3 && (
        <Phase3ForestReveal
          treeData={treeData}
          mentees={treeMentees}
          modules={modules}
          countriesReached={forestStats.countriesReached.length}
          onContinue={() => setPhase(4)}
        />
      )}
      {phase === 4 && (
        <Phase4Commission
          onReady={async () => {
            await updateProfile({ isPeerGuideEligible: true });
            // One-time Home-screen card ("Someone is waiting for a guide like
            // you...") — set here, at the moment eligibility is granted, not
            // read from isPeerGuideEligible directly, since that flag stays
            // true forever and would otherwise show the card on every visit.
            if (profile?.id) await AsyncStorage.setItem(`guideInvitationPending:${profile.id}`, "true");
            router.replace("/(tabs)");
          }}
        />
      )}
    </View>
  );
}

// ── PHASE 1 — The Tree Transforms (~45s, non-skippable) ─────────────────────
function Phase1TreeTransforms({ treeData, fruits, onDone }: { treeData: any; fruits: any[]; onDone: () => void }) {
  const treeScale = useRef(new Animated.Value(1)).current;
  const fruitGlow = useRef(new Animated.Value(0)).current;
  const forestOpacity = useRef(new Animated.Value(0)).current;
  const faithfulOpacity = useRef(new Animated.Value(0)).current;
  const blackOverlay = useRef(new Animated.Value(0)).current;
  const particles = useRef(
    Array.from({ length: 24 }, (_, i) => ({
      dx: (Math.random() - 0.5) * 220,
      delay: i * 40,
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(fruitGlow, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(fruitGlow, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }, 3000));

    timers.push(setTimeout(() => {
      Animated.timing(treeScale, { toValue: 1.4, duration: 5000, useNativeDriver: true }).start();
    }, 8000));

    timers.push(setTimeout(() => {
      particles.forEach((p) => {
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.parallel([
            Animated.timing(p.opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(p.translateY, { toValue: -220, duration: 6000, useNativeDriver: true }),
          ]),
        ]).start();
      });
    }, 13000));

    timers.push(setTimeout(() => {
      particles.forEach((p) => Animated.timing(p.opacity, { toValue: 0, duration: 2000, useNativeDriver: true }).start());
    }, 20000));

    timers.push(setTimeout(() => {
      Animated.timing(treeScale, { toValue: 0.6, duration: 8000, useNativeDriver: true }).start();
      Animated.timing(forestOpacity, { toValue: 1, duration: 3000, useNativeDriver: true }).start();
    }, 25000));

    timers.push(setTimeout(() => {
      Animated.timing(faithfulOpacity, { toValue: 1, duration: 1500, useNativeDriver: true }).start();
    }, 33000));

    timers.push(setTimeout(() => {
      Animated.timing(forestOpacity, { toValue: 0.5, duration: 1500, useNativeDriver: true }).start();
    }, 38000));

    timers.push(setTimeout(() => {
      Animated.timing(blackOverlay, { toValue: 1, duration: 800, useNativeDriver: true }).start(() => onDone());
    }, 43000));

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!treeData) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator color={colors.accentGreen} size="large" />
      </View>
    );
  }

  const silhouettePositions = [
    { left: "12%", top: "62%", size: 0.35 },
    { left: "78%", top: "58%", size: 0.3 },
    { left: "20%", top: "40%", size: 0.25 },
    { left: "68%", top: "38%", size: 0.28 },
    { left: "45%", top: "70%", size: 0.22 },
  ];

  return (
    <View style={styles.centerFill}>
      {/* Simplified forest silhouettes appearing as the camera zooms out */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: forestOpacity }]} pointerEvents="none">
        {silhouettePositions.map((p, i) => (
          <View key={i} style={[styles.silhouette, { left: p.left as any, top: p.top as any, transform: [{ scale: p.size }] }]}>
            <Ionicons name="triangle" size={80} color="#1B4332" />
          </View>
        ))}
      </Animated.View>

      <Animated.View style={{ transform: [{ scale: treeScale }] }}>
        <Animated.View style={[styles.fruitGlowRing, { opacity: fruitGlow }]} />
        <LivingTree treeData={treeData} compact fruits={fruits} />
      </Animated.View>

      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              left: SCREEN_W / 2 + p.dx,
              opacity: p.opacity,
              transform: [{ translateY: p.translateY }],
            },
          ]}
        />
      ))}

      <Animated.Text style={[styles.faithfulText, { opacity: faithfulOpacity }]}>Faithful.</Animated.Text>

      <Animated.View style={[StyleSheet.absoluteFill, styles.blackOverlay, { opacity: blackOverlay }]} pointerEvents="none" />
    </View>
  );
}

// ── PHASE 2 — The Letter ─────────────────────────────────────────────────────
function Phase2Letter({ learnerId, learnerName, onContinue }: { learnerId: string | null; learnerName: string; onContinue: () => void }) {
  const [letter, setLetter] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);
  const [canContinue, setCanContinue] = useState(false);
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 900, useNativeDriver: true }).start();
    const t = setTimeout(() => setCanContinue(true), 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!learnerId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("p2p_completion_letters")
        .select("letter_text, written_at, peer_guide_id")
        .eq("learner_id", learnerId)
        .eq("is_draft", false)
        .maybeSingle();
      if (data) {
        const { data: guide } = await supabase.from("p2p_profiles").select("full_name").eq("id", data.peer_guide_id).maybeSingle();
        setLetter({ letterText: data.letter_text ?? "", writtenAt: data.written_at, peerGuideName: (guide as any)?.full_name ?? "Your peer guide" });
      }
      setLoading(false);

      // Notify the peer guide that this learner is waiting for a letter —
      // best-effort, never blocks the ceremony itself. p2p_notifications has
      // no client-facing INSERT policy for another user's row, so this must
      // go through the service-role /discipleship/notify-user endpoint
      // rather than a direct client insert.
      try {
        const { data: link } = await supabase.from("p2p_discipleship_links").select("mentor_id").eq("disciple_id", learnerId).eq("active", true).maybeSingle();
        if (link?.mentor_id) {
          await authedFetch("/discipleship/notify-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: link.mentor_id,
              title: "A letter worth writing",
              message: `${learnerName} has completed the Core Curriculum. Write them a letter they will keep forever.`,
            }),
          });
        }
      } catch {}
    })();
  }, [learnerId]);

  return (
    <Animated.View style={[styles.phaseContainer, { opacity: fadeIn }]}>
      <Text style={styles.phaseHeader}>A letter from your peer guide</Text>
      {loading ? (
        <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
      ) : letter ? (
        <View style={styles.letterCard}>
          <Text style={styles.letterText}>{letter.letterText}</Text>
          <View style={styles.letterFooter}>
            <Text style={styles.letterSignature}>— {letter.peerGuideName}</Text>
            {letter.writtenAt && (
              <Text style={styles.letterDate}>{new Date(letter.writtenAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</Text>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.letterShimmer}>
          <ActivityIndicator color={colors.amber} />
          <Text style={styles.shimmerText}>Your peer guide is preparing something for you...</Text>
        </View>
      )}

      {canContinue && (
        <TouchableOpacity style={styles.continueBtn} onPress={onContinue} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ── PHASE 3 — The Forest Reveal ──────────────────────────────────────────────
function Phase3ForestReveal({ treeData, mentees, modules, countriesReached, onContinue }: {
  treeData: any; mentees: any[]; modules: any[]; countriesReached: number; onContinue: () => void;
}) {
  const [visibleLines, setVisibleLines] = useState(0);
  const fadeIn = useRef(new Animated.Value(0)).current;
  const lessonsCompleted = modules.reduce((a: number, m: any) => a + m.completedLessons, 0);
  const livesTouched = mentees.length + (treeData?.secondGenDisciples ?? 0);

  const lines = [
    "You have walked faithfully.",
    `${lessonsCompleted} lessons completed.`,
    `${treeData?.modulesCompleted ?? 12} modules mastered.`,
    mentees.length > 0 ? `${livesTouched} lives touched through your journey.` : "Your forest begins with your next conversation.",
    ...(mentees.length > 0 && countriesReached > 0 ? [`${countriesReached} nation${countriesReached === 1 ? "" : "s"} reached.`] : []),
  ];

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 900, useNativeDriver: true }).start();
    const timers: ReturnType<typeof setTimeout>[] = [];
    lines.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleLines(i + 1), (i + 1) * 1000));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.phaseContainer, { opacity: fadeIn }]}>
      <View style={styles.forestWrap}>
        {treeData && <LivingTree treeData={treeData} compact />}
        {mentees.length > 0 && (
          <View style={styles.menteeRing}>
            {mentees.slice(0, 6).map((m, i) => (
              <View key={m.id} style={[styles.menteeDot, { transform: [{ rotate: `${(i / mentees.length) * 360}deg` }, { translateY: -70 }] }]}>
                <Ionicons name="leaf" size={16} color={colors.accentGreen} />
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={{ gap: 10, marginTop: 20 }}>
        {lines.slice(0, visibleLines).map((line, i) => (
          <Text key={i} style={styles.forestStatLine}>{line}</Text>
        ))}
      </View>

      {visibleLines >= lines.length && (
        <TouchableOpacity style={styles.continueBtn} onPress={onContinue} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ── PHASE 4 — The Commission ──────────────────────────────────────────────────
const COMMISSION_LINES = [
  "You have been faithful.",
  "You have gone deep in the Word.",
  "You have walked with a guide.",
  "Now it is your turn.",
  "You are ready.",
  "Go find your person.",
];

function Phase4Commission({ onReady }: { onReady: () => void }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [showButton, setShowButton] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    COMMISSION_LINES.forEach((_, i) => {
      const pause = i === 3 ? 1500 : i === 4 ? 2000 : i === 5 ? 2000 : 1500;
      elapsed += pause;
      timers.push(setTimeout(() => setVisibleLines(i + 1), elapsed));
    });
    timers.push(setTimeout(() => {
      setShowButton(true);
      Animated.timing(buttonOpacity, { toValue: 1, duration: 800, useNativeDriver: true }).start();
    }, elapsed + 3000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReady() {
    setConfirming(true);
    await onReady();
    setConfirming(false);
    setConfirmed(true);
  }

  return (
    <View style={styles.commissionContainer}>
      <View style={{ gap: 16 }}>
        {COMMISSION_LINES.slice(0, visibleLines).map((line, i) => (
          <Text key={i} style={styles.commissionLine}>{line}</Text>
        ))}
      </View>

      {confirmed && (
        <Text style={styles.confirmText}>Your peer guide role is now active</Text>
      )}

      {showButton && !confirmed && (
        <Animated.View style={{ opacity: buttonOpacity, marginTop: 40 }}>
          <TouchableOpacity style={styles.readyBtn} onPress={handleReady} disabled={confirming} activeOpacity={0.85}>
            {confirming ? <ActivityIndicator color="#0B1F19" /> : <Text style={styles.readyBtnText}>I am ready</Text>}
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#06110D" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  progressRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 8, zIndex: 10 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.2)" },
  progressDotActive: { backgroundColor: colors.amber },

  silhouette: { position: "absolute", opacity: 0.7 },
  fruitGlowRing: {
    position: "absolute", top: -20, left: -20, right: -20, bottom: -20,
    backgroundColor: "rgba(255,215,0,0.25)", borderRadius: 200,
  },
  particle: {
    position: "absolute", top: SCREEN_H * 0.55, width: 5, height: 5, borderRadius: 3, backgroundColor: "#FFD700",
  },
  faithfulText: {
    position: "absolute", bottom: SCREEN_H * 0.12,
    fontSize: 32, fontWeight: "700", color: "#E0A441", fontFamily: "Inter_700Bold", letterSpacing: 1,
  },
  blackOverlay: { backgroundColor: "#06110D" },

  phaseContainer: { flex: 1, paddingHorizontal: 28, paddingTop: 100, alignItems: "center" },
  phaseHeader: { fontSize: 20, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 28 },

  letterCard: {
    backgroundColor: "#FDF3E3", borderRadius: 16, padding: 24, width: "100%",
  },
  letterText: { fontSize: 16, color: "#3D2A16", fontFamily: "Inter_400Regular", lineHeight: 26, fontStyle: "italic" },
  letterFooter: { marginTop: 20, borderTopWidth: 1, borderTopColor: "rgba(61,42,22,0.15)", paddingTop: 12 },
  letterSignature: { fontSize: 15, fontWeight: "700", color: "#3D2A16", fontFamily: "Inter_700Bold" },
  letterDate: { fontSize: 12, color: "rgba(61,42,22,0.6)", fontFamily: "Inter_400Regular", marginTop: 2 },

  letterShimmer: { alignItems: "center", gap: 14, marginTop: 40 },
  shimmerText: { fontSize: 14, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center" },

  continueBtn: { backgroundColor: colors.accentGreen, borderRadius: 14, height: 52, paddingHorizontal: 40, alignItems: "center", justifyContent: "center", marginTop: 32 },
  continueBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  forestWrap: { alignItems: "center", justifyContent: "center", position: "relative", height: 220 },
  menteeRing: { position: "absolute", top: "50%", left: "50%" },
  menteeDot: { position: "absolute", width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
  forestStatLine: { fontSize: 16, color: "#fff", fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },

  commissionContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  commissionLine: { fontSize: 20, color: "#E0A441", fontFamily: "Inter_600SemiBold", textAlign: "center", lineHeight: 30 },
  confirmText: { fontSize: 14, color: colors.accentGreen, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 24 },
  readyBtn: { backgroundColor: colors.amber, borderRadius: 14, height: 54, paddingHorizontal: 48, alignItems: "center", justifyContent: "center" },
  readyBtnText: { color: "#0B1F19", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
