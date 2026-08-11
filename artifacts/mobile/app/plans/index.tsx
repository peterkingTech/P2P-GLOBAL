import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  LayoutChangeEvent,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData, Plan, PlanCategory, PlanSearchResult, PlanWithCategory } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";
import { getPlanCategoryMeta } from "@/lib/planCategories";

type PlansTab = "my" | "find" | "saved" | "completed";
type FindSubTab = "categories" | "az" | "search";

type ActivePlan = Plan & { progressPercent: number; lastActivityAt: string | null };
type SavedPlan = Plan & { savedAt: string | null };
type CompletedPlan = Plan & { completedAt: string | null };

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function alertLocked(message: string) {
  if (Platform.OS === "web") window.alert(message);
  else Alert.alert("Plan Locked", message);
}

// The 10 top-level plan category collections (p2p_curriculums rows with
// type='plan_category', see migration 054_plan_categories.sql) — id/
// planCount/description are fetched live via DataContext's planCategories
// (the database is authoritative for those); label/icon/color/order come
// from the shared PLAN_CATEGORIES constant (lib/planCategories.ts) so
// they're defined in exactly one place across the app.
function CategoryCard({ category, colors, onPress }: { category: PlanCategory; colors: AppColors; onPress: () => void }) {
  const styles = makeStyles(colors);
  const meta = getPlanCategoryMeta(category.category);
  return (
    <TouchableOpacity
      style={[styles.categoryCard, { backgroundColor: meta?.color ?? category.colorTheme }]}
      activeOpacity={0.88}
      onPress={onPress}
    >
      <Text style={styles.categoryCardEmoji}>{meta?.icon ?? "📖"}</Text>
      <Text style={styles.categoryCardTitle} numberOfLines={2}>{meta?.label ?? category.title}</Text>
      <Text style={styles.categoryCardCount}>{category.planCount} plan{category.planCount === 1 ? "" : "s"}</Text>
    </TouchableOpacity>
  );
}

// Shared row for the A-Z list and Search Results — both show a plan's
// title, its category (colored dot + name), and lock status.
function PlanListRow({
  title, categoryTitle, categoryColorTheme, locked, unlockMessage, onPress,
}: {
  title: string; categoryTitle: string | null; categoryColorTheme: string;
  locked: boolean; unlockMessage: string | null; onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.azRow, locked && styles.azRowLocked]}
      activeOpacity={0.85}
      onPress={() => (locked ? alertLocked(unlockMessage ?? "Complete the previous plan first to access this plan.") : onPress())}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.azRowTitle, locked && styles.azRowTitleLocked]} numberOfLines={1}>{title}</Text>
        {categoryTitle && (
          <View style={styles.azRowCategoryRow}>
            <View style={[styles.azRowDot, { backgroundColor: categoryColorTheme }]} />
            <Text style={styles.azRowCategoryText}>{categoryTitle}</Text>
          </View>
        )}
      </View>
      <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={16} color={locked ? colors.textMuted : colors.textMuted} />
    </TouchableOpacity>
  );
}

const FORMAT_LABELS: Record<string, string> = {
  solo: "Solo",
  "peer-guide": "With Peer Guide",
  "peer_guide": "With Peer Guide",
  group: "Group Circle",
  "group-circle": "Group Circle",
};

function formatBadgeFromTags(tags: string[]): string | null {
  for (const tag of tags) {
    const key = tag.toLowerCase().trim();
    if (FORMAT_LABELS[key]) return FORMAT_LABELS[key];
  }
  return null;
}

