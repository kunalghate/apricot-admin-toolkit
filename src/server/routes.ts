// Local API used by the web page. Only reachable from this computer.

import { APP_NAME, PORT, VERSION } from "./config";
import { ApricotClient, ApricotError, attachedFile, fetchToken } from "./apricot";
import { addConnection, getConnection, getSecret, listConnections, removeConnection } from "./store";
import type { Environment, MatchBy, MatchResult, UploadOutcome } from "../shared/types";
import { joinKey } from "../shared/identifiers";

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

/**
 * Wraps every API handler with:
 *  - Host check (blocks DNS-rebinding tricks from other websites)
 *  - Custom header + Origin check (blocks other websites from calling this API)
 *  - Friendly JSON errors
 */
type Req = Request & { params: Record<string, string | undefined> };

function param(req: Req, name: string): string {
  const v = req.params[name];
  if (!v) throw new HttpError(400, `Missing ${name}`);
  return v;
}

function api(handler: (req: Req) => Promise<Response> | Response) {
  return async (req: Req) => {
    const host = req.headers.get("host") ?? "";
    const origin = req.headers.get("origin");
    if (!ALLOWED_HOSTS.has(host)) return json({ error: "Forbidden host" }, 403);
    if (req.headers.get("x-toolkit") !== "1") return json({ error: "Forbidden" }, 403);
    if (req.method !== "GET" && (!origin || !ALLOWED_ORIGINS.has(origin))) return json({ error: "Forbidden origin" }, 403);
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof ApricotError) return json({ error: err.message, status: err.status }, 502);
      console.error(err);
      return json({ error: "Something went wrong inside the toolkit. Try again." }, 500);
    }
  };
}

const clients = new Map<string, ApricotClient>();

async function clientFor(connectionId: string): Promise<ApricotClient> {
  const cached = clients.get(connectionId);
  if (cached) return cached;
  const conn = getConnection(connectionId);
  if (!conn) throw new HttpError(404, "That connection no longer exists. Add it again on the Connections page.");
  const secret = await getSecret(connectionId);
  if (!secret) throw new HttpError(400, "The saved secret for this connection is missing. Remove it and add it again.");
  const client = new ApricotClient(connectionId, conn.clientId, secret);
  clients.set(connectionId, client);
  return client;
}

