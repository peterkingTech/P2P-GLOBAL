// Resolves a safe file extension + Content-Type for an expo-image-picker
// asset before uploading it to Supabase Storage.
//
// asset.uri is NOT a reliable source for either of these — on web,
// expo-image-picker returns a blob: URL with no file extension at all
// (blob:http://host/9d62510e-...), so every call site that guessed the
// extension via `uri.split(".").pop()` silently used the ENTIRE blob URL as
// the "extension" (there's no "." to split on), which then poisoned the
// Content-Type header sent to Supabase Storage (e.g. "image/blob:http://...")
// and every upload 415'd with invalid_mime_type. Native file:// URIs usually
// do have a real extension, but asset.mimeType is authoritative on every
// platform and should always be preferred when present.
export function resolveMediaUpload(asset: { uri: string; mimeType?: string; fileName?: string | null }): { ext: string; contentType: string } {
  if (asset.mimeType) {
    const sub = asset.mimeType.split("/")[1]?.split("+")[0]?.toLowerCase();
    const ext = sub === "jpeg" ? "jpg" : sub || "jpg";
    return { ext, contentType: asset.mimeType };
  }
  const rawExt = (asset.fileName || asset.uri).split("?")[0].split(".").pop()?.toLowerCase();
  // A blob: URL (or any URI without a real dot-extension) falls through
  // here — reject anything that isn't a short, plausible extension rather
  // than poisoning the Content-Type header with it.
  const ext = rawExt && /^[a-z0-9]{2,5}$/.test(rawExt) ? (rawExt === "jpeg" ? "jpg" : rawExt) : "jpg";
  return { ext, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` };
}