import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// All /admin/* routes are gated by requireAdmin() (see api-server's
// middleware/adminAuth.ts), which expects a Supabase JWT. Plain fetch()
// calls to admin endpoints silently 401 without this.
export async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
}