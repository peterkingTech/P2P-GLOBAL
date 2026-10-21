import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Modal, Image, Linking, RefreshControl, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  MAX_UPLOAD_BYTES, ResourceApiError, deleteResource, fileKind, formatBytes, getDownloadUrl, listResources, uploadResource,
  type GroupResource, type GroupScope, type UploadHandle,
} from "@/lib/groupResourcesApi";

// Files & Resources of ONE Family Circle or Church. Only its active members
// can see or open anything here (checked by the server on every request);
// links to files expire after a few minutes.
const KIND_ICON: Record<ReturnType<typeof fileKind>, keyof typeof Ionicons.glyphMap> = {
  image: "image-outline", pdf: "document-text-outline", doc: "document-outline", sheet: "grid-outline",
  slides: "easel-outline", text: "reader-outline", audio: "musical-notes-outline", file: "attach-outline",
};
type Pending = { key: string; name: string; progress: number; error: string | null; handle: UploadHandle | null; file: Picked };
type Picked = { uri: string; name: string; mimeType: string; size: number };

export default function GroupResourcesScreen() {
  const { scope, groupId, name } = useLocalSearchParams<{ scope: GroupScope; groupId: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [items, setItems] = useState<GroupResource[]>([]);
  const [perm, setPerm] = useState({ canUpload: false, canManage: false, available: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const counter = useRef(0);
  const groupLabel = scope === "church" ? "Church" : "Family Circle";

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      const r = await listResources(scope, groupId);
      setItems(r.items); setPerm({ canUpload: r.canUpload, canManage: r.canManage, available: r.available }); setError(null);
    } catch (e) {
      setError(e instanceof ResourceApiError && e.status === 403 ? `Only members of this ${groupLabel} can see its files.` : e instanceof ResourceApiError ? e.message : "Couldn't load files.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [scope, groupId, groupLabel]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const startUpload = (file: Picked, key = `u${++counter.current}`) => {
    if (file.size > MAX_UPLOAD_BYTES) { setPending((p) => [...p, { key, name: file.name, progress: 0, error: "Files can be up to 25 MB.", handle: null, file }]); return; }
    const handle = uploadResource(scope, groupId, file, {}, (f) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: f } : x))));
    setPending((p) => [...p.filter((x) => x.key !== key), { key, name: file.name, progress: 0, error: null, handle, file }]);
    handle.promise
      .then(() => { setPending((p) => p.filter((x) => x.key !== key)); void load(); })
      .catch((e) => {
        if (e instanceof ResourceApiError && e.status === 499) { setPending((p) => p.filter((x) => x.key !== key)); return; }
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: e instanceof ResourceApiError ? e.message : "The upload failed.", handle: null } : x)));
      });
  };

  const pickDocument = async () => {
    setAddOpen(false);
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    startUpload({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/octet-stream", size: a.size ?? 0 });
  };
  const pickImage = async () => {
    setAddOpen(false);
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const mime = a.mimeType ?? "image/jpeg";
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/heic" ? "heic" : "jpg";
    startUpload({ uri: a.uri, name: a.fileName ?? `photo.${ext}`, mimeType: mime, size: a.fileSize ?? 0 });
  };

  const open = async (item: GroupResource) => {
    try {
      const { url } = await getDownloadUrl(item.id);
      if (fileKind(item.mimeType) === "image") setPreview({ url, name: item.fileName });
      else await Linking.openURL(url);
    } catch (e) { setError(e instanceof ResourceApiError ? e.message : "Couldn't open the file."); }
  };
  const remove = async (id: string) => {
    try { await deleteResource(id); setItems((p) => p.filter((x) => x.id !== id)); setConfirmDelete(null); }
    catch (e) { setError(e instanceof ResourceApiError ? e.message : "Couldn't remove the file."); }
  };

  const renderItem = ({ item }: { item: GroupResource }) => {
    const mine = item.uploaderId === profile?.id;
    const canDelete = mine || perm.canManage;
    return (
      <View style={styles.row}>
        <TouchableOpacity style={styles.rowMain} onPress={() => open(item)} accessibilityRole="button"
          accessibilityLabel={`${item.fileName}, ${formatBytes(item.sizeBytes)}, added by ${item.uploaderName ?? "a member"}. Open`}>
          <View style={styles.icon}><Ionicons name={KIND_ICON[fileKind(item.mimeType)]} size={20} color={c.accentGreen} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>{item.fileName}</Text>
            <Text style={styles.meta} numberOfLines={1}>{formatBytes(item.sizeBytes)} · {item.uploaderName ?? "A member"} · {new Date(item.createdAt).toLocaleDateString()}</Text>
          </View>
        </TouchableOpacity>
        {canDelete && (confirmDelete === item.id ? (
          <TouchableOpacity onPress={() => remove(item.id)} style={styles.confirm} accessibilityRole="button" accessibilityLabel={`Confirm remove ${item.fileName}`}>
            <Text style={styles.confirmText}>Remove</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setConfirmDelete(item.id)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Remove ${item.fileName}`}>
            <Ionicons name="trash-outline" size={18} color={c.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header">Files & Resources</Text>
          <Text style={styles.sub} numberOfLines={1}>{name || groupLabel}</Text>
        </View>
        {perm.canUpload && perm.available && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setAddOpen(true)} accessibilityRole="button" accessibilityLabel="Add a file">
            <Ionicons name="add" size={18} color="#fff" /><Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.privacy}>
        <Ionicons name="lock-closed" size={12} color={c.textMuted} />
        <Text style={styles.privacyText}>Only members of this {groupLabel} can see and open these files.</Text>
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {pending.map((p) => (
        <View key={p.key} style={styles.pending}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          {p.error ? (
            <View style={styles.pendingRow}>
              <Text style={[styles.meta, { color: "#C0392B", flex: 1 }]}>{p.error}</Text>
              {p.file.size <= MAX_UPLOAD_BYTES && <TouchableOpacity onPress={() => startUpload(p.file, p.key)} accessibilityRole="button"><Text style={styles.link}>Retry</Text></TouchableOpacity>}
              <TouchableOpacity onPress={() => setPending((x) => x.filter((y) => y.key !== p.key))} accessibilityRole="button"><Text style={styles.link}>Dismiss</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.pendingRow}>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(p.progress * 100)}%` }]} /></View>
              <Text style={styles.meta}>{Math.round(p.progress * 100)}%</Text>
              <TouchableOpacity onPress={() => p.handle?.cancel()} accessibilityRole="button" accessibilityLabel={`Cancel upload of ${p.name}`}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
            </View>
          )}
        </View>
      ))}
      {loading ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 32 }} /> : !perm.available ? (
        <Text style={styles.empty}>Files & Resources are coming soon.</Text>
      ) : (
        <FlatList data={items} keyExtractor={(i) => i.id} renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={c.accentGreen} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={error ? null : <Text style={styles.empty}>No files yet.{perm.canUpload ? " Tap Add to share a PDF, photo or document with your group." : ""}</Text>} />
      )}

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setAddOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add to {name || groupLabel}</Text>
            <TouchableOpacity style={styles.sheetRow} onPress={pickImage} accessibilityRole="button"><Ionicons name="image-outline" size={20} color={c.textDark} /><Text style={styles.sheetText}>Photo</Text></TouchableOpacity>
            <TouchableOpacity style={styles.sheetRow} onPress={pickDocument} accessibilityRole="button"><Ionicons name="document-outline" size={20} color={c.textDark} /><Text style={styles.sheetText}>Document or file</Text></TouchableOpacity>
            <Text style={styles.meta}>Images, PDFs, Word/Excel/PowerPoint, text and audio · up to 25 MB.</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBg}>
          <TouchableOpacity style={[styles.previewClose, { top: insets.top + 10 }]} onPress={() => setPreview(null)} accessibilityRole="button" accessibilityLabel="Close preview">
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          {preview && <Image source={{ uri: preview.url }} style={{ width: "100%", height: "80%" }} resizeMode="contain" accessibilityLabel={preview.name} />}
          {preview && Platform.OS !== "web" ? <TouchableOpacity onPress={() => Linking.openURL(preview.url)} accessibilityRole="button"><Text style={[styles.link, { color: "#fff", marginTop: 12 }]}>Save or share</Text></TouchableOpacity> : null}
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingRight: 14, gap: 4 },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 19, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    addBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.accentGreen },
    addText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    privacy: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 8 },
    privacyText: { flex: 1, fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    error: { color: "#C0392B", fontSize: 13, fontFamily: "Inter_500Medium", paddingHorizontal: 18, paddingBottom: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 14, paddingRight: 6, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    icon: { width: 40, height: 40, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    confirm: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(220,38,38,0.12)", justifyContent: "center" },
    confirmText: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_700Bold" },
    pending: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, gap: 6 },
    pendingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.progressTrack, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3, backgroundColor: c.accentGreen },
    link: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_600SemiBold", minHeight: 32, textAlignVertical: "center" },
    empty: { textAlign: "center", color: c.textMuted, fontSize: 14, fontFamily: "Inter_400Regular", padding: 32 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32, gap: 6 },
    sheetTitle: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
    sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 },
    sheetText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    previewBg: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
    previewClose: { position: "absolute", right: 14, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 2 },
  });
}
