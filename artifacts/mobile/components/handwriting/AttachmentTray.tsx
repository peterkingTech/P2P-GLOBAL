import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import type { AppColors } from "@/constants/themes";
import { onStudioSaved } from "@/lib/handwriting";
import {
  getAttachmentStatus, myDrafts, removeDraft, uploadFile, getFileLink, attachmentsFor, attachmentLabel, formatBytes,
  type Attachment, type AttachmentStatus, type TargetKind,
} from "@/lib/learningAttachmentsApi";
import { AppButton, IconButton } from "@/components/ui";

// Drawings, photos and PDFs on a Comprehensive Check answer. Optional: the
// typed answer box above it always works, and nothing here is required.
// Shown only when the server has the feature switched on. Each answer box
// remembers its own drafts (per account, on this device) until it is sent.

type Item = { id: string | null; key: string; kind: Attachment["kind"]; label: string; status: "uploading" | "failed" | "ready"; progress: number; error?: string;
  local?: { uri: string; name: string; mimeType: string; size: number } };
const trayStoreKey = (userId: string, trayKey: string) => `p2p.attachments.tray.v1:${userId}:${trayKey}`;
export async function clearTray(userId: string, trayKey: string) { try { await AsyncStorage.removeItem(trayStoreKey(userId, trayKey)); } catch { /* nothing stored */ } }

const ALLOWED_IMAGES = ["image/jpeg", "image/png", "image/webp"];

