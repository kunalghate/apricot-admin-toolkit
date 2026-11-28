// Runs: long upload jobs executed by the local server, not the browser tab.
//  - Every finished file is written to disk immediately (results.jsonl), so a run survives
//    a closed tab, a crash, or a restart, and never uploads the same file twice.
//  - Before each upload the record is re-read. If it already holds this exact file, the item
//    counts as done, which makes re-running a whole batch safe.
//  - Problems that affect everything (Apricot down, credentials revoked, file server gone)
//    pause the run instead of failing thousands of files.

import { join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dataDir } from "./config";
import { ApricotError, attachedFile } from "./apricot";
import { clientFor } from "./clients";
import { getConnection } from "./store";
import { holdAwake, releaseAwake } from "./awake";
import { cleanStaging, FileError, readFile, removeStage } from "./files";
import { fileExtension, fileTypeRisk, isImageFile, MAX_UPLOAD_BYTES } from "../shared/fields";
import type { AttachedFile, ItemResult, ItemStatus, JobItem, JobItemView, JobSpec, JobState, JobSummary } from "../shared/types";

const CONCURRENCY = 4;
/** After this many problems in a row that look like "everything is broken", pause. */
const SYSTEMIC_LIMIT = 4;
/** After such a pause, try again by itself: 1, 2, 5, 10, then every 15 minutes, for up to 3 hours. */
const AUTO_RESUME_MINUTES = [1, 2, 5, 10, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15];

const runsDir = () => {
  const d = join(dataDir(), "runs");
  mkdirSync(d, { recursive: true });
  return d;
};

interface Meta {
  id: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  state: JobState;
  pausedReason: JobSummary["pausedReason"];
  pauseMessage?: string;
  autoResumeAt?: string | null;
  connectionName: string;
  environment: JobSummary["environment"];
}

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The record already holds this exact file (same name, and same size when both are known). */
function sameFile(existing: AttachedFile, name: string, size: number | null) {
  if (simplify(existing.filename) !== simplify(name)) return false;
  return existing.size == null || size == null || existing.size === size;
}

/** A failure that isn't about this one file: retry it later and count towards pausing. */
class Systemic extends Error {}

function classify(err: unknown): { systemic: boolean; message: string; rejectedType?: boolean } {
  if (err instanceof Systemic) return { systemic: true, message: err.message };
  if (err instanceof ApricotError) {
    const systemic = err.status === 0 || err.status === 401 || err.status >= 500 || err.status === 429;
    return { systemic, message: err.message, rejectedType: /file type/i.test(err.detail) };
  }
  if (err instanceof FileError) {
    return { systemic: err.code === "unreachable" || err.code === "missing_secret", message: err.message };
  }
  return { systemic: true, message: err instanceof Error ? err.message : String(err) };
}

