// Local API used by the web page. Only reachable from this computer.

import { APP_NAME, PORT, VERSION } from "./config";
import { ApricotClient, ApricotError, fetchToken } from "./apricot";
import { addConnection, listConnections, removeConnection } from "./store";
import { clientFor, forgetClient, HttpError, pool } from "./clients";
import { browse, places, statPaths } from "./files/computer";
import { FileError, scanLocation, stageFile } from "./files";
import { addServer, browseServer, listServers, normalizeSettings, removeServer, testServer, type ServerCredentials } from "./files/servers";
import { createJob, deleteJob, getJob, listJobs } from "./jobs";
import type { Environment, FileLocation, FileRef, JobSpec, MatchBy, MatchResult } from "../shared/types";
import { joinKey } from "../shared/identifiers";

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));

const json = (data: unknown, status = 200) => Response.json(data, { status });

type Req = Request & { params: Record<string, string | undefined> };

function param(req: Req, name: string): string {
  const v = req.params[name];
  if (!v) throw new HttpError(400, `The request does not have the value "${name}".`);
  return v;
}

/**
 * Wraps every API handler with:
 *  - Host check (blocks DNS-rebinding tricks from other websites)
 *  - Custom header + Origin check (blocks other websites from calling this API)
 *  - Friendly JSON errors
 */
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
      if (err instanceof FileError) return json({ error: err.message }, 400);
      if (err instanceof ApricotError) return json({ error: err.message, status: err.status }, 502);
      console.error(err);
      return json({ error: "An error occurred in the toolkit. Do the step again." }, 500);
    }
  };
}

// ── Folder scans run in the background, so huge network folders don't time out ──

interface Scan {
  count: number;
  done: boolean;
  error?: string;
  result?: { files: FileRef[]; truncated: boolean };
  at: number;
}
const scans = new Map<string, Scan>();
setInterval(() => {
  for (const [id, s] of scans) if (Date.now() - s.at > 30 * 60_000) scans.delete(id);
}, 60_000).unref?.();

function validLocation(loc: FileLocation | undefined): FileLocation {
  if (!loc || typeof loc !== "object") throw new HttpError(400, "Select the location of the files.");
  switch (loc.kind) {
    case "computer":
      return { kind: "computer", root: String(loc.root ?? "") };
    case "zip":
      return { kind: "zip", file: String(loc.file) };
    case "dropped":
      return { kind: "dropped", stageId: String(loc.stageId) };
    case "server":
      return { kind: "server", serverId: String(loc.serverId), root: String(loc.root ?? "") };
    case "web":
      return { kind: "web" };
    default:
      throw new HttpError(400, "The toolkit does not know this type of location.");
  }
}

function runOr404(req: Req) {
  const job = getJob(param(req, "id"));
  if (!job) throw new HttpError(404, "This upload does not exist now.");
  return job;
}

