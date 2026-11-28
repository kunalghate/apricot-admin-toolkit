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
  ready: { label: "Ready", tone: "green", help: "The toolkit will attach this file." },
  replace: { label: "Will replace", tone: "amber", help: "This record has a file in this field. The toolkit will replace it. You cannot get the old file back." },
  has_file: { label: "Has a file", tone: "neutral", help: "This record has a file in this field. The toolkit does not replace it." },
  duplicate: { label: "Duplicate", tone: "amber", help: "A different file goes into this field on this record. A field holds one file. Remove one of the two." },
  no_key: { label: "Data missing", tone: "red", help: "The toolkit cannot find the data that identifies the record. Type the record ID." },
  not_found: { label: "No record", tone: "red", help: "No record has this data. Examine the data, or type the record ID." },
  multiple: { label: "More than one record", tone: "amber", help: "More than one record has this data. Select the correct record." },
  error: { label: "Search failed", tone: "red", help: "A problem occurred when the toolkit tried to find the record." },
  file_missing: { label: "No file", tone: "red", help: "The spreadsheet gives a file that is not in the location that you selected." },
  file_ambiguous: { label: "More than one file", tone: "amber", help: "More than one file has the name in the spreadsheet. Select the correct file." },
  blocked_type: { label: "Unsafe file type", tone: "red", help: "You cannot attach program files, for example .exe files." },
  too_large: { label: "File too large", tone: "red", help: `The Apricot API accepts files up to ${MAX_UPLOAD_LABEL}. Make the file smaller, or attach it in Apricot.` },
  not_image: { label: "Not an image", tone: "red", help: "This is an image field. It accepts only images, for example .jpg, .png or .gif files." },
  excluded: { label: "Removed", tone: "neutral", help: "You removed this row from the upload." },
};

export const willUpload = (s: RowState) => s === "ready" || s === "replace";

export { fileExtension };
