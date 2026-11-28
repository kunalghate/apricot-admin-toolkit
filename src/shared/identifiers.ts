// What a user can identify records by, and how values are normalized before lookup.
// Verified live (2026-11-25):
//  - Several filter[...] params on GET /records combine with AND.
//  - Name fields filter by part: field_<id>_first / field_<id>_last (case-insensitive).
//    Filtering on the bare name field (field_<id>) is silently ignored, so never do it.
//  - Date fields are stored and filtered as YYYY-MM-DD only.

import { FIELD_TYPE, SIMPLE_VALUE_TYPES } from "./fields";
import type { FieldInfo } from "./types";

export interface IdentifierOption {
  /** Attribute key used for filtering and comparing, e.g. "field_1856" or "field_198_last". */
  key: string;
  fieldId: number;
  label: string;
  kind: "text" | "date";
}

const DATE_TYPE = 17;

export function identifierOptions(fields: FieldInfo[]): IdentifierOption[] {
  const out: IdentifierOption[] = [];
  for (const f of [...fields].sort((a, b) => a.order - b.order)) {
    if (!f.active || f.hidden) continue;
    if (f.typeId === FIELD_TYPE.NAME) {
      out.push({ key: `field_${f.id}_first`, fieldId: f.id, label: `${f.label}: first name`, kind: "text" });
      out.push({ key: `field_${f.id}_last`, fieldId: f.id, label: `${f.label}: last name`, kind: "text" });
    } else if (SIMPLE_VALUE_TYPES.has(f.typeId)) {
      out.push({ key: `field_${f.id}`, fieldId: f.id, label: f.label, kind: f.typeId === DATE_TYPE ? "date" : "text" });
    }
  }
  return out;
}

/** Accepts common date spellings and returns YYYY-MM-DD, or null if it isn't a date. US order for xx/xx/yyyy. */
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 02/31
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Normalize one identifier value. Returns null when it can't be used (e.g. not a valid date). */
export function normalizeValue(value: string, kind: IdentifierOption["kind"]): string | null {
  const v = value.trim();
  if (!v) return null;
  return kind === "date" ? normalizeDate(v) : v;
}

/** Compare a stored attribute with a looked-up value. */
export function sameValue(stored: unknown, wanted: string, kind: IdentifierOption["kind"]): boolean {
  const s = String(stored ?? "").trim();
  if (kind === "date") return s.slice(0, 10) === wanted;
  return s.toLowerCase() === wanted.toLowerCase();
}

/** Join composite values into one map key / display string. */
export const KEY_SEP = "\u001f";
export const joinKey = (values: string[]) => values.join(KEY_SEP);
export const displayKey = (values: string[]) => values.join(" + ");