class Job {
  results = new Map<number, ItemResult>();
  inProgress = new Set<number>();
  private completions: number[] = [];
  private rejectedExts = new Set<string>();
  private generation = 0;
  private runner: Promise<void> | null = null;
  private errorPauses = 0;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public meta: Meta,
    public spec: JobSpec,
  ) {}

  get dir() {
    return join(runsDir(), this.meta.id);
  }

  saveMeta() {
    writeFileSync(join(this.dir, "run.json"), JSON.stringify({ meta: this.meta, spec: this.spec }));
  }

  private record(r: ItemResult) {
    this.results.set(r.n, r);
    appendFileSync(join(this.dir, "results.jsonl"), `${JSON.stringify(r)}\n`);
    this.completions.push(Date.now());
    if (this.completions.length > 60) this.completions.shift();
  }

  private rewriteResults() {
    writeFileSync(join(this.dir, "results.jsonl"), [...this.results.values()].map((r) => `${JSON.stringify(r)}\n`).join(""));
  }

  summary(): JobSummary {
    const counts: Record<ItemStatus, number> = { verified: 0, already: 0, skipped: 0, not_verified: 0, failed: 0 };
    for (const r of this.results.values()) counts[r.status]++;
    const remaining = this.spec.items.length - this.results.size;
    let perMinute: number | null = null;
    let etaSeconds: number | null = null;
    const c = this.completions;
    if (this.meta.state === "running" && c.length >= 3) {
      const minutes = (Date.now() - c[0]!) / 60_000;
      if (minutes > 0) {
        perMinute = (c.length - 1) / minutes;
        etaSeconds = perMinute > 0 ? Math.round((remaining / perMinute) * 60) : null;
      }
    }
    return {
      id: this.meta.id,
      createdAt: this.meta.createdAt,
      startedAt: this.meta.startedAt,
      finishedAt: this.meta.finishedAt,
      state: this.meta.state,
      pausedReason: this.meta.pausedReason,
      pauseMessage: this.meta.pauseMessage,
      autoResumeAt: this.meta.state === "paused" ? (this.meta.autoResumeAt ?? null) : null,
      connectionId: this.spec.connectionId,
      connectionName: this.meta.connectionName,
      environment: this.meta.environment,
      formName: this.spec.formName,
      locationLabel: this.spec.locationLabel,
      replaceExisting: this.spec.replaceExisting,
      total: this.spec.items.length,
      counts,
      inProgress: this.inProgress.size,
      perMinute,
      etaSeconds,
    };
  }

  items(filter: string, offset: number, limit: number): { total: number; items: JobItemView[] } {
    const label = new Map(this.spec.fields.map((f) => [f.id, f.label]));
    const pick = (it: JobItem) => {
      const r = this.results.get(it.n);
      switch (filter) {
        case "problems":
          return !!r && (r.status === "failed" || r.status === "not_verified");
        case "skipped":
          return !!r && r.status === "skipped";
        case "done":
          return !!r && (r.status === "verified" || r.status === "already");
        case "pending":
          return !r;
        case "recent":
          return !!r;
        default:
          return true;
      }
    };
    let list = this.spec.items.filter(pick);
    if (filter === "recent") list = list.sort((a, b) => (this.results.get(b.n)!.at < this.results.get(a.n)!.at ? -1 : 1));
    return {
      total: list.length,
      items: list.slice(offset, offset + limit).map((it) => ({
        ...it,
        result: this.results.get(it.n) ?? null,
        fieldLabel: label.get(it.fieldId) ?? `Field ${it.fieldId}`,
      })),
    };
  }

  /** Start or resume. `limit` = only do this many more, then pause (the "try a few first" option). */
  async start(limit?: number) {
    if (this.meta.state === "done") return;
    if (this.runner) {
      // A pause is still finishing its last few files: wait, then go again.
      this.generation++;
      await this.runner;
    }
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.meta.state = "running";
    this.meta.pausedReason = null;
    this.meta.pauseMessage = undefined;
    this.meta.autoResumeAt = null;
    this.meta.startedAt ??= new Date().toISOString();
    this.saveMeta();
    this.runner = this.loop(limit).finally(() => (this.runner = null));
  }

  pause(reason: "user" | "error" | "trial" = "user", message?: string) {
    if (this.meta.state !== "running") return;
    this.generation++;
    this.meta.state = "paused";
    this.meta.pausedReason = reason;
    this.meta.pauseMessage = message;
    this.meta.autoResumeAt = null;
    if (reason === "error") {
      // Outages are usually short. Try again by itself, so an overnight run doesn't wait for morning.
      const minutes = AUTO_RESUME_MINUTES[this.errorPauses++];
      if (minutes != null) {
        this.meta.autoResumeAt = new Date(Date.now() + minutes * 60_000).toISOString();
        this.autoTimer = setTimeout(() => {
          if (this.meta.state === "paused" && this.meta.pausedReason === "error") this.start().catch(() => {});
        }, minutes * 60_000);
      }
    } else {
      this.errorPauses = 0;
    }
    this.saveMeta();
  }

  /** Put problem files back in the queue and run them again. */
  async retryProblems() {
    for (const [n, r] of this.results) {
      if (r.status === "failed" || r.status === "not_verified" || (r.status === "skipped" && (r.code === "rejected_type" || r.message?.startsWith("Apricot rejected")))) {
        this.results.delete(n);
      }
    }
    this.rejectedExts.clear();
    this.rewriteResults();
    this.meta.state = "paused";
    this.meta.finishedAt = null;
    await this.start();
  }

  private async loop(limit?: number) {
    const gen = this.generation;
    const queue = this.spec.items.filter((it) => !this.results.has(it.n) && !this.inProgress.has(it.n));
    let next = 0;
    let started = 0;
    let systemicInRow = 0;
    const attempts = new Map<number, number>();
    // Never work on the same record twice at once. Verified live (2026-11-26): two simultaneous
    // uploads into different fields of one record both return 200, but one of the files is lost.
    const taken = new Set<number>();
    const busyRecords = new Set<number>();
    const pick = (): JobItem | "wait" | null => {
      while (next < queue.length && taken.has(next)) next++;
      if (next >= queue.length) return null;
      for (let i = next; i < queue.length; i++) {
        if (taken.has(i) || busyRecords.has(queue[i]!.recordId)) continue;
        taken.add(i);
        return queue[i]!;
      }
      return "wait"; // everything left is for a record another upload is busy with
    };
    holdAwake();
    const worker = async () => {
      while (this.generation === gen && this.meta.state === "running") {
        if (limit != null && started >= limit) return;
        const item = pick();
        if (!item) return;
        if (item === "wait") {
          await Bun.sleep(150);
          continue;
        }
        started++;
        this.inProgress.add(item.n);
        busyRecords.add(item.recordId);
        try {
          const r = await this.process(item);
          this.record(r);
          systemicInRow = 0;
          this.errorPauses = 0;
        } catch (err) {
          const c = classify(err);
          const tries = (attempts.get(item.n) ?? 0) + 1;
          attempts.set(item.n, tries);
          if (!c.systemic || tries >= 3) {
            // About this file only, or it keeps failing on its own: record it and move on.
            this.record({ n: item.n, status: "failed", message: c.message, at: new Date().toISOString() });
            if (!c.systemic) systemicInRow = 0;
            continue;
          }
          // Leave it unrecorded so it's tried again on resume, and give it another go later in this run.
          queue.push(item);
          started--;
          if (++systemicInRow >= SYSTEMIC_LIMIT) {
            this.pause("error", c.message);
          } else {
            await Bun.sleep(3000 * systemicInRow);
          }
        } finally {
          this.inProgress.delete(item.n);
          busyRecords.delete(item.recordId);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      releaseAwake();
    }
    if (this.meta.state !== "running" || this.generation !== gen) return;
    if (this.results.size >= this.spec.items.length) {
      this.meta.state = "done";
      this.meta.finishedAt = new Date().toISOString();
      this.saveMeta();
      this.cleanupIfFinished();
    } else if (limit != null) {
      this.pause("trial");
    } else {
      // Items were pushed back and the queue ran dry while they waited.
      this.meta.state = "paused";
      this.meta.pausedReason = "error";
      this.meta.pauseMessage ??= "The toolkit did not complete some files. Continue the upload to do these files again.";
      this.saveMeta();
    }
  }

  /** Dropped-file copies are deleted once every file is safely attached. */
  private cleanupIfFinished() {
    const s = this.summary();
    if (s.counts.failed + s.counts.not_verified > 0) return;
    for (const id of stagesOf(this.spec)) {
      try {
        removeStage(id);
      } catch {}
    }
  }

  private async process(item: JobItem): Promise<ItemResult> {
    const at = () => new Date().toISOString();
    const done = (status: ItemStatus, message?: string, file?: AttachedFile, code?: ItemResult["code"]): ItemResult => ({ n: item.n, status, message, code, file, at: at() });
    const field = this.spec.fields.find((f) => f.id === item.fieldId);
    const ext = fileExtension(item.name);

    if (ext && this.rejectedExts.has(ext)) return done("skipped", `Apricot did not accept .${ext} files before in this upload. The toolkit did not upload this file.`, undefined, "rejected_type");
    if (fileTypeRisk(item.name) === "blocked") return done("failed", "The toolkit does not attach program files, for example .exe files.");
    if (field?.imageOnly && !isImageFile(item.name)) return done("failed", "This is an image field. It accepts only pictures.");
    if (item.size != null && item.size > MAX_UPLOAD_BYTES) return done("failed", "This file is larger than the 10 MB limit.");

    const c = await clientFor(this.spec.connectionId);

    // 1. Look at the record as it is right now.
    const rec = await c.getRecord(item.recordId);
    if (!rec) return done("failed", "The record does not exist now, or this Apricot user cannot see it.");
    if (Number(rec.attributes.form_id) !== this.spec.formId) return done("failed", "This record is on a different form.");
    const existing = attachedFile(rec.attributes, item.fieldId);
    if (existing && sameFile(existing, item.name, item.size)) return done("already", "The record already has this file.", existing);
    if (existing && !this.spec.replaceExisting)
      return done("skipped", `The record already has "${existing.filename}". The toolkit did not replace it.`, existing);

    // 2. Get the file.
    let blob: Blob;
    let name = item.name;
    try {
      const f = await readFile(this.spec.locations?.[item.loc ?? 0] ?? this.spec.location, item.path);
      blob = f.blob;
      // Web links often end in an ID; prefer the server's file name when ours has no extension.
      if (!fileExtension(name) && fileExtension(f.name)) name = f.name;
    } catch (err) {
      const k = classify(err);
      if (k.systemic) throw new Systemic(k.message);
      return done("failed", k.message);
    }
    if (blob.size > MAX_UPLOAD_BYTES) return done("failed", "This file is larger than the 10 MB limit.");
    if (blob.size === 0) return done("failed", "This file is empty (0 bytes).");

    // 3. Upload.
    try {
      await c.uploadAttachment(item.recordId, item.fieldId, blob, name);
    } catch (err) {
      const k = classify(err);
      if (k.systemic) throw new Systemic(k.message);
      if (k.rejectedType && ext) this.rejectedExts.add(ext);
      return done("failed", k.message);
    }

    // 4. Read it back to prove it's there.
    const after = attachedFile((await c.getRecord(item.recordId))?.attributes, item.fieldId);
    if (!after) return done("not_verified", "Apricot accepted the upload, but the file is not on the record.");
    if (simplify(after.filename) === simplify(name) || (after.size != null && after.size === blob.size)) return done("verified", undefined, after);
    return done("not_verified", `Apricot accepted the upload, but the record shows "${after.filename}".`, after);
  }
}

/** Folders of dragged-in files a run reads from. */
const stagesOf = (spec: JobSpec) =>
  [spec.location, ...(spec.locations ?? [])].flatMap((l) => (l.kind === "dropped" ? [l.stageId] : []));

// ── Registry ─────────────────────────────────────────────────────────────────

const jobs = new Map<string, Job>();

/** Load saved runs at startup. Anything that was running when the app stopped is "interrupted". */
export function loadJobs() {
  for (const id of readdirSync(runsDir())) {
    const file = join(runsDir(), id, "run.json");
    if (!existsSync(file)) continue;
    try {
      const { meta, spec } = JSON.parse(readFileSync(file, "utf8")) as { meta: Meta; spec: JobSpec };
      const job = new Job(meta, spec);
      const resultsFile = join(runsDir(), id, "results.jsonl");
      if (existsSync(resultsFile)) {
        for (const line of readFileSync(resultsFile, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line) as ItemResult;
            job.results.set(r.n, r);
          } catch {
            // A half-written last line from a crash: ignore it, that file gets redone.
          }
        }
      }
      if (meta.state === "running" || (meta.state === "paused" && meta.pausedReason === "error")) {
        job.meta.state = "interrupted";
        job.meta.autoResumeAt = null;
        job.saveMeta();
      }
      jobs.set(id, job);
    } catch (err) {
      console.warn(`  The toolkit cannot read the saved upload ${id}:`, err);
    }
  }
  const keep = new Set([...jobs.values()].filter((j) => j.meta.state !== "done").flatMap((j) => stagesOf(j.spec)));
  try {
    cleanStaging(keep);
  } catch {}
}

export function createJob(spec: JobSpec): JobSummary {
  const conn = getConnection(spec.connectionId);
  if (!conn) throw new FileError("This connection does not exist now.");
  if (spec.items.length === 0) throw new FileError("There are no files to upload.");
  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const meta: Meta = {
    id,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    state: "ready",
    pausedReason: null,
    connectionName: conn.name,
    environment: conn.environment,
  };
  const items = spec.items.map((it, n) => ({ ...it, n }));
  const job = new Job(meta, { ...spec, items });
  mkdirSync(job.dir, { recursive: true });
  job.saveMeta();
  jobs.set(id, job);
  return job.summary();
}

export const getJob = (id: string) => jobs.get(id);

export function listJobs(): JobSummary[] {
  return [...jobs.values()].map((j) => j.summary()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function deleteJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.meta.state === "running") throw new FileError("Stop the upload before you remove it.");
  jobs.delete(id);
  for (const id of stagesOf(job.spec)) {
    try {
      removeStage(id);
    } catch {}
  }
  rmSync(job.dir, { recursive: true, force: true });
}

export const anyRunning = () => [...jobs.values()].some((j) => j.meta.state === "running");
