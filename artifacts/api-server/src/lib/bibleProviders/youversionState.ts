// YouVersion auto-sync state the reader needs (kept apart from the sync so the reader doesn't load the logger/db
// client through it). Written by youversionSync.ts.
import type { SyncReport } from "./youversionSync";
let licensedNow: Set<string> | null = null;
const languageNames = new Map<string, string>();
let lastReport: SyncReport | null = null;
let onChange: () => void = () => {};
/** Until the first successful sync, trust the rows (YouVersion itself refuses a Bible the key lost). */
export const yvLicensedNow = (id: string | null | undefined) => !licensedNow || licensedNow.has(String(id ?? ""));
export const yvLanguageName = (code: string) => languageNames.get(code) ?? null;
export const hasYvLanguageName = (code: string) => languageNames.has(code);
export const setYvLanguageName = (code: string, name: string) => { languageNames.set(code, name); };
export const lastYouVersionSync = () => lastReport;
export const recordYouVersionSync = (report: SyncReport, licensed?: Set<string>) => { lastReport = report; if (licensed) { licensedNow = licensed; onChange(); } };
export const currentLicensedCount = () => licensedNow?.size ?? 0;
/** The reader registers its translation-cache clear here (no import cycle). */
export const onYouVersionChange = (fn: () => void) => { onChange = fn; };
export function setYouVersionStateForTests(ids: string[] | null, names: Record<string, string> = {}) {
  licensedNow = ids ? new Set(ids) : null; languageNames.clear(); for (const [k, v] of Object.entries(names)) languageNames.set(k, v);
}
