import type { FileItem } from "../../lib/files";
import { fileExtension, fileTypeRisk, isImageFile, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../../../shared/fields";
import type { RecordMatch, UploadOutcome } from "../../../shared/types";

export type RowResult =
  | UploadOutcome
  | { status: "uploading" }
  | { status: "skipped"; message: string };

export interface Row {
  item: FileItem;
  key: string | null;
  lookup: "found" | "not_found" | "multiple" | "error" | "no_key";
  lookupMessage?: string;
  record: RecordMatch | null;
  candidates?: RecordMatch[];
  manual?: boolean;
  excluded?: boolean;
  result?: RowResult;
}

export type RowState =
  | "ready"
  | "replace"
  | "has_file"
  | "duplicate"
  | "no_key"
  | "not_found"
  | "multiple"
  | "error"
  | "blocked_type"
  | "too_large"
  | "not_image"
  | "excluded";

export const ATTENTION_STATES: RowState[] = ["no_key", "not_found", "multiple", "error", "duplicate", "blocked_type", "too_large", "not_image"];

/** Rows (after the first) that point at a record another file already targets. */
export function duplicateIds(rows: Row[]): Set<string> {
  const seen = new Set<number>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (r.excluded || !r.record) continue;
    if (seen.has(r.record.id)) dupes.add(r.item.id);
    else seen.add(r.record.id);
  }
  return dupes;
}

export function rowState(r: Row, replaceExisting: boolean, dupes: Set<string>, imageOnly = false): RowState {
  if (r.excluded) return "excluded";
  if (fileTypeRisk(r.item.file.name) === "blocked") return "blocked_type";
  if (imageOnly && !isImageFile(r.item.file.name)) return "not_image";
  if (r.item.file.size > MAX_UPLOAD_BYTES) return "too_large";
  if (!r.record) {
    if (r.lookup === "multiple") return "multiple";
    if (r.lookup === "error") return "error";
    if (r.lookup === "no_key") return "no_key";
    return "not_found";
  }
  if (dupes.has(r.item.id)) return "duplicate";
  if (r.record.existingFile) return replaceExisting ? "replace" : "has_file";
  return "ready";
}

export const STATE_COPY: Record<RowState, { label: string; tone: "green" | "amber" | "red" | "neutral" | "blue"; help: string }> = {
  ready: { label: "Ready", tone: "green", help: "Will be attached." },
  replace: { label: "Will replace", tone: "amber", help: "This record already has a file here. It will be replaced, and the old file can't be restored." },
  has_file: { label: "Already has a file", tone: "neutral", help: "Skipped so the existing file isn't replaced." },
  duplicate: { label: "Duplicate", tone: "amber", help: "Another file is already going to this record. The field holds one file, so remove one of them." },
  no_key: { label: "No ID in name", tone: "red", help: "Couldn't find an identifier in this file name. Enter the record ID manually." },
  not_found: { label: "Not found", tone: "red", help: "No record matches. Check the ID, or enter the record ID manually." },
  multiple: { label: "Several matches", tone: "amber", help: "More than one record matches. Pick the right one." },
  error: { label: "Lookup failed", tone: "red", help: "Something went wrong looking this up." },
  blocked_type: { label: "Unsafe file type", tone: "red", help: "Program files like .exe can't be attached." },
  too_large: { label: "Too large", tone: "red", help: `Over the Apricot API's ${MAX_UPLOAD_LABEL} limit. Compress or split it, or attach it in Apricot directly.` },
  not_image: { label: "Not an image", tone: "red", help: "This is an Image field, so only pictures (.jpg, .png, .gif…) can go here." },
  excluded: { label: "Removed", tone: "neutral", help: "You removed this file from the batch." },
};

export const willUpload = (s: RowState) => s === "ready" || s === "replace";

export { fileExtension };