export function AttachmentTray({ trayKey, disabled, onChange }: {
  trayKey: string; disabled?: boolean;
  /** Ready attachment ids, and whether anything is still uploading or failed. */
  onChange: (state: { ids: string[]; busy: boolean; count: number }) => void;
}) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [status, setStatus] = useState<AttachmentStatus | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef(`tray:${trayKey}:${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => { getAttachmentStatus().then(setStatus); }, []);

  // Restore this answer box's drafts (they live on the server; the ids live here).
  useEffect(() => {
    if (!userId || !status?.enabled) return;
    let live = true;
    (async () => {
      try {
        const stored = JSON.parse((await AsyncStorage.getItem(trayStoreKey(userId, trayKey))) ?? "[]") as string[];
        if (!stored.length) return;
        const { attachments } = await myDrafts();
        const byId = new Map(attachments.map((a) => [a.id, a]));
        const restored = stored.map((id) => byId.get(id)).filter((a): a is Attachment => !!a && a.status === "ready")
          .map((a) => ({ id: a.id, key: a.id, kind: a.kind, label: attachmentLabel(a), status: "ready" as const, progress: 1 }));
        if (live) setItems(restored);
      } catch { /* offline: the answer box still works */ }
    })();
    return () => { live = false; };
  }, [userId, status?.enabled, trayKey]);

  // Tell the answer box, and remember the ids for next time.
  useEffect(() => {
    const ids = items.filter((i) => i.status === "ready" && i.id).map((i) => i.id!);
    onChange({ ids, busy: items.some((i) => i.status !== "ready"), count: items.length });
    if (userId) AsyncStorage.setItem(trayStoreKey(userId, trayKey), JSON.stringify(ids)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // A drawing saved in the Studio comes back here.
  useEffect(() => onStudioSaved(requestKey, (a) => {
    setItems((prev) => {
      const label = `Drawing, ${a.pageCount ?? 1} page${(a.pageCount ?? 1) === 1 ? "" : "s"}`;
      if (prev.some((i) => i.id === a.id)) return prev.map((i) => (i.id === a.id ? { ...i, label } : i));
      return [...prev, { id: a.id, key: a.id, kind: "handwriting", label, status: "ready", progress: 1 }];
    });
  }), [requestKey]);

  const counts = { drawings: items.filter((i) => i.kind === "handwriting").length, files: items.filter((i) => i.kind !== "handwriting").length };
  const lim = status?.limits;

  const startUpload = useCallback(async (local: NonNullable<Item["local"]>, kind: Item["kind"], retryOf?: Item) => {
    const key = retryOf?.key ?? `up:${Date.now()}`;
    setItems((prev) => retryOf ? prev.map((i) => (i.key === key ? { ...i, status: "uploading", progress: 0, error: undefined } : i))
      : [...prev, { id: null, key, kind, label: `${kind === "pdf" ? "PDF" : "Photo"} · ${local.name}`, status: "uploading", progress: 0, local }]);
    try {
      const a = await uploadFile(local, (p) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, progress: p } : i))), retryOf?.id ?? undefined);
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, id: a.id, status: "ready", progress: 1, label: attachmentLabel(a) } : i)));
    } catch (e: any) {
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, id: e?.attachmentId ?? i.id, status: "failed", error: e?.message ?? "Upload paused — tap Retry." } : i)));
    }
  }, []);

  if (!status?.enabled) return null;

  const addDrawing = () => {
    if (lim && counts.drawings >= lim.drawingsPerAnswer) { setError(`Add up to ${lim.drawingsPerAnswer} drawings to one answer.`); return; }
    router.push({ pathname: "/learning/studio/[docId]", params: { docId: "new", k: requestKey } } as any);
  };
  const editDrawing = (id: string) => router.push({ pathname: "/learning/studio/[docId]", params: { docId: id, k: requestKey } } as any);
  const addPhoto = async () => {
    setError(null);
    if (lim && counts.files >= lim.filesPerAnswer) { setError(`Add up to ${lim.filesPerAnswer} photos or PDFs to one answer.`); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: false,
      // iOS: hand over a JPEG rather than HEIC, so every reviewer's device can show it.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const mimeType = a.mimeType ?? "image/jpeg";
    if (!ALLOWED_IMAGES.includes(mimeType)) { setError("That photo type isn't supported. Choose a JPEG, PNG or WebP photo."); return; }
    const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const base = (a.fileName ?? `photo.${ext}`).replace(/\.[^.]+$/, "");
    startUpload({ uri: a.uri, name: `${base}.${ext}`, mimeType, size: a.fileSize ?? 0 }, "image");
  };
  const addPdf = async () => {
    setError(null);
    if (lim && counts.files >= lim.filesPerAnswer) { setError(`Add up to ${lim.filesPerAnswer} photos or PDFs to one answer.`); return; }
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if ((a.mimeType ?? "application/pdf") !== "application/pdf") { setError("Choose a PDF file."); return; }
    if (a.size && lim && a.size > lim.fileBytes) { setError("Files can be up to 25 MB."); return; }
    startUpload({ uri: a.uri, name: a.name.toLowerCase().endsWith(".pdf") ? a.name : `${a.name}.pdf`, mimeType: "application/pdf", size: a.size ?? 0 }, "pdf");
  };
  const remove = async (it: Item) => {
    setItems((prev) => prev.filter((i) => i.key !== it.key));
    if (it.id) removeDraft(it.id).catch(() => {});
  };
  const open = async (it: Item) => {
    if (!it.id) return;
    if (it.kind === "handwriting") return editDrawing(it.id);
    try { const { url } = await getFileLink(it.id); await WebBrowser.openBrowserAsync(url); } catch (e: any) { setError(e?.message ?? "That file couldn't be opened."); }
  };

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <AppButton label="Add drawing" onPress={addDrawing} variant="secondary" icon="brush-outline" disabled={disabled} accessibilityLabel="Add a drawing or handwriting" />
        <AppButton label="Add photo" onPress={addPhoto} variant="secondary" icon="image-outline" disabled={disabled} accessibilityLabel="Add a photo" />
        <AppButton label="Add PDF" onPress={addPdf} variant="secondary" icon="document-attach-outline" disabled={disabled} accessibilityLabel="Add a PDF" />
      </View>
      {items.map((it) => (
        <View key={it.key} style={s.item}>
          <TouchableOpacity style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onPress={() => open(it)} disabled={!it.id || it.status !== "ready"} accessibilityRole="button"
            accessibilityLabel={`${it.label}. ${it.status === "uploading" ? `Uploading, ${Math.round(it.progress * 100)} percent` : it.status === "failed" ? "Upload paused" : it.kind === "handwriting" ? "Tap to edit" : "Tap to open"}`}>
            <Text style={s.itemText} numberOfLines={1}>{it.label}</Text>
            {it.status === "uploading" ? (
              <View style={s.track}><View style={[s.fill, { width: `${Math.round(it.progress * 100)}%` }]} /></View>
            ) : it.status === "failed" ? <Text style={s.itemError}>{it.error}</Text> : null}
          </TouchableOpacity>
          {it.status === "uploading" ? <ActivityIndicator color={c.accentGreen} /> : null}
          {it.status === "failed" && it.local ? (
            <IconButton icon="refresh" accessibilityLabel={`Retry upload of ${it.label}`} onPress={() => startUpload(it.local!, it.kind, it)} color={c.accentGreen} />
          ) : null}
          <IconButton icon="close" accessibilityLabel={`Remove ${it.label}`} onPress={() => remove(it)} color={c.textMid} disabled={disabled} />
        </View>
      ))}
      {error ? <Text style={s.itemError} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

/** Sent answers: their drawings and files, for the learner and their reviewers (the server decides who may see them). */
export function AttachmentList({ kind, submissionId, compact }: { kind: TargetKind; submissionId: string | null | undefined; compact?: boolean }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [list, setList] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!submissionId || !/^[0-9a-f-]{36}$/i.test(submissionId)) { setList([]); return; }
    attachmentsFor(kind, [submissionId]).then((m) => { if (live) setList(m[submissionId] ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [kind, submissionId]);
  if (!list.length) return null;
  const open = async (a: Attachment) => {
    if (a.kind === "handwriting") return router.push({ pathname: "/learning/studio/[docId]", params: { docId: a.id, view: "1" } } as any);
    try { const { url } = await getFileLink(a.id); await WebBrowser.openBrowserAsync(url); } catch (e: any) { setError(e?.message ?? "That file couldn't be opened."); }
  };
  return (
    <View style={[s.wrap, compact && { marginTop: 4 }]}>
      {list.map((a) => (
        <TouchableOpacity key={a.id} style={s.item} onPress={() => open(a)} accessibilityRole="button"
          accessibilityLabel={`${attachmentLabel(a)}${a.caption ? `. ${a.caption}` : ""}. Tap to open`}>
          <Ionicons name={a.kind === "handwriting" ? "brush-outline" : a.kind === "pdf" ? "document-outline" : "image-outline"} size={16} color={c.accentGreen} />
          <View style={{ flex: 1 }}>
            <Text style={s.itemText} numberOfLines={1}>{attachmentLabel(a)}{a.sizeBytes && a.kind !== "handwriting" ? ` · ${formatBytes(a.sizeBytes)}` : ""}</Text>
            {a.caption ? <Text style={s.caption} numberOfLines={2}>{a.caption}</Text> : null}
          </View>
          <Ionicons name="open-outline" size={16} color={c.textMid} />
        </TouchableOpacity>
      ))}
      {error ? <Text style={s.itemError} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    wrap: { gap: 6, marginTop: 6, marginBottom: 6 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    addText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    item: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    itemText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    caption: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular" },
    itemError: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium" },
    track: { height: 4, borderRadius: 2, backgroundColor: c.borderBeige, overflow: "hidden", marginTop: 4 },
    fill: { height: 4, backgroundColor: c.accentGreen },
  });
}

