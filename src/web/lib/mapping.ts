// Mapping spreadsheets from customers: finding the right columns, and finding the files they name.

import type { FileItem } from "./files";
import type { FieldInfo } from "../../shared/types";
import type { IdentifierOption } from "../../shared/identifiers";

export interface Sheet {
  name: string;
  header: string[];
  /** Data rows (without the header). Row i is spreadsheet row i + 2. */
  rows: string[][];
}

export const sheetRowNumber = (i: number) => i + 2;

// ── What a value looks like ──────────────────────────────────────────────────

export const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
/** C:\…, \\server\share\…, /Users/…, ~/… */
export const isAbsolutePath = (v: string) => /^[a-z]:[\\/]|^\\\\|^\/\/|^\/|^~\//i.test(v.trim());
const looksDateOrNumber = (v: string) => /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$|^\d+([.,]\d+)?$/.test(v.trim());
const hasExtension = (v: string) => /\.[a-z][a-z0-9]{0,5}$/i.test(v.trim()) && !looksDateOrNumber(v);

/** A file name, path or link. Dates like 01/02/1990 have slashes too, so a path must end in an extension. */
export function looksLikeFile(v: string) {
  const s = v.trim();
  if (!s) return false;
  return isUrl(s) || hasExtension(s);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ── Guessing columns ─────────────────────────────────────────────────────────

const FILE_HEADER = /file|path|document|doc\b|attach|photo|image|picture|scan|link|url|pdf/i;

/** Columns that look like they hold file names, paths or links. */
export function guessFileColumns(sheet: Sheet): number[] {
  const sample = sheet.rows.slice(0, 300);
  const scored = sheet.header.map((h, col) => {
    const vals = sample.map((r) => r[col] ?? "").filter((v) => v.trim());
    if (vals.length === 0) return { col, score: 0 };
    const share = vals.filter(looksLikeFile).length / vals.length;
    return { col, score: share + (FILE_HEADER.test(h) ? 0.3 : 0) };
  });
  return scored.filter((s) => s.score >= 0.6).sort((a, b) => b.score - a.score).map((s) => s.col).sort((a, b) => a - b);
}

/** A column that holds Apricot record IDs, if there's an obvious one. */
export function guessRecordIdColumn(sheet: Sheet, exclude: number[]): number | null {
  const sample = sheet.rows.slice(0, 300);
  let best: { col: number; score: number } | null = null;
  sheet.header.forEach((h, col) => {
    if (exclude.includes(col)) return;
    const vals = sample.map((r) => r[col] ?? "").filter((v) => v.trim());
    if (vals.length === 0) return;
    const numeric = vals.filter((v) => /^\d+$/.test(v.trim())).length / vals.length;
    const n = norm(h);
    const header = /recordid|apricotid|^recid$|^rid$|^id$/.test(n) ? 1 : /id$/.test(n) ? 0.4 : 0;
    const score = numeric * (0.5 + header);
    if (numeric > 0.9 && score > (best?.score ?? 0.45)) best = { col, score };
  });
  return (best as { col: number } | null)?.col ?? null;
}

const SYNONYMS: [RegExp, RegExp][] = [
  [/dateofbirth|birthdate|dob/, /dateofbirth|birthdate|^dob$|birthday|bday/],
  [/firstname$/, /^first$|firstname|fname|givenname|forename|^first_?name$/],
  [/lastname$/, /^last$|lastname|lname|surname|familyname/],
];

/** The column whose header best matches an Apricot field, or null. */
export function guessColumnFor(sheet: Sheet, option: IdentifierOption, exclude: number[]): number | null {
  const want = norm(option.label);
  const short = norm(option.label.split(":").pop() ?? option.label);
  let best: { col: number; score: number } | null = null;
  sheet.header.forEach((h, col) => {
    if (exclude.includes(col)) return;
    const n = norm(h);
    if (!n) return;
    let score = 0;
    if (n === want) score = 3;
    else if (n === short) score = 2.5;
    else if (SYNONYMS.some(([a, b]) => a.test(short) && b.test(n))) score = 2;
    else if (short.length > 3 && (n.includes(short) || short.includes(n))) score = 1;
    if (score > (best?.score ?? 0)) best = { col, score };
  });
  return (best as { col: number } | null)?.col ?? null;
}

// ── Finding the files a spreadsheet names ────────────────────────────────────

export type Resolution =
  | { status: "empty" }
  | { status: "found"; file: FileItem; how: "exact" | "end" | "name" | "link" | "full" }
  | { status: "ambiguous"; candidates: FileItem[] }
  | { status: "missing" };

/** "C:\\Exports\\A\\x.pdf" → ["c:", "exports", "a", "x.pdf"] (lower-case, for comparing). */
function segments(p: string): string[] {
  return p
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== ".")
    .map((s) => s.toLowerCase());
}

const MAX_SUFFIX = 8;

