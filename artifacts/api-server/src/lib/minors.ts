import { supabaseServiceRole as db } from "./supabase";

// Child/teen safeguards (rule 5, discovery): children — anyone with the
// family role 'child' in an active family membership — never appear in
// people search or suggestions. The database applies the same rule to
// p2p_discover_peers (migration 198); this is the API side for the search
// routes. Reads p2p_family_members directly, so it works with or without 198.
// Fails CLOSED: if the lookup fails, every id is treated as a child (hidden).
export async function childUserIds(ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Set();
  const { data, error } = await db.from("p2p_family_members").select("user_id")
    .in("user_id", unique).eq("status", "active").eq("role", "child");
  if (error) return new Set(unique);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

export async function withoutChildren<T>(rows: T[], idOf: (row: T) => string): Promise<T[]> {
  const children = await childUserIds(rows.map(idOf));
  return children.size ? rows.filter((r) => !children.has(idOf(r))) : rows;
}

// A refusal raised by the migration 198 database safeguards
// ("P2P_MINOR_SAFEGUARD: …", SQLSTATE 42501) — routes answer 403 with the
// plain-language part instead of a generic 500.
export function safeguardRefusal(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null;
  if (!e?.message || !e.message.includes("P2P_MINOR_SAFEGUARD")) return null;
  const text = e.message.replace(/^.*P2P_MINOR_SAFEGUARD:\s*/, "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) + "." : "Not available for this account.";
}
