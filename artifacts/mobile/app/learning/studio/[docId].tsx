import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, AppState, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import type { AppColors } from "@/constants/themes";
import { ConfirmDialog } from "@/components/studio/StudioUI";
import DrawingSurface, { type SurfaceTool } from "@/components/handwriting/DrawingSurface";
import DrawingView from "@/components/handwriting/DrawingView";
import {
  COLORS, WIDTHS, TOOL_LABEL, BACKGROUND_LABEL, LIMITS, emptyDoc, emptyPage, docProblem, isEmpty, pickNewer,
  saveLocalDraft, loadLocalDraft, clearLocalDraft, emitStudioSaved, type DrawingDoc, type Background, type Stroke,
} from "@/lib/handwriting";
import { createDrawing, saveDrawing, getDrawing } from "@/lib/learningAttachmentsApi";
import { AppButton } from "@/components/ui";

// Handwriting Studio — full-screen drawing for Comprehensive Check answers.
// Opens from an answer box ("Add drawing"); typing stays available there and
// a drawing is never required. Drafts are private to the writer: kept on this
// device every few seconds and when the app goes to the background, and on
// the server (owner-only) when the Studio closes and every 30 seconds. Sent
// drawings open read-only (?view=1) for the writer and their reviewers.

type Params = { docId: string; k?: string; view?: string };
const LOCAL_EVERY_MS = 3000, SERVER_EVERY_MS = 30000, HISTORY = 50;