export interface FileIndex {
  bySuffix: Map<string, FileItem[]>[]; // [k] → last k+1 segments joined
  byStem: Map<string, FileItem[]>;
  rootSegs: string[];
}

/** Index a listing for fast lookups. `rootPath` is the chosen folder's full path, used to strip full paths. */
export function indexFiles(files: FileItem[], rootPath = ""): FileIndex {
  const bySuffix = Array.from({ length: MAX_SUFFIX }, () => new Map<string, FileItem[]>());
  const byStem = new Map<string, FileItem[]>();
  const add = (m: Map<string, FileItem[]>, k: string, f: FileItem) => {
    const l = m.get(k);
    if (l) l.push(f);
    else m.set(k, [f]);
  };
  for (const f of files) {
    const segs = segments(f.path);
    for (let k = 0; k < Math.min(MAX_SUFFIX, segs.length); k++) add(bySuffix[k]!, segs.slice(segs.length - k - 1).join("/"), f);
    const last = segs[segs.length - 1] ?? "";
    add(byStem, last.replace(/\.[^.]+$/, ""), f);
  }
  return { bySuffix, byStem, rootSegs: segments(rootPath) };
}

/**
 * Find the file a spreadsheet cell refers to:
 *  1. a web link → used as-is
 *  2. the path relative to the chosen folder (or a full path inside it)
 *  3. the longest matching end of the path (handles paths written on someone else's computer)
 *  4. the file name without extension, if unique
 */
export function resolveFile(raw: string, index: FileIndex): Resolution {
  const v = raw.trim();
  if (!v) return { status: "empty" };
  if (isUrl(v)) return { status: "found", file: { id: `url:${v}`, path: v, name: decodeURIComponent(v.split(/[?#]/)[0]!.split("/").pop() || "download"), size: null }, how: "link" };

  let segs = segments(v);
  const root = index.rootSegs;
  if (root.length && segs.length > root.length && root.every((s, i) => segs[i] === s)) segs = segs.slice(root.length);
  if (segs.length === 0) return { status: "missing" };

  for (let k = Math.min(MAX_SUFFIX, segs.length) - 1; k >= 0; k--) {
    const hits = index.bySuffix[k]!.get(segs.slice(segs.length - k - 1).join("/"));
    if (!hits?.length) continue;
    if (hits.length === 1) return { status: "found", file: hits[0]!, how: k === segs.length - 1 ? "exact" : "end" };
    return { status: "ambiguous", candidates: hits.slice(0, 10) };
  }
  const last = segs[segs.length - 1]!;
  if (!/\.[a-z0-9]{1,6}$/i.test(last)) {
    const hits = index.byStem.get(last);
    if (hits?.length === 1) return { status: "found", file: hits[0]!, how: "name" };
    if (hits && hits.length > 1) return { status: "ambiguous", candidates: hits.slice(0, 10) };
  }
  return { status: "missing" };
}

export type PathStyle = "links" | "full" | "relative";

/** How a spreadsheet writes its file references, judged by most of the values. */
export function pathStyle(values: string[]): PathStyle {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (vals.length === 0) return "relative";
  const links = vals.filter(isUrl).length;
  if (links / vals.length > 0.9) return "links";
  const full = vals.filter(isAbsolutePath).length;
  if (full / vals.length > 0.9) return "full";
  return "relative";
}

/** Fields that can hold files, for choosing where each file column goes. */
export const fileFieldsOf = (fields: FieldInfo[], isAttachment: (f: FieldInfo) => boolean) =>
  fields.filter((f) => isAttachment(f) && f.active && !f.hidden);

const GENERIC = new Set(["form", "file", "files", "document", "documents", "doc", "docs", "path", "upload", "attachment", "attachments", "link", "url", "name", "the", "of", "copy", "scan", "scanned"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !GENERIC.has(w));
const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i;

/**
 * Which file field a spreadsheet column most likely belongs to: the field whose label shares
 * words with the header ("Consent document" → "Consent Form"), with picture columns preferring
 * Image fields. Falls back to `fallback`.
 */
export function guessFieldForColumn(
  sheet: Sheet,
  col: number,
  fields: { id: number; label: string; image: boolean }[],
  taken: Set<number>,
  fallback: number,
): number {
  const head = new Set(words(sheet.header[col] ?? ""));
  const vals = sheet.rows.slice(0, 200).map((r) => (r[col] ?? "").trim()).filter(Boolean);
  const pictures = vals.length > 0 && vals.filter((v) => IMAGE_EXT.test(v.split(/[?#]/)[0]!)).length / vals.length > 0.8;
  let best: { id: number; score: number } | null = null;
  for (const f of fields) {
    let score = words(f.label).filter((w) => head.has(w)).length * 2;
    if (pictures && f.image) score += 1;
    if (!pictures && f.image) score -= 1;
    if (taken.has(f.id)) score -= 0.5;
    if (score > 0 && score > (best?.score ?? 0)) best = { id: f.id, score };
  }
  return best?.id ?? fallback;
}
