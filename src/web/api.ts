// Calls to the toolkit's local server. Never calls Apricot directly.
import type {
  BrowseResult, Connection, Environment, FieldInfo, FileLocation, FileRef, FileServer, FormSummary, JobItemView, JobSpec,
  JobSummary, MatchBy, MatchResult, Place, RecordMatch,
} from "../shared/types";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "x-toolkit": "1" } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("The toolkit does not answer. Start the toolkit from the Start menu or the Applications folder. Then refresh this page.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `The request failed (error ${res.status}).`);
  return data as T;
}

export interface ServerInput {
  name?: string;
  settings: { protocol: string; host: string; port?: number; username: string; auth: "password" | "key" };
  credentials: { password?: string; privateKey?: string; passphrase?: string };
  hostKey?: string | null;
}

export const api = {
  app: () => call<{ name: string; version: string; platform: string }>("GET", "/api/app"),
  connections: () => call<Connection[]>("GET", "/api/connections"),
  addConnection: (input: { name: string; environment: Environment; clientId: string; clientSecret: string }) =>
    call<Connection>("POST", "/api/connections", input),
  removeConnection: (id: string) => call<{ ok: true }>("DELETE", `/api/connections/${id}`),
  check: (cid: string) => call<{ ok: true; orgId: string | null }>("GET", `/api/c/${cid}/check`),
  forms: (cid: string) => call<FormSummary[]>("GET", `/api/c/${cid}/forms`),
  fields: (cid: string, formId: number) => call<FieldInfo[]>("GET", `/api/c/${cid}/forms/${formId}/fields`),
  match: (cid: string, body: { formId: number; fileFieldIds: number[]; matchBy: MatchBy; keys: string[][] }) =>
    call<MatchResult[]>("POST", `/api/c/${cid}/match`, body),
  record: (cid: string, recordId: number, formId: number, fileFieldIds: number[]) =>
    call<RecordMatch>("GET", `/api/c/${cid}/records/${recordId}?formId=${formId}&fileFieldIds=${fileFieldIds.join(",")}`),

  // Files
  places: () => call<Place[]>("GET", "/api/files/places"),
  browse: (dir: string, serverId?: string) => call<BrowseResult>("POST", "/api/files/browse", { dir, serverId }),
  startScan: (location: FileLocation) => call<{ id: string }>("POST", "/api/files/scan", { location }),
  scanStatus: (id: string) =>
    call<{ done: boolean; count: number; error?: string; files?: FileRef[]; truncated?: boolean }>("GET", `/api/files/scan/${id}`),
  stat: (paths: string[]) => call<(number | null)[]>("POST", "/api/files/stat", { paths }),
  stage: (stageId: string, file: File, path: string) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("path", path);
    return call<{ ok: true }>("POST", `/api/files/stage/${stageId}`, fd);
  },

  // SFTP / FTP servers
  servers: () => call<FileServer[]>("GET", "/api/servers"),
  testServer: (input: ServerInput) => call<{ hostKey: string | null; home: string }>("POST", "/api/servers/test", input),
  addServer: (input: ServerInput) => call<FileServer>("POST", "/api/servers", input),
  removeServer: (id: string) => call<{ ok: true }>("DELETE", `/api/servers/${id}`),

  // Runs
  runs: () => call<JobSummary[]>("GET", "/api/runs"),
  run: (id: string) => call<JobSummary>("GET", `/api/runs/${id}`),
  createRun: (spec: JobSpec) => call<JobSummary>("POST", "/api/runs", spec),
  startRun: (id: string, limit?: number) => call<JobSummary>("POST", `/api/runs/${id}/start`, { limit }),
  pauseRun: (id: string) => call<JobSummary>("POST", `/api/runs/${id}/pause`, {}),
  retryRun: (id: string) => call<JobSummary>("POST", `/api/runs/${id}/retry`, {}),
  deleteRun: (id: string) => call<{ ok: true }>("DELETE", `/api/runs/${id}`),
  runItems: (id: string, filter: string, offset = 0, limit = 100) =>
    call<{ total: number; items: JobItemView[] }>("GET", `/api/runs/${id}/items?filter=${filter}&offset=${offset}&limit=${limit}`),
};

/** List every file in a location, reporting progress while the local server walks the folders. */
export async function scanFiles(location: FileLocation, onProgress: (n: number) => void): Promise<{ files: FileRef[]; truncated: boolean }> {
  const { id } = await api.startScan(location);
  for (let wait = 200; ; wait = Math.min(1000, wait + 200)) {
    await new Promise((r) => setTimeout(r, wait));
    const s = await api.scanStatus(id);
    onProgress(s.count);
    if (s.done) {
      if (s.error) throw new Error(s.error);
      return { files: s.files ?? [], truncated: !!s.truncated };
    }
  }
}
