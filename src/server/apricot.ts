// Thin client for the Bonterra v1 Apricot API.
// Everything here runs in the local server. The browser never sees tokens or secrets.

import { API_BASE, AUDIENCE, TOKEN_URL } from "./config";
import { FIELD_TYPE, isIdentifierCandidate } from "../shared/fields";
import type { AttachedFile, FieldInfo, FormSummary, RecordMatch } from "../shared/types";

export class ApricotError extends Error {
  constructor(
    public status: number,
    public detail: string,
    friendly: string,
  ) {
    super(friendly);
  }
}

/** Turn raw API errors into sentences a non-technical admin can act on. */
export function friendlyMessage(status: number, detail: string): string {
  const d = detail || "";
  if (/Unknown file type/i.test(d))
    return "Apricot didn't recognise this file type, or the file's extension doesn't match what's inside it.";
  const notAllowed = d.match(/File type (\S+) not allowed/i);
  if (notAllowed) return `Your Apricot organization doesn't allow this kind of file (${notAllowed[1]}).`;
  if (/attachment is requi/i.test(d))
    return "This form has a required attachment field that's empty on this record, so Apricot won't accept uploads until it's filled.";
  if (/Field is locked/i.test(d)) return "Apricot blocked the change because a locked field on this record has a value.";
  if (/Field is hidden/i.test(d)) return "Apricot blocked the change because of a hidden field on this record.";
  if (/Invalid Parent ID/i.test(d)) return "Apricot couldn't find the parent record this record belongs to.";
  if (status === 401) return "Apricot didn't accept these credentials. Check the Client ID and Client Secret.";
  if (status === 403)
    return "The Apricot user behind these credentials doesn't have permission for this. Check their access in Apricot.";
  if (status === 404) return "Not found, or the Apricot user behind these credentials can't see it.";
  if (status === 413) return "This file is over the Apricot API's 10 MB upload limit.";
  if (status === 429) return "Apricot is receiving too many requests. Waiting a moment usually fixes this.";
  if (status === 504 || status === 502 || status === 503) return "Apricot took too long to respond. Try again in a moment.";
  if (status === 0) return "Couldn't reach Apricot. Check your internet connection.";
  return d ? `Apricot said: ${d}` : `Apricot returned an unexpected error (${status}).`;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const e = j?.errors?.[0];
    return String(e?.detail || e?.title || j?.message || j?.error_description || j?.error || text);
  } catch {
    return text.slice(0, 300);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchToken(clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        audience: AUDIENCE,
      }),
    });
  } catch (err) {
    throw new ApricotError(0, String(err), friendlyMessage(0, ""));
  }
  if (!res.ok) {
    const detail = await readError(res);
    const status = res.status === 403 || res.status === 400 ? 401 : res.status;
    throw new ApricotError(res.status, detail, friendlyMessage(status, ""));
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new ApricotError(500, "no access_token", "Apricot didn't return an access token.");
  return { token: j.access_token, expiresIn: j.expires_in ?? 3600 };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

type Query = Record<string, string | number | undefined>;

function attrsOf(resource: any): Record<string, any> {
  const a = resource?.attributes;
  if (Array.isArray(a)) return a[0] ?? {};
  return a ?? {};
}

function firstResource(body: any): any | null {
  const d = body?.data;
  if (Array.isArray(d)) return d[0] ?? null;
  return d ?? null;
}

/**
 * The file currently in an attachment field, from a single-record GET.
 * Verified live (2026-11-25): Apricot returns field_<id>_name, _size, _timestamp and _link.
 * An empty field has _name "" and _size 0. The list endpoint omits these keys entirely,
 * so always read a single record when you need this.
 */
export function attachedFile(attributes: Record<string, any> | undefined, fieldId: number): AttachedFile | null {
  if (!attributes) return null;
  const name = attributes[`field_${fieldId}_name`];
  if (typeof name === "string" && name.trim()) {
    const size = Number(attributes[`field_${fieldId}_size`]);
    return { filename: name, size: Number.isFinite(size) ? size : null };
  }
  return parseAttached(attributes[`field_${fieldId}`]);
}

export function parseAttached(value: unknown): AttachedFile | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() ? { filename: value, size: null } : null;
  if (typeof value === "object") {
    const v = value as Record<string, any>;
    const filename = v.filename ?? v.name ?? v.file_name ?? v.original_name;
    if (filename) return { filename: String(filename), size: typeof v.size === "number" ? v.size : null };
  }
  return null;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

export class ApricotClient {
  private fieldCache = new Map<number, { at: number; fields: FieldInfo[] }>();

  constructor(
    private cacheKey: string,
    private clientId: string,
    private clientSecret: string,
  ) {}

  async token(force = false): Promise<string> {
    const hit = tokenCache.get(this.cacheKey);
    if (!force && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
    const { token, expiresIn } = await fetchToken(this.clientId, this.clientSecret);
    tokenCache.set(this.cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  /** Core request with token refresh and retry on transient failures. */
  async request(
    method: string,
    path: string,
    opts: { query?: Query; json?: unknown; form?: () => FormData; retries?: number } = {},
  ): Promise<any> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) qs.set(k, String(v));
    const url = `${API_BASE}/v1/apricot${path}${qs.size ? `?${qs}` : ""}`;
    const maxRetries = opts.retries ?? 3;
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}` };
      let body: string | FormData | undefined;
      if (opts.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.json);
      } else if (opts.form) {
        body = opts.form(); // fresh FormData each attempt; fetch sets the multipart boundary
      }

      let res: Response;
      try {
        res = await fetch(url, { method, headers, body });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ApricotError(0, String(err), friendlyMessage(0, ""));
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.token(true);
        continue;
      }
      if ([429, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const detail = await readError(res);
        throw new ApricotError(res.status, detail, friendlyMessage(res.status, detail));
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }
  }

  /** Walk a paginated list endpoint. Falls back to a single call if paging params are rejected. */
  private async listAll(path: string, query: Query = {}): Promise<any[]> {
    const size = 100;
    const out: any[] = [];
    for (let page = 1; page <= 100; page++) {
      let body: any;
      try {
        body = await this.request("GET", path, { query: { ...query, "page[size]": size, "page[number]": page } });
      } catch (err) {
        if (page === 1 && err instanceof ApricotError && err.status === 400) {
          body = await this.request("GET", path, { query });
          return Array.isArray(body?.data) ? body.data : [];
        }
        throw err;
      }
      const data: any[] = Array.isArray(body?.data) ? body.data : [];
      out.push(...data);
      const meta = body?.meta ?? {};
      const totalPages = Number(meta["total-pages"] ?? meta.total_pages ?? meta.totalPages ?? 0);
      if (data.length < size || (totalPages && page >= totalPages)) break;
    }
    return out;
  }

  async userInfo(): Promise<{ orgId: string | null; label: string | null }> {
    const body = await this.request("GET", "/users/info");
    const a = attrsOf(firstResource(body));
    const name = [a.name_first ?? a.first_name, a.name_last ?? a.last_name].filter(Boolean).join(" ");
    return {
      orgId: a.org_id != null ? String(a.org_id) : null,
      label: name || a.username || a.email || null,
    };
  }

  async forms(): Promise<FormSummary[]> {
    const data = await this.listAll("/forms");
    return data
      .map((f) => {
        const a = attrsOf(f);
        return {
          id: Number(f.id),
          name: String(a.name ?? a.label ?? `Form ${f.id}`),
          parentFormId: Number(a.parent_id ?? 0) || 0,
          active: a.active ?? a.is_active ?? 1,
        };
      })
      .filter((f) => f.active !== 0 && f.active !== false)
      .map(({ active: _a, ...f }) => f)
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  async fields(formId: number): Promise<FieldInfo[]> {
    const hit = this.fieldCache.get(formId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.fields;
    const data = await this.listAll(`/forms/${formId}/fields`);
    const fields: FieldInfo[] = data.map((f) => {
      const a = attrsOf(f);
      const flag = (v: unknown) => v === 1 || v === true || v === "1";
      return {
        id: Number(f.id),
        label: String(a.label ?? `Field ${f.id}`),
        typeId: Number(a.field_type_id ?? a.field_type ?? 0),
        required: flag(a.is_required ?? a.required),
        active: a.active === undefined ? true : flag(a.active),
        hidden: flag(a.is_hidden),
        readonly: flag(a.is_readonly),
        sectionId: a.section_id != null ? Number(a.section_id) : null,
        order: Number(a.sort_order ?? a.order ?? 0),
      };
    });
    this.fieldCache.set(formId, { at: Date.now(), fields });
    return fields;
  }

  /** Returns the record's attributes, or null if it doesn't exist / isn't visible. */
  async getRecord(recordId: number): Promise<{ id: number; attributes: Record<string, any> } | null> {
    try {
      const body = await this.request("GET", `/records/${recordId}`);
      const r = firstResource(body);
      return r ? { id: Number(r.id), attributes: attrsOf(r) } : null;
    } catch (err) {
      if (err instanceof ApricotError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Records on a form whose field equals `value`. Uses the DB-backed field filter
   * (case-insensitive exact match). Results are re-checked here because the API
   * silently ignores filters on unknown fields.
   */
  async findByField(formId: number, fieldId: number, value: string) {
    const body = await this.request("GET", "/records", {
      query: { form_id: formId, [`filter[field_${fieldId}]`]: value, "page[size]": 25, "page[number]": 1 },
    });
    const data: any[] = Array.isArray(body?.data) ? body.data : [];
    return data
      .map((r) => ({ id: Number(r.id), attributes: attrsOf(r) }))
      .filter((r) => norm(r.attributes[`field_${fieldId}`]) === norm(value));
  }

  /** A short human label for a record, e.g. "Jane Doe", built from the form's fields. */
  recordLabel(fields: FieldInfo[], attributes: Record<string, any>, id: number): string {
    const sorted = [...fields].filter((f) => f.active).sort((a, b) => a.order - b.order);
    const nameField = sorted.find((f) => f.typeId === FIELD_TYPE.NAME);
    if (nameField) {
      const n = [attributes[`field_${nameField.id}_first`], attributes[`field_${nameField.id}_last`]]
        .filter((x) => x && String(x).trim())
        .join(" ");
      if (n) return n;
    }
    for (const f of sorted) {
      if (!isIdentifierCandidate(f)) continue;
      const v = attributes[`field_${f.id}`];
      if (v != null && String(v).trim()) return String(v).trim().slice(0, 60);
    }
    return `Record ${id}`;
  }

  private parentLabels = new Map<number, Promise<string | null>>();

  /** Label of a Tier 1 parent record (e.g. the person), cached. */
  private parentLabel(parentId: number): Promise<string | null> {
    let p = this.parentLabels.get(parentId);
    if (!p) {
      p = (async () => {
        const parent = await this.getRecord(parentId).catch(() => null);
        if (!parent) return null;
        const fields = await this.fields(Number(parent.attributes.form_id)).catch(() => []);
        return this.recordLabel(fields, parent.attributes, parentId);
      })();
      this.parentLabels.set(parentId, p);
    }
    return p;
  }

  /** What the user sees for a record: "Jane Doe" or, for Tier 2 records, "Jane Doe · 2022-04-21". */
  async describe(fields: FieldInfo[], rec: { id: number; attributes: Record<string, any> }, fileFieldId: number): Promise<RecordMatch> {
    let label = this.recordLabel(fields, rec.attributes, rec.id);
    const parentId = Number(rec.attributes.parent_id ?? 0);
    if (parentId > 0) {
      const parent = await this.parentLabel(parentId);
      if (parent) label = label.startsWith("Record ") ? parent : `${parent} · ${label}`;
    }
    return { id: rec.id, label, existingFile: attachedFile(rec.attributes, fileFieldId) };
  }

  /**
   * Upload one file into an attachment field on an existing record.
   * The multipart part MUST be named field_<id>. Any other name returns 200 but attaches nothing.
   */
  async uploadAttachment(recordId: number, fieldId: number, file: Blob, filename: string) {
    return this.request("POST", `/records/${recordId}/attachment/${fieldId}`, {
      form: () => {
        const fd = new FormData();
        fd.append(`field_${fieldId}`, file, filename);
        return fd;
      },
      retries: 2,
    });
  }
}
