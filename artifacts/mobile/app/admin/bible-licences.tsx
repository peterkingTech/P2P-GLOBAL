// BIBLE LICENCES — Admin Centre, SUPER ADMIN ONLY (owner 2026-11-19: "add the screen"). The API enforces the role
// (routes/bibleTranslationsAdmin: requireRole() = super admin) and the database refuses an incomplete approval.
//   • P2P's Bibles: every translation with its source and licence record (visible / hidden, what it permits).
//       AO Lab: record a decision here — approve (display + commercial use must be permitted), needs information,
//       reject — with the permissions for caching, offline, recorded audio and sharing. Approval makes it visible.
//       API.Bible and YouVersion: shown read-only — their licences come from the owner's plan / accepted agreements.
//   • Add from AO Lab: search AO Lab's catalogue (their licence statement shown), import as HIDDEN, then review.
//   • YouVersion: the automatic sync (server, every 6 hours) — every Bible licensed to your key shows; what was added,
//       skipped (same edition already in P2P / no copyright notice) and withdrawn; "Check now".
// Owner's copyright rule: nothing becomes visible without a recorded human decision; unknown = no.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, Linking } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, EmptyNote, FilterChip, SegmentedControl } from "@/components/ui";
import { apiRequest } from "@/lib/apiClient";
import { useAdminContentWidth } from "@/lib/adminLayout";

type Row = {
  translation_code: string; translation_name: string; language: string; provider: string | null; provider_translation_id: string | null; abbreviation: string | null;
  is_licensed_confirmed: boolean | null; licence_status: string | null; licence_name: string | null; licence_url: string | null; copyright_notice: string | null; attribution: string | null;
  licence_questions: string | null; license_notes: string | null; reviewed_at: string | null;
  permits_display: boolean | null; permits_commercial: boolean | null; permits_caching: boolean | null; permits_offline: boolean | null; permits_audio: boolean | null; permits_sharing: boolean | null;
};
type SyncReport = { at: string; ok: boolean; error?: string; licensed: number; inP2P: number; added: { code: string; name: string; language: string }[];
  duplicates: { id: string; abbr: string; language: string; sameAs: string }[]; noAttribution: { id: string; abbr: string; language: string }[]; withdrawn: { code: string; name: string }[] };
type CatalogueItem = { id: string; name: string; englishName: string; shortName: string; language: string; languageEnglishName?: string | null; licenseUrl: string | null; review: { statement: string; questions: string[] }; ours: { code: string; status: string | null } | null };
const call = <T,>(path: string, init: RequestInit = {}) => apiRequest<T>(`/admin/bible-translations${path}`, init, { fallbackError: "Something went wrong." });
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const SOURCE: Record<string, string> = { helloao: "AO Lab", youversion: "YouVersion", "api.bible": "API.Bible" };
const PERMS = [
  ["permits_display", "Display the text"], ["permits_commercial", "Commercial app (app stores)"], ["permits_caching", "Keep in server memory"],
  ["permits_offline", "Offline reading on phones"], ["permits_audio", "Play its recorded audio"], ["permits_sharing", "Copy / share verse text"],
] as const;

