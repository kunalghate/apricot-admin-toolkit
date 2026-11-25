// A stand-in for the Apricot API, for testing big runs without touching a real organization.
// Mimics the behaviour verified against the real API: the multipart part must be named
// field_<id>, single-record GETs show field_<id>_name/_size, the list endpoint omits them,
// several filter[...] params AND together, dates are YYYY-MM-DD.
//
//   bun tests/mock-apricot.ts            (listens on :4999, 5,000 records)
//   MOCK_RECORDS=20000 MOCK_LATENCY=150 bun tests/mock-apricot.ts
//
// Controls:  POST /__mock/outage?seconds=30   every API call returns 503 for a while
//            GET  /__mock/stats               uploads received, duplicates, etc.
//            POST /__mock/reset               forget all uploaded files

const PORT = Number(process.env.MOCK_PORT) || 4999;
const RECORDS = Number(process.env.MOCK_RECORDS) || 5000;
const LATENCY = Number(process.env.MOCK_LATENCY) || 120;
const ERROR_RATE = Number(process.env.MOCK_ERROR_RATE ?? 0.01); // 429s and 502s, which the client should retry
const FORM = 900;
const F = { name: 10, dob: 11, client: 12, consent: 20, intake: 21, photo: 22 };

const first = ["Jane", "Sam", "Maria", "Ahmed", "Li", "Olu", "Priya", "Tom", "Ana", "Kofi", "Mei", "Jose", "Fatima", "Ivan", "Grace"];
const last = ["Doe", "Lee", "Garcia", "Khan", "Wong", "Adeyemi", "Patel", "Smith", "Silva", "Mensah", "Chen", "Lopez", "Ali", "Petrov", "Okafor"];

export function mockPeople(n = RECORDS) {
  return Array.from({ length: n }, (_, i) => {
    const y = 1950 + (i % 55);
    const m = 1 + (i % 12);
    const d = 1 + (i % 28);
    return {
      id: 100_000 + i,
      first: first[i % first.length]!,
      last: `${last[Math.floor(i / first.length) % last.length]}${i >= 225 ? Math.floor(i / 225) : ""}`,
      dob: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      client: `C-${String(i + 1).padStart(5, "0")}`,
    };
  });
}

