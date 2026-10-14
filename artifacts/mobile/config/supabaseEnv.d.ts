export declare const PRODUCTION_REF: string;
export declare const PRODUCTION_API_HOSTS: string[];

export interface BackendEnv {
  EXPO_PUBLIC_P2P_ENV?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  EXPO_PUBLIC_API_URL?: string;
  [k: string]: string | undefined;
}

export interface BackendConfig {
  target: "production" | "staging";
  ref: string;
  url: string;
  anonKey: string | null;
  apiUrl: string | null;
}

export declare function decodeJwtPayload(token: string): Record<string, unknown> | null;
export declare function refFromUrl(url: string): string | null;
export declare function checkAnonKey(key: string, ref: string): string | null;
export declare function resolveSupabaseConfig(
  env: BackendEnv,
  production: { url: string | null; anonKey: string | null } | null,
): { ok: true; config: BackendConfig } | { ok: false; errors: string[] };
export declare function validateBuildProfile(profile: string | null, env: BackendEnv): string[];
