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
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { useAuth } from "@/contexts/AuthContext";
import { useData, Plan } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { getApiUrl } from "@/lib/apiUrl";

type PlansTab = "my" | "find" | "saved" | "completed";

type ActivePlan = Plan & { progressPercent: number; lastActivityAt: string | null };
type SavedPlan = Plan & { savedAt: string | null };
type CompletedPlan = Plan & { completedAt: string | null };

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

const CATEGORIES: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; tagMatch?: string }[] = [
  { key: "life_stage", label: "Life Stage", icon: "hourglass-outline", tagMatch: "life stage" },
  { key: "freedom_recovery", label: "Freedom and Recovery", icon: "shield-checkmark-outline", tagMatch: "freedom" },
  { key: "relationships", label: "Relationships", icon: "heart-outline", tagMatch: "relationships" },
  { key: "kingdom_influence", label: "Kingdom Influence", icon: "globe-outline", tagMatch: "kingdom influence" },
  { key: "seasonal", label: "Seasonal", icon: "calendar-outline", tagMatch: "seasonal" },
  { key: "featured", label: "Featured", icon: "star-outline" },
];

const DIFFICULTY_OPTIONS = ["beginner", "intermediate", "advanced"];
const DURATION_OPTIONS = [
  { key: "short", label: "Short (≤3 weeks)", test: (w: number | null) => !!w && w <= 3 },
  { key: "medium", label: "Medium (4–8 weeks)", test: (w: number | null) => !!w && w >= 4 && w <= 8 },
  { key: "long", label: "Long (9+ weeks)", test: (w: number | null) => !!w && w >= 9 },
];

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
        <Text style={styles.planCardTitle} numberOfLines={2}>{plan.title}</Text>
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