export default function HandwritingStudio() {
  const { docId, k, view } = useLocalSearchParams<Params>();
  const readOnly = view === "1";
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const docKey = docId && docId !== "new" ? docId : `new:${k ?? "x"}`;

  const [doc, setDoc] = useState<DrawingDoc>(emptyDoc());
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState<SurfaceTool>("pen");
  const [color, setColor] = useState(COLORS[0].hex);
  const [width, setWidth] = useState(WIDTHS[1].value);
  const [zoom, setZoom] = useState(1);
  const [caption, setCaption] = useState("");
  const [attachmentId, setAttachmentId] = useState<string | null>(docId && docId !== "new" ? docId : null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<null | "clear" | "deletePage">(null);
  const undoStack = useRef<DrawingDoc[]>([]);
  const redoStack = useRef<DrawingDoc[]>([]);
  const [, bump] = useState(0);
  const dirtyLocal = useRef(false);
  const dirtyServer = useRef(false);
  const latest = useRef({ doc, caption, attachmentId });
  latest.current = { doc, caption, attachmentId };

  // ── Load: server copy and this device's copy — the newer wins ───────────
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const server = attachmentId ? await getDrawing(attachmentId) : null;
        if (readOnly) {
          if (live && server) { setDoc(server.doc); setCaption(server.attachment.caption ?? ""); }
          return;
        }
        const local = userId ? await loadLocalDraft(userId, docKey) : null;
        const pick = pickNewer(local, server ? { doc: server.doc, updatedAt: server.attachment.updatedAt } : null);
        if (!live) return;
        if (pick === "local" && local) {
          setDoc(local.doc); setCaption(local.caption);
          if (!isEmpty(local.doc)) { setNote("Restored your unsaved drawing."); dirtyServer.current = true; }
        } else if (server) { setDoc(server.doc); setCaption(server.attachment.caption ?? ""); }
      } catch (e: any) {
        if (live) setError(e?.message ?? "That drawing couldn't be opened.");
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Saving ─────────────────────────────────────────────────────────────
  const saveLocal = useCallback(async () => {
    if (readOnly || !userId || !dirtyLocal.current) return;
    const { doc: d, caption: cap, attachmentId: id } = latest.current;
    if (await saveLocalDraft(userId, docKey, { doc: d, caption: cap, attachmentId: id, savedAt: Date.now() })) dirtyLocal.current = false;
  }, [readOnly, userId, docKey]);

  const saveServer = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    const { doc: d, caption: cap, attachmentId: id } = latest.current;
    if (!id && isEmpty(d)) return true; // nothing drawn yet: nothing to keep
    const problem = docProblem(d);
    if (problem) { setError(problem); return false; }
    setSaving(true);
    try {
      const a = id ? await saveDrawing(id, d, cap.trim() || null) : await createDrawing(d, cap.trim() || null);
      if (!id) { setAttachmentId(a.id); latest.current.attachmentId = a.id; }
      dirtyServer.current = false;
      setError(null);
      if (k) emitStudioSaved(k, { id: a.id, pageCount: a.pageCount, caption: a.caption });
      return true;
    } catch (e: any) {
      setError(`${e?.message ?? "Couldn't save to your account."} Your drawing is kept on this device.`);
      return false;
    } finally { setSaving(false); }
  }, [readOnly, k]);

  useEffect(() => {
    if (readOnly) return;
    const a = setInterval(() => { void saveLocal(); }, LOCAL_EVERY_MS);
    const b = setInterval(() => { if (dirtyServer.current) void saveServer(); }, SERVER_EVERY_MS);
    const sub = AppState.addEventListener("change", (st) => { if (st !== "active") { void saveLocal(); if (dirtyServer.current) void saveServer(); } });
    return () => { clearInterval(a); clearInterval(b); sub.remove(); };
  }, [readOnly, saveLocal, saveServer]);

  // Leaving never loses work: save on this device, then to the account.
  useEffect(() => {
    if (readOnly) return;
    return navigation.addListener("beforeRemove" as any, (e: any) => {
      if (!dirtyLocal.current && !dirtyServer.current) return;
      e.preventDefault();
      (async () => {
        dirtyLocal.current = true;
        await saveLocal();
        const okServer = !dirtyServer.current || (await saveServer());
        if (okServer && userId) await clearLocalDraft(userId, docKey);
        dirtyLocal.current = false; dirtyServer.current = false;
        navigation.dispatch(e.data.action);
      })();
    });
  }, [navigation, readOnly, saveLocal, saveServer, userId, docKey]);

  // ── Editing ────────────────────────────────────────────────────────────
  const change = (next: DrawingDoc) => {
    undoStack.current.push(doc);
    if (undoStack.current.length > HISTORY) undoStack.current.shift();
    redoStack.current = [];
    dirtyLocal.current = true; dirtyServer.current = true;
    setDoc(next);
  };
  const page = doc.pages[Math.min(pageIndex, doc.pages.length - 1)];
  const withPage = (fn: (p: typeof page) => typeof page) => ({ ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? fn(p) : p)) });
  const addStroke = (st: Stroke) => {
    if (page.strokes.length >= LIMITS.strokesPerPage) { setError("This page is full. Add a new page."); return; }
    change(withPage((p) => ({ ...p, strokes: [...p.strokes, st] })));
  };
  const erase = (idx: number[]) => change(withPage((p) => ({ ...p, strokes: p.strokes.filter((_, i) => !idx.includes(i)) })));
  const undo = () => { const prev = undoStack.current.pop(); if (!prev) return; redoStack.current.push(doc); dirtyLocal.current = true; dirtyServer.current = true; setDoc(prev); bump((n) => n + 1); };
  const redo = () => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push(doc); dirtyLocal.current = true; dirtyServer.current = true; setDoc(next); bump((n) => n + 1); };
  const addPage = () => {
    if (doc.pages.length >= LIMITS.pages) { setError(`A drawing can have up to ${LIMITS.pages} pages.`); return; }
    change({ ...doc, pages: [...doc.pages.slice(0, pageIndex + 1), emptyPage(page.background), ...doc.pages.slice(pageIndex + 1)] });
    setPageIndex(pageIndex + 1);
  };
  const deletePage = () => {
    if (doc.pages.length <= 1) { change(withPage((p) => ({ ...p, strokes: [] }))); return; }
    change({ ...doc, pages: doc.pages.filter((_, i) => i !== pageIndex) });
    setPageIndex(Math.max(0, pageIndex - 1));
  };
  const cycleBackground = () => {
    const order: Background[] = ["lined", "grid", "blank"];
    change(withPage((p) => ({ ...p, background: order[(order.indexOf(p.background) + 1) % order.length] })));
  };

  const done = async () => {
    dirtyLocal.current = true;
    await saveLocal();
    const okServer = await saveServer();
    if (!okServer) return; // stay; the error says the drawing is kept on this device
    if (userId) await clearLocalDraft(userId, docKey);
    dirtyLocal.current = false; dirtyServer.current = false;
    if (router.canGoBack()) router.back(); else router.replace("/learning" as any);
  };

  const canvasBase = Math.min(winW - 24, 900);
  const canvasW = Math.round(canvasBase * zoom);
  const pageLabel = `Page ${pageIndex + 1} of ${doc.pages.length}`;

  if (loading) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: readOnly ? "Drawing" : "Handwriting Studio" }} /><ActivityIndicator color={c.accentGreen} /></View>;

  if (readOnly) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={[s.viewContent, { paddingBottom: insets.bottom + 24 }]}>
        <Stack.Screen options={{ title: "Drawing" }} />
        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
        {caption ? <Text style={s.caption}>{caption}</Text> : null}
        {doc.pages.map((p, i) => (
          <View key={i} style={s.viewPage}>
            <Text style={s.meta}>Page {i + 1} of {doc.pages.length}</Text>
            <DrawingView page={p} width={canvasBase} label={`Drawing, page ${i + 1} of ${doc.pages.length}${caption ? `. ${caption}` : ""}`} />
          </View>
        ))}
      </ScrollView>
    );
  }

  const toolBtn = (id: SurfaceTool, icon: React.ComponentProps<typeof Ionicons>["name"], label: string) => (
    <TouchableOpacity key={id} style={[s.toolBtn, tool === id && s.toolOn]} onPress={() => setTool(id)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: tool === id }}>
      <Ionicons name={icon} size={20} color={tool === id ? "#fff" : c.textDark} />
      <Text style={[s.toolText, tool === id && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
  const iconBtn = (icon: React.ComponentProps<typeof Ionicons>["name"], label: string, onPress: () => void, disabled?: boolean) => (
    <TouchableOpacity hitSlop={10} key={label} style={[s.iconBtn, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={c.textDark} />
    </TouchableOpacity>
  );

  return (
    <View style={[s.screen, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ title: "Handwriting Studio" }} />
      <View style={s.topRow}>
        {iconBtn("arrow-undo", "Undo", undo, !undoStack.current.length)}
        {iconBtn("arrow-redo", "Redo", redo, !redoStack.current.length)}
        {iconBtn("remove-circle-outline", "Zoom out", () => setZoom((z) => Math.max(1, z - 0.5)), zoom <= 1)}
        {iconBtn("add-circle-outline", "Zoom in", () => setZoom((z) => Math.min(4, z + 0.5)), zoom >= 4)}
        <View style={{ flex: 1 }} />
        <Text style={s.meta} accessibilityLiveRegion="polite">{saving ? "Saving…" : dirtyServer.current ? "Saved on this device" : attachmentId ? "Saved" : ""}</Text>
        <AppButton label="Done" onPress={done} disabled={saving} loading={saving} accessibilityLabel="Save and close" style={{ minWidth: 72, marginLeft: 6 }} />
      </View>
      {note ? <Text style={s.note} accessibilityLiveRegion="polite">{note}</Text> : null}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.canvasWrap} scrollEnabled={tool === "hand" || zoom === 1} horizontal={false}>
        <ScrollView horizontal scrollEnabled={tool === "hand"} contentContainerStyle={{ paddingHorizontal: 12 }}>
          <DrawingSurface page={page} width={canvasW} tool={tool} color={color} strokeWidthValue={width}
            onStroke={addStroke} onErase={erase} accessibilityLabel={`Drawing area, ${pageLabel}`} />
        </ScrollView>
      </ScrollView>

      <View style={s.bar}>
        <View style={s.pageRow}>
          {iconBtn("chevron-back", "Previous page", () => setPageIndex((i) => Math.max(0, i - 1)), pageIndex === 0)}
          <Text style={s.pageText}>{pageLabel}</Text>
          {iconBtn("chevron-forward", "Next page", () => setPageIndex((i) => Math.min(doc.pages.length - 1, i + 1)), pageIndex >= doc.pages.length - 1)}
          {iconBtn("document-outline", "Add a page after this one", addPage)}
          <AppButton label={`${BACKGROUND_LABEL[page.background]}`} onPress={cycleBackground} variant="secondary" accessibilityLabel={`Page background: ${BACKGROUND_LABEL[page.background]}. Tap to change`} style={{ minWidth: 44 }} />
          {iconBtn("trash-outline", doc.pages.length > 1 ? "Delete this page" : "Clear this page", () => setConfirm(doc.pages.length > 1 ? "deletePage" : "clear"))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolRow}>
          {toolBtn("pen", "create-outline", TOOL_LABEL.pen)}
          {toolBtn("pencil", "pencil-outline", TOOL_LABEL.pencil)}
          {toolBtn("highlighter", "color-fill-outline", TOOL_LABEL.highlighter)}
          {toolBtn("eraser", "backspace-outline", "Eraser")}
          {toolBtn("hand", "hand-left-outline", "Move")}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolRow}>
          {COLORS.map((col) => (
            <TouchableOpacity key={col.hex} onPress={() => { setColor(col.hex); if (tool === "eraser" || tool === "hand") setTool("pen"); }} style={[s.swatchBtn, color === col.hex && s.swatchOn]}
              accessibilityRole="button" accessibilityLabel={`Colour ${col.name}`} accessibilityState={{ selected: color === col.hex }}>
              <View style={[s.swatch, { backgroundColor: col.hex }]} />
            </TouchableOpacity>
          ))}
          {WIDTHS.map((w) => (
            <TouchableOpacity key={w.value} onPress={() => setWidth(w.value)} style={[s.smallBtn, width === w.value && s.toolOn]}
              accessibilityRole="button" accessibilityLabel={`Line ${w.name}`} accessibilityState={{ selected: width === w.value }}>
              <Text style={[s.smallText, width === w.value && { color: "#fff" }]}>{w.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TextInput style={s.captionInput} value={caption} onChangeText={(v) => { setCaption(v.slice(0, LIMITS.caption)); dirtyLocal.current = true; dirtyServer.current = true; }}
          placeholder="Describe your drawing (optional — read aloud to reviewers who use a screen reader)" placeholderTextColor={c.textMuted}
          accessibilityLabel="Describe your drawing (optional)" maxLength={LIMITS.caption} />
      </View>

      <ConfirmDialog visible={confirm !== null} title={confirm === "deletePage" ? "Delete this page?" : "Clear this page?"}
        message={confirm === "deletePage" ? `${pageLabel} and everything on it will be removed. You can undo this.` : "Everything on this page will be removed. You can undo this."}
        confirmLabel={confirm === "deletePage" ? "Delete page" : "Clear page"} tone="danger"
        onConfirm={() => { if (confirm === "deletePage") deletePage(); else change(withPage((p) => ({ ...p, strokes: [] }))); setConfirm(null); }}
        onCancel={() => setConfirm(null)} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center" },
    viewContent: { padding: 12, gap: 12, alignItems: "center" },
    viewPage: { gap: 6, alignItems: "flex-start" },
    topRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderBeige, backgroundColor: c.card },
    iconBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10 },
    doneText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    note: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", paddingHorizontal: 12, paddingTop: 6 },
    error: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium", paddingHorizontal: 12, paddingTop: 6 },
    caption: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", alignSelf: "stretch" },
    canvasWrap: { paddingVertical: 12, alignItems: "center" },
    bar: { borderTopWidth: 1, borderTopColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8, gap: 4 },
    pageRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
    pageText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold", minWidth: 90, textAlign: "center" },
    toolRow: { gap: 6, alignItems: "center", paddingVertical: 2 },
    toolBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.lightCream },
    toolOn: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    toolText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    smallBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center", backgroundColor: c.lightCream },
    smallText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    swatchBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
    swatchOn: { borderColor: c.primaryGreen },
    swatch: { width: 28, height: 28, borderRadius: 14 },
    captionInput: { minHeight: 44, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingHorizontal: 10, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", backgroundColor: c.lightCream },
  });
}
