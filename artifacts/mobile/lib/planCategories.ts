// Canonical reference for the 10 plan-category collections (p2p_curriculums
// rows with type='plan_category', see migrations/054_plan_categories.sql).
// The database is still the source of truth for id/planCount/description —
// fetch those live via GET /plans/categories. This constant exists so the
// label/icon/color/order for each category slug is defined in exactly one
// place instead of being duplicated across screens.

export type PlanCategoryMeta = {
  key: string;
  label: string;
  color: string;
  icon: string;
  order: number;
};

export const PLAN_CATEGORIES: PlanCategoryMeta[] = [
  { key: "faith_kingdom", label: "Faith & Kingdom Living", color: "#1D4E2B", icon: "👑", order: 1 },
  { key: "ministry_leadership", label: "Ministry & Leadership", color: "#2C3E6B", icon: "🧭", order: 2 },
  { key: "spiritual_growth", label: "Spiritual Growth", color: "#1D9E75", icon: "🌱", order: 3 },
  { key: "family_relationships", label: "Family & Relationships", color: "#8B4513", icon: "❤️", order: 4 },
  { key: "identity_salvation", label: "Identity & Salvation", color: "#4B0082", icon: "✝️", order: 5 },
  { key: "marketplace_purpose", label: "Marketplace & Purpose", color: "#B8860B", icon: "💼", order: 6 },
  { key: "prayer", label: "Prayer", color: "#1A237E", icon: "🙏", order: 7 },
  { key: "holy_spirit", label: "Holy Spirit", color: "#4A90D9", icon: "🕊️", order: 8 },
  { key: "healing_freedom", label: "Healing & Freedom", color: "#C0392B", icon: "🩹", order: 9 },
  { key: "church_community", label: "Church & Community", color: "#2E7D32", icon: "⛪", order: 10 },
];

export function getPlanCategoryMeta(slug: string | null | undefined): PlanCategoryMeta | undefined {
  return PLAN_CATEGORIES.find((c) => c.key === slug);
}