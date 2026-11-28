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
  /** What's currently in each requested file field, keyed by field ID. */
  files: Record<string, AttachedFile | null>;
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

// ── Where files come from ────────────────────────────────────────────────────

/** A file found in a location. `path` is relative to the location's root ("/" separators), or absolute / a URL. */
export interface FileRef {
  path: string;
  name: string;
  size: number | null;
}

export type ServerProtocol = "sftp" | "ftp" | "ftps";

/** A saved SFTP/FTP server. The password or key lives in the OS credential store. */
export interface FileServer {
  id: string;
  name: string;
  protocol: ServerProtocol;
  host: string;
  port: number;
  username: string;
  auth: "password" | "key";
  /** SHA-256 fingerprint of the SFTP host key, remembered the first time. */
  hostKey: string | null;
  createdAt: string;
}

export type FileLocation =
  /** A folder on this computer, a network drive, or a synced SharePoint/OneDrive folder. root "" = paths are absolute. */
  | { kind: "computer"; root: string }
  /** A .zip file on this computer. */
  | { kind: "zip"; file: string }
  /** Files dragged onto the page, copied into the toolkit's own folder. */
  | { kind: "dropped"; stageId: string }
  /** A folder on a saved SFTP/FTP server. */
  | { kind: "server"; serverId: string; root: string }
  /** Web links (https://…) listed in a spreadsheet. */
  | { kind: "web" };

export interface BrowseEntry {
  name: string;
  type: "dir" | "file" | "zip";
  size: number | null;
}

export interface BrowseResult {
  /** The folder shown, in the location's own path style. */
  dir: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export interface Place {
  label: string;
  path: string;
  kind: "home" | "desktop" | "documents" | "downloads" | "cloud" | "drive" | "network";
}

// ── Runs (long-running upload jobs, executed by the local server) ────────────

export interface JobItem {
  /** Position in the run, 0-based. */
  n: number;
  path: string;
  name: string;
  size: number | null;
  recordId: number;
  recordLabel: string;
  fieldId: number;
  /** Spreadsheet row number, when the run came from a mapping spreadsheet. */
  sheetRow?: number;
  /** Which of JobSpec.locations the file is in (default 0). */
  loc?: number;
}

export interface JobSpec {
  connectionId: string;
  formId: number;
  formName: string;
  location: FileLocation;
  locationLabel: string;
  /** When files come from several places (e.g. one folder per spreadsheet column). location = locations[0]. */
  locations?: FileLocation[];
  fields: { id: number; label: string; imageOnly: boolean }[];
  replaceExisting: boolean;
  items: JobItem[];
}

export type ItemStatus = "verified" | "already" | "skipped" | "not_verified" | "failed";

export interface ItemResult {
  n: number;
  status: ItemStatus;
  message?: string;
  /** Set when Apricot did not accept the file type, so "Do again" can include these files. */
  code?: "rejected_type";
  /** What Apricot shows on the record afterwards. */
  file?: AttachedFile;
  at: string;
}

export type JobState = "ready" | "running" | "paused" | "interrupted" | "stopped" | "done";

export interface JobSummary {
  id: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  state: JobState;
  /** Set when a trial run ("Try 3 first") paused the job on purpose. */
  pausedReason: "trial" | "user" | "error" | null;
  pauseMessage?: string;
  /** When a run paused by an outage will try again by itself. */
  autoResumeAt: string | null;
  connectionId: string;
  connectionName: string;
  environment: Environment;
  formName: string;
  locationLabel: string;
  replaceExisting: boolean;
  total: number;
  counts: Record<ItemStatus, number>;
  inProgress: number;
  /** Files finished per minute over the recent past, and the estimated seconds left. */
  perMinute: number | null;
  etaSeconds: number | null;
}

export interface JobItemView extends JobItem {
  result: ItemResult | null;
  fieldLabel: string;
}