export default function BibleLicencesAdmin() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const width = useAdminContentWidth();
  const [tab, setTab] = useState<"ours" | "add" | "yv">("ours");
  const [yv, setYv] = useState<SyncReport | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<"all" | "visible" | "hidden" | "helloao" | "api.bible" | "youversion">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<CatalogueItem[] | null>(null);
  const [catLang, setCatLang] = useState("");
  const [catQ, setCatQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 7000); };

  const load = useCallback(() => call<{ translations: Row[] }>("").then((r) => setRows(r.translations), (e) => say((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  const provider = (r: Row) => r.provider ?? "api.bible";
  const shown = (rows ?? []).filter((r) => (filter === "all" || (filter === "visible" ? !!r.is_licensed_confirmed : filter === "hidden" ? !r.is_licensed_confirmed : provider(r) === filter))
    && (!q.trim() || `${r.translation_code} ${r.translation_name} ${r.language} ${r.abbreviation ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const counts = { visible: (rows ?? []).filter((r) => r.is_licensed_confirmed).length, hidden: (rows ?? []).filter((r) => !r.is_licensed_confirmed).length };

  const startReview = (r: Row) => {
    setOpen(open === r.translation_code ? null : r.translation_code);
    setDraft({ status: r.licence_status === "unreviewed" ? "approved" : r.licence_status ?? "approved", ...Object.fromEntries(PERMS.map(([k]) => [k, r[k] === true])),
      licence_name: r.licence_name ?? "", licence_url: r.licence_url ?? "", copyright_notice: r.copyright_notice ?? "", attribution: r.attribution ?? "", licence_questions: r.licence_questions ?? "" });
  };
  const save = async (r: Row) => {
    setBusy(true);
    try {
      const res = await call<{ status: string; visible: boolean }>(`/${encodeURIComponent(r.translation_code)}/licence`, json("PATCH", draft));
      say(res.visible ? `${r.translation_name} is approved and now visible to people.` : `Decision recorded (${res.status}) — ${r.translation_name} stays hidden.`);
      setOpen(null); await load();
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (tab === "yv" && yv === undefined) call<{ report: SyncReport | null }>("/youversion/sync").then((r) => setYv(r.report), (e) => { setYv(null); say((e as Error).message); }); }, [tab, yv]);
  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await call<{ report: SyncReport }>("/youversion/sync", json("POST", {}));
      setYv(r.report);
      say(!r.report.ok ? r.report.error ?? "The check didn't finish." : r.report.added.length ? `${r.report.added.length} new Bible${r.report.added.length === 1 ? "" : "s"} added — visible to people now.` : "Up to date — no new licences.");
      await load();
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const searchCatalogue = async () => {
    setBusy(true);
    try { const r = await call<{ translations: CatalogueItem[] }>(`/helloao/catalogue?language=${encodeURIComponent(catLang.trim())}&q=${encodeURIComponent(catQ.trim())}`); setCat(r.translations); }
    catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const importPicked = async () => {
    setBusy(true);
    try { const r = await call<{ imported: number }>("/helloao/import", json("POST", { ids: picked })); say(`${r.imported} imported as hidden — review each one under "P2P's Bibles".`); setPicked([]); await load(); setTab("ours"); setFilter("hidden"); }
    catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { maxWidth: width }]} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Bible licences" }} />
      <Text style={s.lead}>A Bible is shown in P2P only after its licence is recorded here. Unknown means no.</Text>
      {msg ? <Text style={s.msg} accessibilityLiveRegion="polite">{msg}</Text> : null}
      <SegmentedControl accessibilityLabel="Section" value={tab} onChange={(v) => setTab(v as "ours" | "add" | "yv")}
        options={[{ value: "ours", label: `P2P's Bibles${rows ? ` · ${rows.length}` : ""}` }, { value: "add", label: "Add from AO Lab" }, { value: "yv", label: "YouVersion" }]} />

      {tab === "yv" ? (
        <>
          <Text style={s.small}>Every Bible licensed to your YouVersion key shows in P2P automatically — the server checks every 6 hours. Add a licence on YouVersion, then tap "Check now" to see it straight away. A licence you remove hides that Bible at the next check. All are display only: no copying, offline, P2P Voice or AI.</Text>
          <AppButton label="Check now" icon="refresh" onPress={syncNow} loading={busy} />
          {yv === undefined ? <Text style={s.small}>Loading…</Text> : !yv ? <EmptyNote text="No check has run since the server started. Tap Check now." /> : (
            <>
              <View style={s.card}>
                <Text style={s.title}>{yv.ok ? `${yv.inP2P} of ${yv.licensed} licensed Bibles are in P2P` : "The last check didn't finish"}</Text>
                <Text style={s.meta}>Checked {new Date(yv.at).toLocaleString()}</Text>
                {yv.error ? <Text style={s.small}>{yv.error} Nothing was changed; the next check tries again.</Text> : null}
              </View>
              {([
                ["Added in this check", yv.added.map((a) => `${a.name} · ${a.language} · ${a.code}`)],
                ["Licence removed — hidden", yv.withdrawn.map((w) => `${w.name} · ${w.code}`)],
                ["Not added: no copyright notice in YouVersion's record (unknown = no)", yv.noAttribution.map((n) => `${n.abbr} · ${n.language}`)],
                ["Not added: P2P already has the same edition", yv.duplicates.map((d) => `${d.abbr} · ${d.language} = ${d.sameAs}`)],
              ] as const).filter(([, items]) => items.length).map(([label, items]) => (
                <View key={label} style={s.card}>
                  <Text style={s.label}>{label} · {items.length}</Text>
                  {items.slice(0, 400).map((t) => <Text key={t} style={s.small}>{t}</Text>)}
                </View>
              ))}
            </>
          )}
        </>
      ) : tab === "ours" ? (
        <>
          <TextInput value={q} onChangeText={setQ} placeholder="Find a translation, code or language" placeholderTextColor={c.textMuted} style={s.input} accessibilityLabel="Find a translation" />
          <ChipRow accessibilityLabel="Show" single>
            {([["all", "All"], ["visible", `Visible · ${counts.visible}`], ["hidden", `Hidden · ${counts.hidden}`], ["helloao", "AO Lab"], ["api.bible", "API.Bible"], ["youversion", "YouVersion"]] as const).map(([k, l]) =>
              <FilterChip key={k} label={l} selection="single" selected={filter === k} onPress={() => setFilter(k)} />)}
          </ChipRow>
          {!rows ? <Text style={s.small}>Loading…</Text> : !shown.length ? <EmptyNote text="No translations match." /> : shown.map((r) => {
            const p = provider(r);
            return (
              <View key={r.translation_code} style={s.card}>
                <View style={s.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title}>{r.translation_name}</Text>
                    <Text style={s.meta}>{r.translation_code} · {r.language} · {SOURCE[p] ?? p}</Text>
                  </View>
                  <Text style={[s.badge, r.is_licensed_confirmed ? s.badgeOn : s.badgeOff]}>{r.is_licensed_confirmed ? "Visible" : r.licence_status ? r.licence_status.replace("_", " ") : "Hidden"}</Text>
                </View>
                {p === "helloao" ? (
                  <Text style={s.small}>Permits: {PERMS.filter(([k]) => r[k] === true).map(([, l]) => l.toLowerCase()).join(", ") || "nothing recorded yet"}{r.reviewed_at ? ` · reviewed ${new Date(r.reviewed_at).toLocaleDateString()}` : ""}</Text>
                ) : (
                  <Text style={s.small} numberOfLines={3}>{p === "youversion" ? "Licensed to your YouVersion key — display only (no caching, offline, copying, P2P Voice or AI)." : "From your API.Bible plan."} {r.license_notes ?? ""}</Text>
                )}
                {p === "helloao" ? <AppButton size="sm" variant={open === r.translation_code ? "tertiary" : "secondary"} label={open === r.translation_code ? "Close" : "Review licence"} onPress={() => startReview(r)} /> : null}
                {open === r.translation_code ? (
                  <View style={s.form}>
                    {r.licence_url ? <AppButton size="sm" variant="tertiary" icon="open-outline" label="Open the licence" onPress={() => void Linking.openURL(r.licence_url!)} /> : null}
                    {r.licence_questions ? <Text style={s.small}>{r.licence_questions}</Text> : null}
                    <Text style={s.label}>Decision</Text>
                    <ChipRow accessibilityLabel="Decision" single>
                      {([["approved", "Approve"], ["needs_information", "Needs information"], ["rejected", "Reject"], ["unreviewed", "Not reviewed"]] as const).map(([k, l]) =>
                        <FilterChip key={k} label={l} selection="single" selected={draft.status === k} onPress={() => setDraft({ ...draft, status: k })} />)}
                    </ChipRow>
                    <Text style={s.label}>What the licence permits</Text>
                    {PERMS.map(([k, l]) => (
                      <View key={k} style={s.switchRow}>
                        <Text style={s.body}>{l}</Text>
                        <Switch value={!!draft[k]} onValueChange={(v) => setDraft({ ...draft, [k]: v })} accessibilityLabel={l} />
                      </View>
                    ))}
                    {(["licence_name", "licence_url", "copyright_notice", "attribution"] as const).map((k) => (
                      <TextInput key={k} value={draft[k]} onChangeText={(v) => setDraft({ ...draft, [k]: v })} placeholder={{ licence_name: "Licence name (e.g. Public domain, CC BY 4.0)", licence_url: "Licence URL", copyright_notice: "Copyright notice to show", attribution: "Attribution to show" }[k]}
                        placeholderTextColor={c.textMuted} style={s.input} multiline={k === "copyright_notice" || k === "attribution"} accessibilityLabel={k.replace("_", " ")} />
                    ))}
                    <Text style={s.small}>Approving needs "Display the text" and "Commercial app" switched on; your name and the date are recorded.</Text>
                    <AppButton label="Save decision" icon="checkmark" onPress={() => save(r)} loading={busy} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      ) : (
        <>
          <Text style={s.small}>Being in AO Lab's catalogue grants nothing. Import adds a translation HIDDEN; it becomes visible only when you approve its licence.</Text>
          <View style={s.searchRow}>
            <TextInput value={catLang} onChangeText={setCatLang} placeholder="Language (e.g. eng, yor)" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} autoCapitalize="none" accessibilityLabel="Language code" />
            <TextInput value={catQ} onChangeText={setCatQ} placeholder="Name" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} onSubmitEditing={searchCatalogue} accessibilityLabel="Translation name" />
          </View>
          <AppButton label="Search AO Lab" icon="search" onPress={searchCatalogue} loading={busy} />
          {cat && !cat.length ? <EmptyNote text="Nothing found in AO Lab's catalogue." /> : null}
          {(cat ?? []).map((t) => (
            <View key={t.id} style={s.card}>
              <View style={s.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{t.englishName}{t.name !== t.englishName ? ` · ${t.name}` : ""}</Text>
                  <Text style={s.meta}>{t.id} · {t.language}{t.languageEnglishName ? ` (${t.languageEnglishName})` : ""}</Text>
                </View>
                {t.ours ? <Text style={[s.badge, s.badgeOff]}>In P2P · {t.ours.status ?? "listed"}</Text>
                  : <FilterChip label={picked.includes(t.id) ? "Selected" : "Select"} selected={picked.includes(t.id)} onPress={() => setPicked((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id].slice(0, 50)))} />}
              </View>
              <Text style={s.small}>{t.review.statement}</Text>
              {t.licenseUrl ? <AppButton size="sm" variant="tertiary" icon="open-outline" label="Open its licence" onPress={() => void Linking.openURL(t.licenseUrl!)} /> : null}
            </View>
          ))}
          {picked.length ? <AppButton label={`Import ${picked.length} as hidden`} icon="download-outline" onPress={importPicked} loading={busy} /> : null}
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, width: "100%", alignSelf: "center", paddingBottom: 80 },
    lead: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    msg: { fontSize: 13.5, color: c.primaryGreen, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
    card: { padding: 12, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    body: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
    badge: { fontSize: 11.5, fontFamily: "Inter_700Bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden", textTransform: "capitalize" },
    badgeOn: { backgroundColor: "rgba(29,158,117,0.16)", color: c.primaryGreen },
    badgeOff: { backgroundColor: c.cardBeige, color: c.textMid },
    form: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: c.cardBeige },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
    searchRow: { flexDirection: "row", gap: 8 },
  });
}
