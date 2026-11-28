import type { FileItem } from "../../lib/files";
import type { Resolution, Sheet } from "../../lib/mapping";
import { fileExtension, fileTypeRisk, isImageFile, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../../../shared/fields";
import type { FileLocation, RecordMatch } from "../../../shared/types";

/** What the Files step hands to the Match step. */
export interface Source {
  mode: "names" | "sheet";
  location: FileLocation;
  locationLabel: string;
  /** names: the files to attach. sheet: the files found in the chosen location (may be empty for links). */
  files: FileItem[];
  sheet?: SheetSource;
  /** Every place files come from. location/locationLabel = locations[0]. */
  locations?: { location: FileLocation; label: string }[];
}

export interface SheetSource {
  sheet: Sheet;
  /** Which columns hold files, and which Apricot field each goes into. */
  fileCols: { col: number; fieldId: number }[];
  /** resolved[row][i] = what fileCols[i] on that row points to. */
  resolved: Resolution[][];
  /** colLocation[i] = index into Source.locations for fileCols[i]. */
  colLocation: number[];
  /** The Files step's own choices, so going Back keeps them. */
  pickState?: unknown;
}

/** One file going into one field on one record. */
export interface Row {
  id: string;
  file: FileItem | null;
  /** When a spreadsheet names a file that couldn't be found, or matches several. */
  fileIssue?: "missing" | "ambiguous";
  fileWanted?: string;
  fileCandidates?: FileItem[];
  fieldId: number;
  /** Which of Source.locations the file is in (default 0). */
  loc?: number;
  /** Spreadsheet row number (the header is row 1). */
  sheetRow?: number;
  key: string | null;
  lookup: "found" | "not_found" | "multiple" | "error" | "no_key";
  lookupMessage?: string;
  record: RecordMatch | null;
  candidates?: RecordMatch[];
  manual?: boolean;
  excluded?: boolean;
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
  | "file_missing"
  | "file_ambiguous"
  | "blocked_type"
  | "too_large"
  | "not_image"
  | "excluded";

export const ATTENTION_STATES: RowState[] = [
  "file_missing",
  "file_ambiguous",
  "no_key",
  "not_found",
  "multiple",
  "error",
  "duplicate",
  "blocked_type",
  "too_large",
  "not_image",
];

export const pairKey = (r: Row) => (r.record ? `${r.record.id}:${r.fieldId}` : "");

/** Rows (after the first) that send a file to a record + field another row already targets. */
export function duplicateIds(rows: Row[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (r.excluded || !r.record || !r.file) continue;
    const k = pairKey(r);
    if (seen.has(k)) dupes.add(r.id);
    else seen.add(k);
  }
  return dupes;
}

export const existingFile = (r: Row) => r.record?.files[r.fieldId] ?? null;

export function rowState(r: Row, replaceExisting: boolean, dupes: Set<string>, imageFields: Set<number>): RowState {
  if (r.excluded) return "excluded";
  if (!r.file) return r.fileIssue === "ambiguous" ? "file_ambiguous" : "file_missing";
  if (fileTypeRisk(r.file.name) === "blocked") return "blocked_type";
  if (imageFields.has(r.fieldId) && !isImageFile(r.file.name)) return "not_image";
  if (r.file.size != null && r.file.size > MAX_UPLOAD_BYTES) return "too_large";
  if (!r.record) {
    if (r.lookup === "multiple") return "multiple";
    if (r.lookup === "error") return "error";
    if (r.lookup === "no_key") return "no_key";
    return "not_found";
  }
  if (dupes.has(r.id)) return "duplicate";
  if (existingFile(r)) return replaceExisting ? "replace" : "has_file";
  return "ready";
}

export const STATE_COPY: Record<RowState, { label: string; tone: "green" | "amber" | "red" | "neutral" | "blue"; help: string }> = {
  ready: { label: "Ready", tone: "green", help: "Will be attached." },
  replace: { label: "Will replace", tone: "amber", help: "This record already has a file here. It will be replaced, and the old file can't be restored." },
  has_file: { label: "Already has a file", tone: "neutral", help: "Skipped so the existing file isn't replaced." },
  duplicate: { label: "Duplicate", tone: "amber", help: "Another file is already going into this field on this record. A field holds one file, so remove one of them." },
  no_key: { label: "Missing details", tone: "red", help: "Couldn't find what identifies the record. Enter the record ID manually." },
  not_found: { label: "Record not found", tone: "red", help: "No record matches. Check the details, or enter the record ID manually." },
  multiple: { label: "Several matches", tone: "amber", help: "More than one record matches. Pick the right one." },
  error: { label: "Lookup failed", tone: "red", help: "Something went wrong looking this up." },
  file_missing: { label: "File not found", tone: "red", help: "The spreadsheet names a file that isn't in the chosen location." },
  file_ambiguous: { label: "Several files match", tone: "amber", help: "More than one file matches the name in the spreadsheet. Pick the right one." },
  blocked_type: { label: "Unsafe file type", tone: "red", help: "Program files like .exe can't be attached." },
  too_large: { label: "Too large", tone: "red", help: `Over the Apricot API's ${MAX_UPLOAD_LABEL} limit. Compress or split it, or attach it in Apricot directly.` },
  not_image: { label: "Not an image", tone: "red", help: "This is an Image field, so only pictures (.jpg, .png, .gif…) can go here." },
  excluded: { label: "Removed", tone: "neutral", help: "You removed this from the batch." },
};

export const willUpload = (s: RowState) => s === "ready" || s === "replace";

export { fileExtension };