if (import.meta.main) {
  const people = new Map(mockPeople().map((p) => [p.id, p]));
  const files = new Map<string, { name: string; size: number }>(); // `${record}:${field}`
  const uploads = new Map<string, number>();
  let outageUntil = 0;
  let requests = 0;
  let maxConcurrent = 0;
  let concurrent = 0;

  const attrs = (id: number, withFiles: boolean) => {
    const p = people.get(id)!;
    const a: Record<string, unknown> = {
      form_id: FORM,
      parent_id: 0,
      [`field_${F.name}_first`]: p.first,
      [`field_${F.name}_last`]: p.last,
      [`field_${F.dob}`]: p.dob,
      [`field_${F.client}`]: p.client,
    };
    if (withFiles)
      for (const fid of [F.consent, F.intake, F.photo]) {
        const f = files.get(`${id}:${fid}`);
        a[`field_${fid}_name`] = f?.name ?? "";
        a[`field_${fid}_size`] = f?.size ?? 0;
      }
    return a;
  };

  const err = (status: number, detail: string) => Response.json({ errors: [{ status, detail }] }, { status });
  const field = (id: number, label: string, type: number, order: number) => ({ id, type: "fields", attributes: { label, field_type_id: type, active: 1, is_hidden: 0, sort_order: order } });

  Bun.serve({
    port: PORT,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/__mock/outage") {
        outageUntil = Date.now() + Number(url.searchParams.get("seconds") ?? 30) * 1000;
        return Response.json({ ok: true });
      }
      if (p === "/__mock/reset") {
        files.clear();
        uploads.clear();
        return Response.json({ ok: true });
      }
      if (p === "/__mock/stats") {
        const dup = [...uploads.values()].filter((n) => n > 1).length;
        return Response.json({ requests, maxConcurrent, attachedFiles: files.size, uploadCalls: [...uploads.values()].reduce((a, b) => a + b, 0), recordsWithRepeatUploads: dup });
      }

      requests++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        await Bun.sleep(LATENCY * (0.5 + Math.random()));
        if (Date.now() < outageUntil) return err(503, "Service Unavailable");
        if (p === "/v1/oauth/token") return Response.json({ access_token: `mock-${Date.now()}`, expires_in: 3600 });
        if (!req.headers.get("authorization")?.startsWith("Bearer mock-")) return err(401, "Unauthorized");
        if (Math.random() < ERROR_RATE) return Math.random() < 0.5 ? err(429, "Too Many Requests") : err(502, "Bad Gateway");

        if (p === "/v1/apricot/users/info") return Response.json({ data: [{ id: 1, attributes: { org_id: 9999, name_first: "Mock", name_last: "Admin" } }] });
        if (p === "/v1/apricot/forms") return Response.json({ data: [{ id: FORM, attributes: { name: "Mock Clients (test)", parent_id: 0, active: 1 } }], meta: { "total-pages": 1 } });
        if (p === `/v1/apricot/forms/${FORM}/fields`)
          return Response.json({
            data: [
              field(F.name, "Name", 5, 1),
              field(F.dob, "Date of Birth", 17, 2),
              field(F.client, "Client Number", 1, 3),
              field(F.consent, "Consent Form", 29, 4),
              field(F.intake, "Intake Form", 29, 5),
              field(F.photo, "Photo", 72, 6),
            ],
            meta: { "total-pages": 1 },
          });

        const one = p.match(/^\/v1\/apricot\/records\/(\d+)$/);
        if (one && req.method === "GET") {
          const id = Number(one[1]);
          if (!people.has(id)) return err(404, "Not found");
          return Response.json({ data: [{ id, type: "records", attributes: attrs(id, true) }] });
        }

        if (p === "/v1/apricot/records" && req.method === "GET") {
          const filters = [...url.searchParams].filter(([k]) => k.startsWith("filter[")).map(([k, v]) => [k.slice(7, -1), v.toLowerCase()] as const);
          const out = [];
          for (const id of people.keys()) {
            const a = attrs(id, false);
            if (filters.every(([k, v]) => String(a[k] ?? "").toLowerCase() === v)) out.push({ id, type: "records", attributes: a });
            if (out.length >= 25) break;
          }
          return Response.json({ data: out, meta: { count: out.length } });
        }

        const up = p.match(/^\/v1\/apricot\/records\/(\d+)\/attachment\/(\d+)$/);
        if (up && req.method === "POST") {
          const [id, fid] = [Number(up[1]), Number(up[2])];
          if (!people.has(id)) return err(404, "Not found");
          const form = await req.formData();
          const part = form.get(`field_${fid}`);
          if (!(part instanceof Blob)) return Response.json({ data: [] }); // like the real API: 200, nothing attached
          const name = (part as File).name;
          if (/\.(exe|heic)$/i.test(name)) return err(400, `FilesError: field_${fid} File type application/octet-stream not allowed`);
          if (part.size > 10_485_760) return err(413, "Request Entity Too Large");
          await Bun.sleep(part.size / 50_000); // ~50 KB/ms "network"
          files.set(`${id}:${fid}`, { name, size: part.size });
          uploads.set(`${id}:${fid}`, (uploads.get(`${id}:${fid}`) ?? 0) + 1);
          return Response.json({ data: [{ id, type: "records" }] });
        }
        return err(404, `Mock doesn't know ${req.method} ${p}`);
      } finally {
        concurrent--;
      }
    },
  });
  console.log(`Mock Apricot API on http://127.0.0.1:${PORT} with ${RECORDS} records (form ${FORM})`);
}