export const routes = {
  "/api/app": {
    GET: api(() => json({ name: APP_NAME, version: VERSION, platform: process.platform })),
  },

  // ── Apricot connections ──

  "/api/connections": {
    GET: api(() => json(listConnections())),
    POST: api(async (req) => {
      const body = (await req.json()) as { name?: string; environment?: Environment; clientId?: string; clientSecret?: string };
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
      forgetClient(param(req, "id"));
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
      const body = (await req.json()) as { formId: number; fileFieldIds: number[]; matchBy: MatchBy; keys: string[][] };
      const formId = Number(body.formId);
      const fileFieldIds = (body.fileFieldIds ?? []).map(Number).filter(Boolean);
      const fields = await c.fields(formId);
      const seen = new Set<string>();
      const tuples = (body.keys ?? [])
        .map((t) => t.map((v) => String(v).trim()))
        .filter((t) => t.length > 0 && t.every(Boolean) && !seen.has(joinKey(t)) && seen.add(joinKey(t)));
      if (tuples.length > 500) throw new HttpError(400, "The toolkit can find a maximum of 500 records at one time.");
      const matchBy = body.matchBy;
      if (matchBy.kind === "fields" && (matchBy.keys.length === 0 || matchBy.keys.some((k) => !/^field_\d+(_first|_last)?$/.test(k.key))))
        throw new HttpError(400, "Select the fields that identify the records.");

      const results = await pool(tuples, 8, async (values): Promise<MatchResult> => {
        const key = joinKey(values);
        try {
          if (matchBy.kind === "record_id") {
            const id = values[0]!;
            if (!/^\d+$/.test(id)) return { key, status: "not_found" };
            const rec = await c.getRecord(Number(id));
            if (!rec || Number(rec.attributes.form_id) !== formId) return { key, status: "not_found" };
            return { key, status: "found", record: await c.describe(fields, rec, fileFieldIds) };
          }
          const criteria = matchBy.keys.map((k, i) => ({ key: k.key, kind: k.kind, value: values[i] ?? "" }));
          const found = await c.findByFields(formId, criteria);
          if (found.length === 0) return { key, status: "not_found" };
          // The list endpoint leaves out attachment fields, so re-read each match on its own
          // to learn whether it already has a file.
          const recs = await Promise.all(found.slice(0, 10).map(async (r) => (await c.getRecord(r.id)) ?? r));
          const matches = await Promise.all(recs.map((r) => c.describe(fields, r, fileFieldIds)));
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
      const fileFieldIds = (url.searchParams.get("fileFieldIds") ?? "").split(",").map(Number).filter(Boolean);
      const rec = await c.getRecord(Number(param(req, "rid")));
      if (!rec) throw new HttpError(404, "There is no record with this record ID, or this Apricot user cannot see it.");
      if (Number(rec.attributes.form_id) !== formId) throw new HttpError(400, "This record is on a different form.");
      return json(await c.describe(await c.fields(formId), rec, fileFieldIds));
    }),
  },

  // ── Files: this computer ──

  "/api/files/places": {
    GET: api(async () => json(await places())),
  },

  "/api/files/browse": {
    POST: api(async (req) => {
      const body = (await req.json()) as { serverId?: string; dir: string };
      return json(body.serverId ? await browseServer(body.serverId, body.dir ?? "") : await browse(body.dir ?? ""));
    }),
  },

  /** Start listing every file in a location. Poll GET /api/files/scan/:id for progress. */
  "/api/files/scan": {
    POST: api(async (req) => {
      const { location } = (await req.json()) as { location: FileLocation };
      const loc = validLocation(location);
      const id = crypto.randomUUID();
      const s: Scan = { count: 0, done: false, at: Date.now() };
      scans.set(id, s);
      scanLocation(loc, (n) => (s.count = n))
        .then((r) => {
          s.result = r;
          s.count = r.files.length;
        })
        .catch((err) => (s.error = err instanceof FileError ? err.message : `The toolkit cannot find the files (${(err as Error).message}).`))
        .finally(() => {
          s.done = true;
          s.at = Date.now();
        });
      return json({ id });
    }),
  },

  "/api/files/scan/:id": {
    GET: api((req) => {
      const s = scans.get(param(req, "id"));
      if (!s) throw new HttpError(404, "The list of files is not available now. Select the folder again.");
      if (s.done) scans.delete(param(req, "id"));
      return json({ done: s.done, count: s.count, error: s.error, ...(s.done && s.result ? s.result : {}) });
    }),
  },

  /** Which of these full paths exist on this computer, and their sizes. */
  "/api/files/stat": {
    POST: api(async (req) => {
      const { paths } = (await req.json()) as { paths: string[] };
      if (!Array.isArray(paths) || paths.length > 5000) throw new HttpError(400, "Send a maximum of 5,000 paths at one time.");
      return json(await statPaths(paths.map(String)));
    }),
  },

  /** Copy one dragged-in file into the toolkit's folder, so a run doesn't depend on the page. */
  "/api/files/stage/:stageId": {
    POST: api(async (req) => {
      const form = await req.formData();
      const file = form.get("file");
      const path = String(form.get("path") ?? "");
      if (!(file instanceof Blob)) throw new HttpError(400, "The request does not have a file.");
      await stageFile(param(req, "stageId"), path, file);
      return json({ ok: true });
    }),
  },

  // ── Files: SFTP / FTP servers ──

  "/api/servers": {
    GET: api(() => json(listServers())),
    POST: api(async (req) => {
      const body = (await req.json()) as { name?: string; settings: Record<string, unknown>; credentials: ServerCredentials; hostKey?: string | null };
      const settings = normalizeSettings(body.settings ?? {});
      const name = body.name?.trim() || settings.host;
      return json(await addServer(name, settings, body.credentials ?? {}, body.hostKey ?? null), 201);
    }),
  },

  "/api/servers/test": {
    POST: api(async (req) => {
      const body = (await req.json()) as { settings: Record<string, unknown>; credentials: ServerCredentials };
      return json(await testServer(normalizeSettings(body.settings ?? {}), body.credentials ?? {}));
    }),
  },

  "/api/servers/:id": {
    DELETE: api(async (req) => {
      await removeServer(param(req, "id"));
      return json({ ok: true });
    }),
  },

  // ── Runs ──

  "/api/runs": {
    GET: api(() => json(listJobs())),
    POST: api(async (req) => {
      const spec = (await req.json()) as JobSpec;
      if (!Array.isArray(spec.items) || spec.items.length > 100_000) throw new HttpError(400, "An upload can have a maximum of 100,000 files.");
      const locations = Array.isArray(spec.locations) ? spec.locations.map(validLocation) : undefined;
      if (locations && spec.items.some((i) => (i.loc ?? 0) >= locations.length)) throw new HttpError(400, "A file refers to a location that the toolkit does not know.");
      return json(createJob({ ...spec, location: validLocation(spec.location), locations }), 201);
    }),
  },

  "/api/runs/:id": {
    GET: api((req) => json(runOr404(req).summary())),
    DELETE: api((req) => {
      deleteJob(param(req, "id"));
      return json({ ok: true });
    }),
  },

  "/api/runs/:id/items": {
    GET: api((req) => {
      const url = new URL(req.url);
      const filter = url.searchParams.get("filter") ?? "all";
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const limit = Math.min(100_000, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      return json(runOr404(req).items(filter, offset, limit));
    }),
  },

  "/api/runs/:id/start": {
    POST: api(async (req) => {
      const job = runOr404(req);
      const body = (await req.json().catch(() => ({}))) as { limit?: number };
      await job.start(body.limit && body.limit > 0 ? Number(body.limit) : undefined);
      return json(job.summary());
    }),
  },

  "/api/runs/:id/pause": {
    POST: api((req) => {
      const job = runOr404(req);
      job.pause("user");
      return json(job.summary());
    }),
  },

  "/api/runs/:id/retry": {
    POST: api(async (req) => {
      const job = runOr404(req);
      await job.retryProblems();
      return json(job.summary());
    }),
  },
};
