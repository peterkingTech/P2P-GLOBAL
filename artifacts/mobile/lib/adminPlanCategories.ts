// Typed client for the Plan Category Management admin endpoints
// (artifacts/api-server/src/routes/admin.ts). Same Bearer-token pattern as
// app/admin/translations.tsx's getAuthToken()/fetch — the mobile client
// otherwise talks to Supabase directly for curriculum CRUD, but these
// category-management actions carry business logic (slug generation, lock
// chain recalculation, safety checks) that only the server should own.

import { apiRequest } from "@/lib/apiClient";

export type AdminPlanCategory = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  colorTheme: string;
  icon: string | null;
  displayOrder: number | null;
  planCount: number;
  status: string;
  isVisible: boolean;
};

export type AdminPlan = {
  id: string;
  title: string;
  description: string | null;
  subtitle: string | null;
  status: string;
  parentCategoryId: string | null;
  topicNumber: number | null;
  colorTheme: string;
  tags: string[];
  isLocked: boolean;
  manuallyUnlocked: boolean;
  isVisible: boolean;
  isFeaturedInCategory: boolean;
  adminNotes: string | null;
  icon: string | null;
  createdAt: string;
};

export type CategoryStats = {
  usersEnrolled: number;
  lessonsCompleted: number;
  mostReachedTopic: { title: string; topicNumber: number | null } | null;
  avgCompletionWeeks: number | null;
};

const request = <T = unknown,>(path: string, init?: RequestInit) => apiRequest<T>(path, init, {
  base: "/admin",
  makeError: (message, status, b) => new Error(typeof b.error === "string" ? message : `Request failed (${status})`),
});

export async function listPlanCategories(): Promise<AdminPlanCategory[]> {
  return request<AdminPlanCategory[]>("/plan-categories");
}

export async function createPlanCategory(input: { title: string; description?: string; color_theme?: string; icon?: string }): Promise<AdminPlanCategory> {
  return request<AdminPlanCategory>("/plan-categories", { method: "POST", body: JSON.stringify(input) });
}

export async function updatePlanCategory(categoryId: string, input: Partial<{ title: string; description: string; color_theme: string; icon: string; display_order: number; status: string }>): Promise<AdminPlanCategory> {
  return request<AdminPlanCategory>(`/plan-categories/${categoryId}`, { method: "PUT", body: JSON.stringify(input) });
}

export async function deletePlanCategory(categoryId: string): Promise<{ deleted: true }> {
  return request(`/plan-categories/${categoryId}`, { method: "DELETE" });
}

export async function reorderPlanCategories(items: { id: string; display_order: number }[]): Promise<{ updated: number }> {
  return request("/plan-categories/reorder", { method: "PUT", body: JSON.stringify(items) });
}

export async function getPlanCategoryStats(categoryId: string): Promise<CategoryStats> {
  return request<CategoryStats>(`/plan-categories/${categoryId}/stats`);
}

export async function listUncategorizedPlans(): Promise<AdminPlan[]> {
  return request<AdminPlan[]>("/plans/uncategorized");
}

export async function movePlanToCategory(planId: string, categoryId: string): Promise<{ id: string; parentCategoryId: string; topicNumber: number }> {
  return request(`/plans/${planId}/move-category`, { method: "PUT", body: JSON.stringify({ category_id: categoryId }) });
}

export async function reorderPlan(planId: string, newTopicNumber: number): Promise<{ id: string; newTopicNumber: number }> {
  return request(`/plans/${planId}/reorder`, { method: "PUT", body: JSON.stringify({ new_topic_number: newTopicNumber }) });
}

export async function togglePlanLock(planId: string, isLocked: boolean): Promise<AdminPlan> {
  return request<AdminPlan>(`/plans/${planId}/toggle-lock`, { method: "PUT", body: JSON.stringify({ is_locked: isLocked }) });
}

export async function duplicatePlan(planId: string): Promise<{ id: string; title: string }> {
  return request(`/plans/${planId}/duplicate`, { method: "POST" });
}