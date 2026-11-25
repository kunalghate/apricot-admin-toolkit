import type { FieldInfo } from "./types";

// Apricot field type IDs we rely on. Confirmed from Bonterra docs and support findings.
export const FIELD_TYPE = {
  NAME: 5, // stored as field_<id>_first / field_<id>_last
  ATTACHMENT: 29, // "Attach Doc": one file per record
  ATTACHMENT_MULTIPLE: 102, // "Attach Docs – Multiple": API can download but not upload
  IMAGE: 72, // "Image": same upload endpoint as Attach Doc (verified live 2026-11-25)
  LINK: 39,
} as const;

// Field types the matcher can look values up by. Observed in a live org (2026-11-25):
// 1 Text, 2 Numeric, 11 Email, 16 SSN, 17 Date, 19 Phone. 7 and 30 come from the
// Bonterra Workato connector's list of simple types.
export const SIMPLE_VALUE_TYPES = new Set([1, 2, 7, 11, 16, 17, 19, 30]);

/** Fields that hold one uploaded file: Attach Doc and Image. */
export function isAttachmentField(f: FieldInfo) {
  return f.typeId === FIELD_TYPE.ATTACHMENT || f.typeId === FIELD_TYPE.IMAGE;
}

export function isImageField(f: FieldInfo) {
  return f.typeId === FIELD_TYPE.IMAGE;
}

// The API doesn't check what goes into an Image field (it accepted a PDF in testing),
// so the toolkit only sends real image types there.
export const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"]);

export function isMultiAttachmentField(f: FieldInfo) {
  return f.typeId === FIELD_TYPE.ATTACHMENT_MULTIPLE;
}

/** Fields a user could reasonably use to identify a record. */
export function isIdentifierCandidate(f: FieldInfo) {
  return f.active && SIMPLE_VALUE_TYPES.has(f.typeId);
}

// File types Apricot is known to accept for shared files (Bonterra help center).
// Each org has its own allowed list, so this is only used for gentle warnings.
export const COMMON_ALLOWED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "ods", "odt", "txt", "rtf",
  "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff",
]);

const RISKY_EXTENSIONS = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "js", "vbs", "ps1", "sh", "app", "dmg", "jar"]);

// Verified live 2026-11-25: the v1 gateway rejects request bodies over 10,485,760 bytes (413).
// Leave headroom for the multipart wrapper around the file.
export const MAX_UPLOAD_BYTES = 10_485_760 - 64 * 1024;
export const MAX_UPLOAD_LABEL = "10 MB";

export function fileExtension(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export const isImageFile = (name: string) => IMAGE_EXTENSIONS.has(fileExtension(name));

export type FileTypeRisk = "ok" | "unusual" | "blocked";

export function fileTypeRisk(name: string): FileTypeRisk {
  const ext = fileExtension(name);
  if (RISKY_EXTENSIONS.has(ext)) return "blocked";
  if (!COMMON_ALLOWED_EXTENSIONS.has(ext)) return "unusual";
  return "ok";
}
