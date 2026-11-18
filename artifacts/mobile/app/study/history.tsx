import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { StudyState as StateView } from "@/components/study/StudyUI";
import { deleteStudy, listStudies, markStudyOpened, updateStudy, type SavedStudy, type StudyKind } from "@/lib/studyWorkspaceApi";
import { cached, useSyncStatus } from "@/lib/offline";
import { confirmAction, showAlert } from "@/lib/alerts";

// DEEP STUDY HISTORY (owner brief 2026-11-18 §5): every study the person saved — search, filter by kind and
// folder, rename, move to a folder, delete, and reopen exactly where they stopped. Personal and private.
// The list is kept on this phone, so it still opens offline (marked as the saved copy).
const KINDS: (StudyKind | "all")[] = ["all", "my_plan", "deep_study", "topic_study"];
const KIND_DEFAULT: Record<string, string> = { all: "All", my_plan: "My Plan", deep_study: "Deep Study", topic_study: "Topic study" };

export default function StudyHistory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const sync = useSyncStatus();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<StudyKind | "all">("all");
  const [folder, setFolder] = useState<string | null>(null);
  const [studies, setStudies] = useState<SavedStudy[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string; folder: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const f = { q: q.trim() || undefined, kind: kind === "all" ? undefined : kind, folder: folder ?? undefined };
      const r = await cached(`studies:${JSON.stringify(f)}`, () => listStudies(f));
      setStudies(r.studies); setFolders(r.folders ?? []); setOffline(!!r.offline);
    } catch (e: any) { setError(e?.message ?? t("study.historyFailed", { defaultValue: "Couldn't load your studies." })); }
  }, [q, kind, folder, t]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { const h = setTimeout(() => void load(), 300); return () => clearTimeout(h); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEdit() {
    if (!editing) return;
    const st = studies?.find((x) => x.id === editing.id);
    try {
      await updateStudy(editing.id, { baseVersion: st?.version, title: editing.title.trim() || st?.title, folder: editing.folder.trim() || null });
      setEditing(null); void load();
    } catch (e: any) {
      if (e?.status === 409) { setEditing(null); void load(); showAlert(t("study.changedElsewhere", { defaultValue: "This study changed on another device. The latest copy is shown — try again." })); }
      else showAlert(e?.message ?? "");
    }
  }
  function confirmDelete(st: SavedStudy) {
    const go = async () => { try { await deleteStudy(st.id); void load(); } catch (e: any) { showAlert(e?.message ?? ""); } };
    const msg = t("study.deleteConfirm", { defaultValue: "“{{title}}” will be deleted. This can't be undone.", title: st.title });
    confirmAction(t("study.deleteTitle", { defaultValue: "Delete this study?" }), msg, () => void go(), { confirmLabel: t("study.delete", { defaultValue: "Delete" }), cancelLabel: t("common.cancel", { defaultValue: "Cancel" }), destructive: true });
  }
  const when = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

  return (
    <>
      <Stack.Screen options={{ title: t("study.historyTitle", { defaultValue: "Deep Study History" }) }} />
      <FlatList
        style={s.root}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40, maxWidth: 820, width: "100%", alignSelf: "center" }}
        data={studies ?? []}
        keyExtractor={(x) => x.id}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <AppButton label={t("study.newStudy", { defaultValue: "Start a new study" })} icon="add" onPress={() => router.push("/study" as any)} />
            <TextInput value={q} onChangeText={setQ} style={s.search} placeholder={t("study.historySearch", { defaultValue: "Search my studies" })} placeholderTextColor={c.textMuted}
              accessibilityLabel={t("study.historySearch", { defaultValue: "Search my studies" })} />
            <ChipRow accessibilityLabel={t("study.kindLabel", { defaultValue: "Kind of study" })} single>
              {KINDS.map((k) => <FilterChip key={k} label={t(`study.kind.${k}`, { defaultValue: KIND_DEFAULT[k] })} selected={kind === k} selection="single" onPress={() => setKind(k)} />)}
            </ChipRow>
            {folders.length ? (
              <ChipRow accessibilityLabel={t("study.folderLabel", { defaultValue: "Folder" })} single>
                <FilterChip label={t("study.allFolders", { defaultValue: "All folders" })} selected={!folder} selection="single" onPress={() => setFolder(null)} />
                {folders.map((f) => <FilterChip key={f} label={f} icon="folder-outline" selected={folder === f} selection="single" onPress={() => setFolder(f)} />)}
              </ChipRow>
            ) : null}
            {offline ? <StateView offline /> : null}
            {sync.pending ? <Text style={s.muted}>{t("sync.waiting", { defaultValue: "{{count}} change(s) waiting to sync.", count: sync.pending })}</Text> : null}
            <StateView loading={!studies && !error} error={error} onRetry={load}
              empty={studies && !studies.length ? t("study.historyEmpty", { defaultValue: "No saved studies yet. Start one with a word or a question." }) : null} />
          </View>
        }
        renderItem={({ item }) => editing?.id === item.id ? (
          <View style={s.card}>
            <TextInput value={editing.title} onChangeText={(v) => setEditing({ ...editing, title: v })} style={s.search} accessibilityLabel={t("study.titleLabel", { defaultValue: "Study name" })} />
            <TextInput value={editing.folder} onChangeText={(v) => setEditing({ ...editing, folder: v })} style={s.search} placeholder={t("study.folderPlaceholder", { defaultValue: "Folder (optional)" })}
              placeholderTextColor={c.textMuted} accessibilityLabel={t("study.folderLabel", { defaultValue: "Folder" })} />
            <View style={s.row}>
              <AppButton label={t("common.save", { defaultValue: "Save" })} size="sm" onPress={saveEdit} />
              <AppButton label={t("common.cancel", { defaultValue: "Cancel" })} size="sm" variant="secondary" onPress={() => setEditing(null)} />
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.card} accessibilityRole="button" onPress={() => {
            const f = item.focus as { book?: string; chapter?: number; v?: number | null; ve?: number | null; t?: string | null };
            if (item.kind === "deep_study" && f.book && f.chapter) {
              void markStudyOpened(item.id);
              return router.push({ pathname: "/deep-study", params: { book: f.book, chapter: String(f.chapter), ...(f.v ? { v: String(f.v), ve: String(f.ve ?? f.v) } : {}), ...(f.t ? { t: f.t } : {}),
                tab: String(item.state?.position?.section ?? "original") } } as any);
            }
            router.push({ pathname: "/study", params: { id: item.id } } as any);
          }}
            accessibilityHint={t("study.continueHint", { defaultValue: "Opens the study where you stopped" })}>
            <View style={s.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.kind}>{t(`study.kind.${item.kind}`, { defaultValue: KIND_DEFAULT[item.kind] })}{item.folder ? ` · ${item.folder}` : ""}</Text>
                <Text style={s.title}>{item.title}</Text>
                <Text style={s.muted}>
                  {t("study.counts", { defaultValue: "{{findings}} kept · {{highlights}} study highlights", findings: item.state?.findings?.length ?? 0, highlights: item.state?.studyHighlights?.length ?? 0 })}
                  {" · "}{t("study.lastOpened", { defaultValue: "opened {{date}}", date: when(item.lastOpenedAt ?? item.updatedAt) })}
                </Text>
              </View>
              <IconButton icon="create-outline" size="sm" accessibilityLabel={t("study.rename", { defaultValue: "Rename or move" })} onPress={() => setEditing({ id: item.id, title: item.title, folder: item.folder ?? "" })} />
              <IconButton icon="trash-outline" size="sm" accessibilityLabel={t("study.delete", { defaultValue: "Delete" })} onPress={() => confirmDelete(item)} />
            </View>
          </TouchableOpacity>
        )}
      />
    </>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  search: { minHeight: 48, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.textDark, backgroundColor: c.card },
  card: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: c.borderBeige },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  kind: { color: c.accentGreen, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { color: c.textDark, fontSize: 17, fontWeight: "700" },
  muted: { color: c.textMuted, fontSize: 13 },
});
