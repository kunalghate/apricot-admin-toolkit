// Calls to the toolkit's local server. Never calls Apricot directly.
import type {
  Connection, Environment, FieldInfo, FormSummary, MatchBy, MatchResult, RecordMatch, UploadOutcome,
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
    throw new Error("The toolkit isn't running. Start it again from your Start menu or Applications folder, then refresh this page.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  app: () => call<{ name: string; version: string }>("GET", "/api/app"),
  connections: () => call<Connection[]>("GET", "/api/connections"),
  addConnection: (input: { name: string; environment: Environment; clientId: string; clientSecret: string }) =>
    call<Connection>("POST", "/api/connections", input),
  removeConnection: (id: string) => call<{ ok: true }>("DELETE", `/api/connections/${id}`),
  check: (cid: string) => call<{ ok: true; orgId: string | null }>("GET", `/api/c/${cid}/check`),
  forms: (cid: string) => call<FormSummary[]>("GET", `/api/c/${cid}/forms`),
  fields: (cid: string, formId: number) => call<FieldInfo[]>("GET", `/api/c/${cid}/forms/${formId}/fields`),
  match: (cid: string, body: { formId: number; fileFieldId: number; matchBy: MatchBy; keys: string[][] }) =>
    call<MatchResult[]>("POST", `/api/c/${cid}/match`, body),
  record: (cid: string, recordId: number, formId: number, fileFieldId: number) =>
    call<RecordMatch>("GET", `/api/c/${cid}/records/${recordId}?formId=${formId}&fileFieldId=${fileFieldId}`),
  upload: (cid: string, file: File, recordId: number, fieldId: number) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("recordId", String(recordId));
    fd.append("fieldId", String(fieldId));
    return call<UploadOutcome>("POST", `/api/c/${cid}/upload`, fd);
  },
};