// ── Filter modal (Find Plans → All Plans) ───────────────────────────────────
function FilterModal({
  visible, onClose, difficulties, onToggleDifficulty, duration, onSetDuration, onClear,
}: {
  visible: boolean; onClose: () => void;
  difficulties: string[]; onToggleDifficulty: (d: string) => void;
  duration: string | null; onSetDuration: (d: string | null) => void;
  onClear: () => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.filterOverlay}>
        <View style={styles.filterSheet}>
          <View style={styles.filterHeader}>
            <Text style={styles.filterTitle}>Filter Plans</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.textDark} /></TouchableOpacity>
          </View>
          <Text style={styles.filterLabel}>Difficulty</Text>
          <View style={styles.filterChipRow}>
            {DIFFICULTY_OPTIONS.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.filterChip, difficulties.includes(d) && styles.filterChipActive]}
                onPress={() => onToggleDifficulty(d)}
              >
                <Text style={[styles.filterChipText, difficulties.includes(d) && styles.filterChipTextActive]}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.filterLabel}>Duration</Text>
          <View style={styles.filterChipRow}>
            {DURATION_OPTIONS.map((d) => (
              <TouchableOpacity
                key={d.key}
                style={[styles.filterChip, duration === d.key && styles.filterChipActive]}
                onPress={() => onSetDuration(duration === d.key ? null : d.key)}
              >
                <Text style={[styles.filterChipText, duration === d.key && styles.filterChipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.filterActionsRow}>
            <TouchableOpacity style={styles.filterClearBtn} onPress={onClear}>
              <Text style={styles.filterClearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterApplyBtn} onPress={onClose}>
              <Text style={styles.filterApplyText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function PlansHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { profile } = useAuth();
  const { plans: allPlans, getPlanProgress } = useData();
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
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDifficulties, setFilterDifficulties] = useState<string[]>([]);
  const [filterDuration, setFilterDuration] = useState<string | null>(null);

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

  useEffect(() => { loadMyPlans(); }, [loadMyPlans]);
  useEffect(() => { loadSaved(); }, [loadSaved]);
  useEffect(() => { loadCompleted(); }, [loadCompleted]);

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

  const now = Date.now();
  const recentActive = activePlans.filter((p) => p.lastActivityAt && now - new Date(p.lastActivityAt).getTime() < FOURTEEN_DAYS_MS);
  const staleEnrolled = activePlans.filter((p) => !p.lastActivityAt || now - new Date(p.lastActivityAt).getTime() >= FOURTEEN_DAYS_MS);

  const searchLower = search.trim().toLowerCase();
  const searchResults = searchLower
    ? allPlans.filter((p) =>
        p.title.toLowerCase().includes(searchLower) ||
        (p.description ?? "").toLowerCase().includes(searchLower) ||
        (p.teachingCreditName ?? "").toLowerCase().includes(searchLower)
      )
    : [];

  const recommended = allPlans.filter((p) => p.isFeatured).slice(0, 6);

  const categoryPlans = activeCategory
    ? allPlans.filter((p) => {
        const cat = CATEGORIES.find((c) => c.key === activeCategory);
        if (!cat) return false;
        if (cat.key === "featured") return p.isFeatured;
        return p.tags.some((t) => t.toLowerCase().includes(cat.tagMatch ?? "__none__"));
      })
    : [];

  const filteredAllPlans = allPlans.filter((p) => {
    if (filterDifficulties.length && !filterDifficulties.includes(p.difficultyLevel)) return false;
    if (filterDuration) {
      const opt = DURATION_OPTIONS.find((d) => d.key === filterDuration);
      if (opt && !opt.test(p.estimatedWeeks)) return false;
    }
    return true;
  });

  const hasActiveFilters = filterDifficulties.length > 0 || !!filterDuration;

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
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search plans, teachers, topics..."
              placeholderTextColor={colors.textMuted}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {searchLower ? (
            searchResults.length === 0 ? (
              <EmptyState colors={colors} icon="search-outline" text="No plans match your search." />
            ) : (
              searchResults.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  colors={colors}
                  isSaved={savedIds.has(p.id)}
                  onToggleSave={() => toggleSave(p.id)}
                  primaryLabel="Enroll"
                  onPrimary={() => router.push(`/plan/${p.id}` as any)}
                  onPress={() => router.push(`/plan/${p.id}` as any)}
                />
              ))
            )
          ) : activeCategory ? (
            <>
              <TouchableOpacity style={styles.backToCategoriesRow} onPress={() => setActiveCategory(null)}>
                <Ionicons name="chevron-back" size={16} color={colors.accentGreen} />
                <Text style={styles.backToCategoriesText}>Categories</Text>
              </TouchableOpacity>
              <Text style={styles.sectionHeading}>{CATEGORIES.find((c) => c.key === activeCategory)?.label}</Text>
              {categoryPlans.length === 0 ? (
                <EmptyState colors={colors} icon="albums-outline" text="No plans in this category yet." />
              ) : (
                categoryPlans.map((p) => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    colors={colors}
                    isSaved={savedIds.has(p.id)}
                    onToggleSave={() => toggleSave(p.id)}
                    primaryLabel="Enroll"
                    onPrimary={() => router.push(`/plan/${p.id}` as any)}
                    onPress={() => router.push(`/plan/${p.id}` as any)}
                  />
                ))
              )}
            </>
          ) : (
            <>
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
                          onPrimary={() => router.push(`/plan/${p.id}` as any)}
                          onPress={() => router.push(`/plan/${p.id}` as any)}
                        />
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}

              <Text style={styles.sectionHeading}>Browse by Category</Text>
              <View style={styles.categoryGrid}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity key={c.key} style={styles.categoryRow} onPress={() => setActiveCategory(c.key)}>
                    <View style={styles.categoryIconWrap}>
                      <Ionicons name={c.icon} size={16} color={colors.accentGreen} />
                    </View>
                    <Text style={styles.categoryLabel}>{c.label}</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.allPlansHeaderRow}>
                <Text style={styles.sectionHeading}>All Plans</Text>
                <TouchableOpacity style={styles.filterBtn} onPress={() => setFilterOpen(true)}>
                  <Ionicons name="options-outline" size={14} color={hasActiveFilters ? "#fff" : colors.accentGreen} />
                  <Text style={[styles.filterBtnText, hasActiveFilters && { color: "#fff" }]}>Filter</Text>
                </TouchableOpacity>
              </View>
              {filteredAllPlans.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  colors={colors}
                  isSaved={savedIds.has(p.id)}
                  onToggleSave={() => toggleSave(p.id)}
                  primaryLabel="Enroll"
                  onPrimary={() => router.push(`/plan/${p.id}` as any)}
                  onPress={() => router.push(`/plan/${p.id}` as any)}
                />
              ))}
            </>
          )}
        </ScrollView>
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

      <FilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        difficulties={filterDifficulties}
        onToggleDifficulty={(d) => setFilterDifficulties((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])}
        duration={filterDuration}
        onSetDuration={setFilterDuration}
        onClear={() => { setFilterDifficulties([]); setFilterDuration(null); }}
      />

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

    categoryGrid: { gap: 8, marginBottom: 8 },
    categoryRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 12 },
    categoryIconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
    categoryLabel: { flex: 1, fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },

    backToCategoriesRow: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: 8 },
    backToCategoriesText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },

    allPlansHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    filterBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.card, borderWidth: 1, borderColor: c.accentGreen, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
    filterBtnText: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },

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