/** Run async work over items with a fixed number running at once. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const routes = {
  "/api/app": {
    GET: api(() => json({ name: APP_NAME, version: VERSION })),
  },

  "/api/connections": {
    GET: api(() => json(listConnections())),
    POST: api(async (req) => {
      const body = (await req.json()) as {
        name?: string;
        environment?: Environment;
        clientId?: string;
        clientSecret?: string;
      };
      const clientId = body.clientId?.trim();
      const clientSecret = body.clientSecret?.trim();
      const environment: Environment = body.environment === "production" ? "production" : "sandbox";
      if (!clientId || !clientSecret) throw new HttpError(400, "Enter both the Client ID and the Client Secret.");

      // Prove the credentials work before saving anything.
      await fetchToken(clientId, clientSecret);
      const probe = new ApricotClient(`probe-${crypto.randomUUID()}`, clientId, clientSecret);
      const info = await probe.userInfo().catch(() => ({ orgId: null, label: null }));

      const name = body.name?.trim() || (environment === "production" ? "Production" : "Sandbox");
      const conn = await addConnection({ name, environment, clientId, clientSecret, orgId: info.orgId, userLabel: info.label });
      return json(conn, 201);
    }),
  },

  "/api/connections/:id": {
    DELETE: api(async (req) => {
      clients.delete(param(req, "id"));
      await removeConnection(param(req, "id"));
      return json({ ok: true });
    }),
  },

  "/api/c/:cid/check": {
    GET: api(async (req) => {
      const c = await clientFor(param(req, "cid"));
      await c.token(true);
      return json({ ok: true, ...(await c.userInfo()) });
    }),
  },

  "/api/c/:cid/forms": {
    GET: api(async (req) => json(await (await clientFor(param(req, "cid"))).forms())),
  },

  "/api/c/:cid/forms/:fid/fields": {
    GET: api(async (req) => json(await (await clientFor(param(req, "cid"))).fields(Number(param(req, "fid"))))),
  },

  /** Look up which record each identifier (or composite of identifiers) belongs to. */
  "/api/c/:cid/match": {
    POST: api(async (req) => {
      const c = await clientFor(param(req, "cid"));
      const body = (await req.json()) as { formId: number; fileFieldId: number; matchBy: MatchBy; keys: string[][] };
      const formId = Number(body.formId);
      const fields = await c.fields(formId);
      const seen = new Set<string>();
      const tuples = (body.keys ?? [])
        .map((t) => t.map((v) => String(v).trim()))
        .filter((t) => t.length > 0 && t.every(Boolean) && !seen.has(joinKey(t)) && seen.add(joinKey(t)));
      if (tuples.length > 20_000) throw new HttpError(400, "That's a lot of files! Please do 20,000 or fewer at a time.");
      const matchBy = body.matchBy;
      if (matchBy.kind === "fields" && (matchBy.keys.length === 0 || matchBy.keys.some((k) => !/^field_\d+(_first|_last)?$/.test(k.key))))
        throw new HttpError(400, "Choose which fields identify the records.");

      const results = await pool(tuples, 6, async (values): Promise<MatchResult> => {
        const key = joinKey(values);
        try {
          if (matchBy.kind === "record_id") {
            const id = values[0]!;
            if (!/^\d+$/.test(id)) return { key, status: "not_found" };
            const rec = await c.getRecord(Number(id));
            if (!rec || Number(rec.attributes.form_id) !== formId) return { key, status: "not_found" };
            return { key, status: "found", record: await c.describe(fields, rec, body.fileFieldId) };
          }
          const criteria = matchBy.keys.map((k, i) => ({ key: k.key, kind: k.kind, value: values[i] ?? "" }));
          const found = await c.findByFields(formId, criteria);
          if (found.length === 0) return { key, status: "not_found" };
          // The list endpoint leaves out attachment fields, so re-read each match on its own
          // to learn whether it already has a file.
          const recs = await Promise.all(found.slice(0, 10).map(async (r) => (await c.getRecord(r.id)) ?? r));
          const matches = await Promise.all(recs.map((r) => c.describe(fields, r, body.fileFieldId)));
          if (matches.length === 1) return { key, status: "found", record: matches[0]! };
          return { key, status: "multiple", records: matches };
        } catch (err) {
          return { key, status: "error", message: err instanceof Error ? err.message : String(err) };
        }
      });
      return json(results);
    }),
  },

  /** Fetch one record for manual matching. */
  "/api/c/:cid/records/:rid": {
    GET: api(async (req) => {
      const c = await clientFor(param(req, "cid"));
      const url = new URL(req.url);
      const formId = Number(url.searchParams.get("formId"));
      const fileFieldId = Number(url.searchParams.get("fileFieldId"));
      const rec = await c.getRecord(Number(param(req, "rid")));
      if (!rec) throw new HttpError(404, "No record with that ID, or this user can't see it.");
      if (Number(rec.attributes.form_id) !== formId) throw new HttpError(400, "That record belongs to a different form.");
      return json(await c.describe(await c.fields(formId), rec, fileFieldId));
    }),
  },

  /** Upload one file, then read the record back to prove the file is really there. */
  "/api/c/:cid/upload": {
    POST: api(async (req) => {
      const c = await clientFor(param(req, "cid"));
      const form = await req.formData();
      const file = form.get("file");
      const recordId = Number(form.get("recordId"));
      const fieldId = Number(form.get("fieldId"));
      if (!(file instanceof Blob) || !recordId || !fieldId) throw new HttpError(400, "Missing file, record or field.");
      const filename = (file as File).name || String(form.get("filename") || "file");

      let outcome: UploadOutcome;
      try {
        await c.uploadAttachment(recordId, fieldId, file, filename);
        const rec = await c.getRecord(recordId);
        const after = attachedFile(rec?.attributes, fieldId);
        if (!after) {
          outcome = { status: "not_verified", message: "Apricot said the upload worked, but the file isn't showing on the record." };
        } else if (simplify(after.filename) === simplify(filename) || (after.size != null && after.size === file.size)) {
          outcome = { status: "verified", file: after };
        } else {
          outcome = {
            status: "not_verified",
            message: `Apricot said the upload worked, but the record shows "${after.filename}" instead.`,
          };
        }
      } catch (err) {
        if (err instanceof ApricotError) {
          const rejectedType = /file type/i.test(err.detail);
          outcome = { status: "failed", message: err.message, rejectedType };
        } else throw err;
      }
      return json(outcome);
    }),
  },
};
