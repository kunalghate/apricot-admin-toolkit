// Types shared by the local server and the web page.

export type Environment = "sandbox" | "production";

export interface Connection {
  id: string;
  name: string;
  environment: Environment;
  orgId: string | null;
  userLabel: string | null;
  clientIdHint: string; // last 4 characters only, for display
  createdAt: string;
}

export interface FormSummary {
  id: number;
  name: string;
  /** 0 for Tier 1 forms, otherwise the ID of the parent (Tier 1) form. */
  parentFormId: number;
}

export interface FieldInfo {
  id: number;
  label: string;
  typeId: number;
  required: boolean;
  active: boolean;
  hidden: boolean;
  readonly: boolean;
  sectionId: number | null;
  order: number;
}

export interface FormDetail {
  form: FormSummary;
  fields: FieldInfo[];
}

export interface AttachedFile {
  filename: string;
  size: number | null;
}

export interface RecordMatch {
  id: number;
  label: string;
  existingFile: AttachedFile | null;
}

export type MatchResult =
  | { key: string; status: "found"; record: RecordMatch }
  | { key: string; status: "not_found" }
  | { key: string; status: "multiple"; records: RecordMatch[] }
  | { key: string; status: "error"; message: string };

/** How records are identified: by Apricot record ID, or by one or more field values (a composite key). */
export type MatchBy =
  | { kind: "record_id" }
  | { kind: "fields"; keys: { key: string; kind: "text" | "date" }[] };

export type UploadOutcome =
  | { status: "verified"; file: AttachedFile }
  | { status: "not_verified"; message: string }
  | { status: "failed"; message: string; rejectedType?: boolean };