// ── Shared plan card ─────────────────────────────────────────────────────────
function PlanCard({
  plan,
  colors,
  progressPercent,
  subLine,
  categoryLabel,
  isSaved,
  onToggleSave,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onPress,
}: {
  plan: Plan;
  colors: AppColors;
  progressPercent?: number;
  subLine?: string;
  // Which of the 10 plan-category collections this plan belongs to — shown
  // as "Category · Title" so an enrolled plan in My Plans carries context of
  // which collection it's from (see migration 054_plan_categories.sql).
  categoryLabel?: string;
  isSaved?: boolean;
  onToggleSave?: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onPress: () => void;
}) {
  const styles = makeStyles(colors);
  const [imgErr, setImgErr] = useState(false);
  const format = formatBadgeFromTags(plan.tags);

  return (
    <TouchableOpacity style={styles.planCard} activeOpacity={0.88} onPress={onPress}>
      <View style={styles.planCardTop}>
        {plan.coverImageUrl && !imgErr ? (
          <Image source={{ uri: plan.coverImageUrl }} style={styles.planCardImg} resizeMode="cover" onError={() => setImgErr(true)} />
        ) : (
          <View style={[styles.planCardImg, styles.planCardImgPlaceholder, { backgroundColor: `${plan.colorTheme}1A` }]}>
            <Ionicons name="book-outline" size={26} color={plan.colorTheme} />
          </View>
        )}
        {onToggleSave && (
          <TouchableOpacity
            style={styles.bookmarkBtn}
            onPress={(e) => { e.stopPropagation?.(); onToggleSave(); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name={isSaved ? "bookmark" : "bookmark-outline"} size={18} color={isSaved ? colors.accentGreen : "#fff"} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.planCardBody}>
        <Text style={styles.planCardTitle} numberOfLines={2}>
          {categoryLabel ? `${categoryLabel} · ${plan.title}` : plan.title}
        </Text>
        {plan.teachingCreditName && (
          <Text style={styles.planCardCredit} numberOfLines={1}>{plan.teachingCreditName}</Text>
        )}
        {subLine && <Text style={styles.planCardSub} numberOfLines={1}>{subLine}</Text>}

        <View style={styles.badgeRow}>
          <View style={[styles.badge, { borderColor: plan.colorTheme }]}>
            <Text style={[styles.badgeText, { color: plan.colorTheme }]}>{plan.difficultyLevel}</Text>
          </View>
          {plan.estimatedWeeks ? (
            <View style={styles.badgeMuted}>
              <Text style={styles.badgeMutedText}>{plan.estimatedWeeks} wk{plan.estimatedWeeks === 1 ? "" : "s"}</Text>
            </View>
          ) : null}
          {format ? (
            <View style={styles.badgeMuted}>
              <Text style={styles.badgeMutedText}>{format}</Text>
            </View>
          ) : null}
        </View>

        {typeof progressPercent === "number" && (
          <View style={styles.progressRow}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` as any, backgroundColor: progressPercent === 100 ? colors.accentGreen : colors.amber }]} />
            </View>
            <Text style={styles.progressPctText}>{progressPercent}%</Text>
          </View>
        )}

        <View style={styles.cardActionsRow}>
          {primaryLabel && onPrimary && (
            <TouchableOpacity style={styles.primaryBtn} onPress={(e) => { e.stopPropagation?.(); onPrimary(); }}>
              <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
            </TouchableOpacity>
          )}
          {secondaryLabel && onSecondary && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={(e) => { e.stopPropagation?.(); onSecondary(); }}>
              <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function EmptyState({ colors, icon, text, actionLabel, onAction }: { colors: AppColors; icon: keyof typeof Ionicons.glyphMap; text: string; actionLabel?: string; onAction?: () => void }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={36} color={colors.textMuted} />
      <Text style={styles.emptyStateText}>{text}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.emptyStateBtn} onPress={onAction}>
          <Text style={styles.emptyStateBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Plan completion share modal (Completed tab) ─────────────────────────────
function PlanCompletionShareModal({ plan, completedAt, onClose }: { plan: CompletedPlan; completedAt: string | null; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const shotRef = useRef<ViewShot>(null);
  const [busy, setBusy] = useState(false);
  const dateLabel = completedAt
    ? new Date(completedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  async function handleShare() {
    setBusy(true);
    try {
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error("Could not capture the card");
      const available = await Sharing.isAvailableAsync();
      if (!available) return;
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share your completion" });
    } catch {
      // Non-critical — sharing is a bonus action, not a core flow.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.shareOverlay}>
        <TouchableOpacity style={styles.shareCloseBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }}>
          <View style={[styles.shareCard, { borderColor: `${plan.colorTheme}66` }]}>
            <View style={[styles.shareBadge, { backgroundColor: plan.colorTheme }]}>
              <Ionicons name="checkmark" size={22} color="#fff" />
            </View>
            <Text style={styles.shareTitle}>{plan.title}</Text>
            <Text style={styles.shareSubtitle}>Completed</Text>
            <Text style={styles.shareDate}>{dateLabel}</Text>
          </View>
        </ViewShot>
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#0B3A2E" size="small" /> : (
            <>
              <Ionicons name="share-outline" size={16} color="#0B3A2E" />
              <Text style={styles.shareBtnText}>Share</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export default function PlansHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { profile } = useAuth();
  const { plans: allPlans, getPlanProgress, planCategories, loadPlanCategories, searchPlans, getAllPlansAZ } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const initialTab: PlansTab = params.tab === "find" || params.tab === "saved" || params.tab === "completed" ? (params.tab as PlansTab) : "my";
  const [tab, setTab] = useState<PlansTab>(initialTab);

  // My Plans state
  const [activePlans, setActivePlans] = useState<ActivePlan[]>([]);
  const [myPlansLoading, setMyPlansLoading] = useState(true);

  // Saved state
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Completed state
  const [completedPlans, setCompletedPlans] = useState<CompletedPlan[]>([]);
  const [completedLoading, setCompletedLoading] = useState(true);
  const [shareTarget, setShareTarget] = useState<CompletedPlan | null>(null);

  // Find Plans state
  const [search, setSearch] = useState("");
  const [findSubTab, setFindSubTab] = useState<FindSubTab>("categories");
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [azPlans, setAzPlans] = useState<PlanWithCategory[]>([]);
  const [azLoading, setAzLoading] = useState(false);
  const [azLoaded, setAzLoaded] = useState(false);
  const [searchResults, setSearchResults] = useState<PlanSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const azScrollRef = useRef<ScrollView>(null);
  const letterOffsets = useRef<Record<string, number>>({});

  const loadMyPlans = useCallback(async () => {
    if (!profile?.id) return;
    setMyPlansLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/plans/active/${profile.id}`);
      const data = (await res.json()) as ActivePlan[];
      setActivePlans(Array.isArray(data) ? data : []);
    } catch {
      setActivePlans([]);
    } finally {
      setMyPlansLoading(false);
    }
  }, [profile?.id]);

  // Enroll — first time through, route via the pre-plan goal questions
  // (Prompt 3); once a p2p_plan_enrollments row already exists, skip
  // straight to the plan itself.
  const goToPlanOrQuestions = useCallback(async (planId: string) => {
    if (!profile?.id) { router.push(`/plan/${planId}` as any); return; }
    const { data } = await supabase
      .from("p2p_plan_enrollments")
      .select("id")
      .eq("user_id", profile.id)
      .eq("plan_id", planId)
      .maybeSingle();
    if (data) router.push(`/plan/${planId}` as any);
    else router.push(`/plans/pre-plan-questions?planId=${planId}` as any);
  }, [profile?.id, router]);

  const loadSaved = useCallback(async () => {
    if (!profile?.id) return;
    setSavedLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/plans/saved/${profile.id}`);
      const data = (await res.json()) as SavedPlan[];
      setSavedPlans(Array.isArray(data) ? data : []);
      setSavedIds(new Set((Array.isArray(data) ? data : []).map((p) => p.id)));
    } catch {
      setSavedPlans([]);
    } finally {
      setSavedLoading(false);
    }
  }, [profile?.id]);

  const loadCompleted = useCallback(async () => {
    if (!profile?.id) return;
    setCompletedLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/plans/completed/${profile.id}`);
      const data = (await res.json()) as CompletedPlan[];
      setCompletedPlans(Array.isArray(data) ? data : []);
    } catch {
      setCompletedPlans([]);
    } finally {
      setCompletedLoading(false);
    }
  }, [profile?.id]);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    await loadPlanCategories();
    setCategoriesLoading(false);
  }, [loadPlanCategories]);

  const loadAz = useCallback(async () => {
    setAzLoading(true);
    try {
      const data = await getAllPlansAZ();
      setAzPlans(data);
      setAzLoaded(true);
    } finally {
      setAzLoading(false);
    }
  }, [getAllPlansAZ]);

  useEffect(() => { loadMyPlans(); }, [loadMyPlans]);
  useEffect(() => { loadSaved(); }, [loadSaved]);
  useEffect(() => { loadCompleted(); }, [loadCompleted]);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  // Load the A-Z list lazily, the first time that sub-tab is opened.
  useEffect(() => {
    if (findSubTab === "az" && !azLoaded && !azLoading) loadAz();
  }, [findSubTab, azLoaded, azLoading, loadAz]);

  // 300ms-debounced server search — jumps to the Search Results sub-tab the
  // moment text appears, and returns to Categories once it's cleared.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults([]);
      setFindSubTab((prev) => (prev === "search" ? "categories" : prev));
      return;
    }
    setFindSubTab("search");
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      const results = await searchPlans(q);
      setSearchResults(results);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchPlans]);

  function scrollToLetter(letter: string) {
    const y = letterOffsets.current[letter];
    if (y !== undefined) azScrollRef.current?.scrollTo({ y, animated: true });
  }

  async function toggleSave(planId: string) {
    if (!profile?.id) return;
    const isSaved = savedIds.has(planId);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(planId); else next.add(planId);
      return next;
    });
    try {
      if (isSaved) {
        await fetch(`${getApiUrl()}/plans/${planId}/save?userId=${profile.id}`, { method: "DELETE" });
      } else {
        await fetch(`${getApiUrl()}/plans/${planId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: profile.id }),
        });
      }
      loadSaved();
    } catch {
      // Revert optimistic toggle on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(planId); else next.delete(planId);
        return next;
      });
    }
  }

  // A topic plan's category slug lives in tags[0] (see migration
  // 054_plan_categories.sql) — same convention already used everywhere else
  // in this file for tag-based lookups.
  const categoryTitleBySlug = new Map(planCategories.filter((c) => c.category).map((c) => [c.category as string, c.title]));
  function categoryLabelFor(plan: Plan): string | undefined {
    return plan.tags[0] ? categoryTitleBySlug.get(plan.tags[0]) : undefined;
  }

  const now = Date.now();
  const recentActive = activePlans.filter((p) => p.lastActivityAt && now - new Date(p.lastActivityAt).getTime() < FOURTEEN_DAYS_MS);
  const staleEnrolled = activePlans.filter((p) => !p.lastActivityAt || now - new Date(p.lastActivityAt).getTime() >= FOURTEEN_DAYS_MS);

  const recommended = allPlans.filter((p) => p.isFeatured).slice(0, 6);

  // Grid order follows PLAN_CATEGORIES' canonical `order`, not whatever
  // order the API happened to return (though in practice they already
  // agree, since display_order in the DB was seeded to match).
  const orderedCategories = [...planCategories].sort(
    (a, b) => (getPlanCategoryMeta(a.category)?.order ?? 99) - (getPlanCategoryMeta(b.category)?.order ?? 99)
  );

  // Group the A-Z list by first letter for the alphabet-strip index.
  const azGroups: { letter: string; plans: PlanWithCategory[] }[] = [];
  for (const letter of ALPHABET) {
    const inLetter = azPlans.filter((p) => p.title.trim().charAt(0).toUpperCase() === letter);
    if (inLetter.length) azGroups.push({ letter, plans: inLetter });
  }
  const availableLetters = new Set(azGroups.map((g) => g.letter));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Plans</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.tabBar}>
        {([
          { key: "my", label: "My Plans" },
          { key: "find", label: "Find Plans" },
          { key: "saved", label: "Saved" },
          { key: "completed", label: "Completed" },
        ] as { key: PlansTab; label: string }[]).map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── My Plans ── */}
      {tab === "my" && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {myPlansLoading ? (
            <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
          ) : (
            <>
              <Text style={styles.sectionHeading}>Active Plans</Text>
              {recentActive.length === 0 ? (
                <EmptyState
                  colors={colors}
                  icon="compass-outline"
                  text="You have not started any electives yet. Find your first one below."
                  actionLabel="Find Electives"
                  onAction={() => setTab("find")}
                />
              ) : (
                recentActive.map((p) => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    colors={colors}
                    progressPercent={p.progressPercent}
                    subLine={p.lastActivityAt ? `Last active ${new Date(p.lastActivityAt).toLocaleDateString()}` : undefined}
                    categoryLabel={categoryLabelFor(p)}
                    primaryLabel="Continue"
                    onPrimary={() => router.push(`/plan/${p.id}` as any)}
                    onPress={() => router.push(`/plan/${p.id}` as any)}
                  />
                ))
              )}

              {staleEnrolled.length > 0 && (
                <>
                  <Text style={styles.sectionHeading}>Enrolled</Text>
                  {staleEnrolled.map((p) => (
                    <PlanCard
                      key={p.id}
                      plan={p}
                      colors={colors}
                      progressPercent={p.progressPercent}
                      subLine="You started this — pick it up again"
                      categoryLabel={categoryLabelFor(p)}
                      primaryLabel="Continue"
                      onPrimary={() => router.push(`/plan/${p.id}` as any)}
                      onPress={() => router.push(`/plan/${p.id}` as any)}
                    />
                  ))}
                </>
              )}

              <Text style={styles.sectionHeading}>Peer Circles</Text>
              <EmptyState colors={colors} icon="people-outline" text="You're not part of any peer circles yet." />
            </>
          )}
        </ScrollView>
      )}

      {/* ── Find Plans ── */}
      {tab === "find" && (
        <View style={{ flex: 1 }}>
          <View style={[styles.searchBar, { marginHorizontal: 20, marginTop: 16 }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search plans by title, module, or lesson..."
              placeholderTextColor={colors.textMuted}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.findSubTabRow}>
            {([
              { key: "categories", label: "Categories" },
              { key: "az", label: "A-Z" },
              ...(search.trim() ? [{ key: "search", label: "Search Results" }] : []),
            ] as { key: FindSubTab; label: string }[]).map((t) => (
              <TouchableOpacity key={t.key} style={[styles.findSubTabBtn, findSubTab === t.key && styles.findSubTabBtnActive]} onPress={() => setFindSubTab(t.key)}>
                <Text style={[styles.findSubTabText, findSubTab === t.key && styles.findSubTabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Categories sub-tab ── */}
          {findSubTab === "categories" && (
            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
              {recommended.length > 0 && (
                <>
                  <View style={styles.recommendedHeaderRow}>
                    <Text style={styles.sectionHeading}>Recommended for You</Text>
                    <Text style={styles.recommendedTag}>Based on your goals</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
                    {recommended.map((p) => (
                      <View key={p.id} style={{ width: 220 }}>
                        <PlanCard
                          plan={p}
                          colors={colors}
                          isSaved={savedIds.has(p.id)}
                          onToggleSave={() => toggleSave(p.id)}
                          primaryLabel="Enroll"
                          onPrimary={() => goToPlanOrQuestions(p.id)}
                          onPress={() => router.push(`/plan/${p.id}` as any)}
                        />
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}

              <Text style={styles.sectionHeading}>Plan Collections</Text>
              {categoriesLoading ? (
                <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} />
              ) : planCategories.length === 0 ? (
                <EmptyState colors={colors} icon="albums-outline" text="Plan collections are not available yet." />
              ) : (
                <View style={styles.categoryCardGrid}>
                  {orderedCategories.map((c) => (
                    <View key={c.id} style={styles.categoryCardWrap}>
                      <CategoryCard category={c} colors={colors} onPress={() => router.push(`/plans/category/${c.id}` as any)} />
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}

          {/* ── A-Z sub-tab ── */}
          {findSubTab === "az" && (
            <View style={{ flex: 1, flexDirection: "row" }}>
              <ScrollView
                ref={azScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100, paddingRight: 32 }]}
                showsVerticalScrollIndicator={false}
              >
                {azLoading ? (
                  <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
                ) : azGroups.length === 0 ? (
                  <EmptyState colors={colors} icon="text-outline" text="No plans found." />
                ) : (
                  azGroups.map((group) => (
                    <View key={group.letter} onLayout={(e: LayoutChangeEvent) => { letterOffsets.current[group.letter] = e.nativeEvent.layout.y; }}>
                      <Text style={styles.azLetterHeading}>{group.letter}</Text>
                      {group.plans.map((p) => (
                        <PlanListRow
                          key={p.id}
                          title={p.title}
                          categoryTitle={p.categoryTitle}
                          categoryColorTheme={p.categoryColorTheme}
                          locked={p.locked}
                          unlockMessage={null}
                          onPress={() => router.push(`/plan/${p.id}` as any)}
                        />
                      ))}
                    </View>
                  ))
                )}
              </ScrollView>
              <View style={styles.alphabetStrip}>
                {ALPHABET.map((letter) => (
                  <TouchableOpacity key={letter} onPress={() => scrollToLetter(letter)} hitSlop={{ top: 1, bottom: 1, left: 4, right: 4 }}>
                    <Text style={[styles.alphabetStripLetter, !availableLetters.has(letter) && styles.alphabetStripLetterMuted]}>{letter}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Search Results sub-tab ── */}
          {findSubTab === "search" && (
            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {searchLoading ? (
                <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
              ) : searchResults.length === 0 ? (
                <EmptyState colors={colors} icon="search-outline" text="No plans match your search." />
              ) : (
                searchResults.map((p) => (
                  <PlanListRow
                    key={p.id}
                    title={p.title}
                    categoryTitle={p.categoryTitle}
                    categoryColorTheme={p.categoryColorTheme}
                    locked={p.locked}
                    unlockMessage={p.unlockMessage}
                    onPress={() => router.push(`/plan/${p.id}` as any)}
                  />
                ))
              )}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Saved ── */}
      {tab === "saved" && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {savedLoading ? (
            <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
          ) : savedPlans.length === 0 ? (
            <EmptyState colors={colors} icon="bookmark-outline" text="Save plans to come back to them later. Tap the bookmark icon on any plan." />
          ) : (
            savedPlans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                colors={colors}
                subLine={p.savedAt ? `Saved ${new Date(p.savedAt).toLocaleDateString()}` : undefined}
                isSaved
                onToggleSave={() => toggleSave(p.id)}
                primaryLabel="Start Now"
                onPrimary={() => router.push(`/plan/${p.id}` as any)}
                secondaryLabel="Remove"
                onSecondary={() => toggleSave(p.id)}
                onPress={() => router.push(`/plan/${p.id}` as any)}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* ── Completed ── */}
      {tab === "completed" && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {completedLoading ? (
            <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
          ) : completedPlans.length === 0 ? (
            <EmptyState colors={colors} icon="ribbon-outline" text="Complete your first plan to see it here." />
          ) : (
            completedPlans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                colors={colors}
                subLine={p.completedAt ? `Completed ${new Date(p.completedAt).toLocaleDateString()}` : "Completed"}
                primaryLabel="Do Again"
                onPrimary={() => router.push(`/plan/${p.id}` as any)}
                secondaryLabel="Share"
                onSecondary={() => setShareTarget(p)}
                onPress={() => router.push(`/plan/${p.id}` as any)}
              />
            ))
          )}
        </ScrollView>
      )}

      {shareTarget && (
        <PlanCompletionShareModal plan={shareTarget} completedAt={shareTarget.completedAt} onClose={() => setShareTarget(null)} />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },

    tabBar: { flexDirection: "row", backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabBtnActive: { borderBottomColor: c.accentGreen },
    tabBtnText: { fontSize: 12, fontWeight: "600", color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    tabBtnTextActive: { color: c.accentGreen },

    scroll: { padding: 20 },
    sectionHeading: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12, marginTop: 8 },

    emptyState: { alignItems: "center", paddingVertical: 28, gap: 10 },
    emptyStateText: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", paddingHorizontal: 20, lineHeight: 19 },
    emptyStateBtn: { backgroundColor: c.accentGreen, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, marginTop: 4 },
    emptyStateBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

    planCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 14, overflow: "hidden" },
    planCardTop: { position: "relative" },
    planCardImg: { width: "100%", height: 110 },
    planCardImgPlaceholder: { alignItems: "center", justifyContent: "center" },
    bookmarkBtn: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
    planCardBody: { padding: 14 },
    planCardTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    planCardCredit: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 3 },
    planCardSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },

    badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
    badgeMuted: { backgroundColor: c.cardBeige, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    badgeMutedText: { fontSize: 10, color: c.textMid, fontFamily: "Inter_500Medium" },

    progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    progressBg: { flex: 1, height: 5, backgroundColor: c.progressTrack, borderRadius: 3, overflow: "hidden" },
    progressFill: { height: 5, borderRadius: 3 },
    progressPctText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", minWidth: 30 },

    cardActionsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    primaryBtn: { flex: 1, backgroundColor: c.accentGreen, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
    primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtn: { flex: 1, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
    secondaryBtnText: { color: c.textMid, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

    searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },

    recommendedHeaderRow: { marginBottom: 4 },
    recommendedTag: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_500Medium", marginBottom: 12, marginTop: -8 },

    findSubTabRow: { flexDirection: "row", gap: 6, marginHorizontal: 20, marginTop: 12, marginBottom: 4 },
    findSubTabBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    findSubTabBtnActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    findSubTabText: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    findSubTabTextActive: { color: "#fff" },

    azLetterHeading: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", marginTop: 16, marginBottom: 6 },
    azRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8 },
    azRowLocked: { opacity: 0.55 },
    azRowTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    azRowTitleLocked: { color: c.textMuted },
    azRowCategoryRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
    azRowDot: { width: 7, height: 7, borderRadius: 3.5 },
    azRowCategoryText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },

    alphabetStrip: { width: 22, paddingTop: 8, alignItems: "center", gap: 2 },
    alphabetStripLetter: { fontSize: 10, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    alphabetStripLetterMuted: { color: c.borderBeige },

    categoryCardGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
    categoryCardWrap: { width: "50%", paddingHorizontal: 6, marginBottom: 12 },
    categoryCard: { borderRadius: 16, padding: 16, minHeight: 120, justifyContent: "space-between" },
    categoryCardEmoji: { fontSize: 26 },
    categoryCardTitle: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", marginTop: 10, lineHeight: 19 },
    categoryCardCount: { fontSize: 12, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_500Medium", marginTop: 4 },

    filterOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    filterSheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
    filterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    filterTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    filterLabel: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, marginTop: 8 },
    filterChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    filterChip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
    filterChipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    filterChipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    filterChipTextActive: { color: "#fff", fontWeight: "700" },
    filterActionsRow: { flexDirection: "row", gap: 10, marginTop: 20 },
    filterClearBtn: { flex: 1, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    filterClearText: { fontSize: 14, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    filterApplyBtn: { flex: 1, backgroundColor: c.accentGreen, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    filterApplyText: { fontSize: 14, color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },

    shareOverlay: { flex: 1, backgroundColor: "rgba(6,17,13,0.94)", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
    shareCloseBtn: { position: "absolute", top: 50, right: 20 },
    shareCard: { width: 280, backgroundColor: "#0B1F19", borderRadius: 20, borderWidth: 1.5, padding: 28, alignItems: "center" },
    shareBadge: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 14 },
    shareTitle: { fontSize: 17, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textAlign: "center" },
    shareSubtitle: { fontSize: 12, color: "#E0A441", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
    shareDate: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginTop: 8 },
    shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#E0A441", borderRadius: 24, paddingVertical: 12, paddingHorizontal: 24, marginTop: 24 },
    shareBtnText: { fontSize: 14, fontWeight: "700", color: "#0B3A2E", fontFamily: "Inter_700Bold" },
  });
}
