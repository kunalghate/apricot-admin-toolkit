import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, CircleAlert, CirclePause, Download, FlaskConical, History, Loader2, Pause, Play, RotateCcw, Trash2, Upload,
} from "lucide-react";
import { api } from "../api";
import { Badge, Button, Callout, Card, cx, EnvBadge, PageHeader, plural, Progress, Spinner } from "../components/ui";
import { downloadSheet } from "../lib/sheets";
import { formatDuration } from "./attach/StepMatch";
import type { ItemStatus, JobItemView, JobSummary } from "../../shared/types";

export const runDone = (s: JobSummary) => Object.values(s.counts).reduce((a, b) => a + b, 0);
const problemsOf = (s: JobSummary) => s.counts.failed + s.counts.not_verified;

export function stateBadge(s: JobSummary) {
  if (s.state === "running") return <Badge tone="blue"><Loader2 className="size-3 animate-spin" /> In progress</Badge>;
  if (s.state === "interrupted") return <Badge tone="amber">Stopped</Badge>;
  if (s.state === "paused") return s.pausedReason === "error" ? <Badge tone="red">Stopped: problem</Badge> : s.pausedReason === "trial" ? <Badge tone="amber">Test complete</Badge> : <Badge tone="amber">Stopped</Badge>;
  if (s.state === "ready") return <Badge>Not started</Badge>;
  return problemsOf(s) ? <Badge tone="amber">Complete, with problems</Badge> : <Badge tone="green">Complete</Badge>;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// ── All runs ─────────────────────────────────────────────────────────────────

export function RunsPage({ open }: { open: (id: string) => void }) {
  const [runs, setRuns] = useState<JobSummary[] | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await api.runs().catch(() => null);
      if (r) setRuns(r);
      t = setTimeout(load, r?.some((x) => x.state === "running") ? 2000 : 8000);
    };
    load();
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="animate-fade-up">
      <PageHeader title="Uploads" subtitle="All uploads and their results. An upload continues when you close this page." />
      {!runs && <Spinner />}
      {runs?.length === 0 && (
        <Card className="p-10 text-center text-sm text-stone-500">
          <History className="size-8 mx-auto text-stone-300 mb-3" />
          There are no uploads. When you start an upload, it shows here.
        </Card>
      )}
      <div className="space-y-3">
        {runs?.map((r) => <RunCard key={r.id} run={r} onOpen={() => open(r.id)} />)}
      </div>
    </div>
  );
}

export function RunCard({ run: r, onOpen }: { run: JobSummary; onOpen: () => void }) {
  const done = runDone(r);
  return (
    <button onClick={onOpen} className="block w-full text-left cursor-pointer group">
      <Card className="p-5 transition group-hover:ring-brand-300 group-hover:shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-stone-900 truncate">{r.formName} <span className="font-normal text-stone-500">· {plural(r.total, "file")}</span></div>
            <div className="text-xs text-stone-500 mt-0.5 truncate">{when(r.createdAt)} · {r.connectionName} · from {r.locationLabel}</div>
          </div>
          <EnvBadge env={r.environment} />
          {stateBadge(r)}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><Progress value={(done / Math.max(1, r.total)) * 100} tone={r.state === "done" && !problemsOf(r) ? "green" : "apricot"} /></div>
          <span className="text-xs text-stone-500 tabular-nums w-28 text-right">{done.toLocaleString()} of {r.total.toLocaleString()}</span>
        </div>
      </Card>
    </button>
  );
}

// ── One run ──────────────────────────────────────────────────────────────────

type Tab = "problems" | "skipped" | "done" | "recent" | "pending";
const PAGE = 100;

export function RunPage({ id, onBack, onAttachMore }: { id: string; onBack: () => void; onAttachMore: () => void }) {
  const [run, setRun] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [items, setItems] = useState<{ total: number; items: JobItemView[] } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const lastKey = useRef("");

  // Poll: fast while running, slow otherwise.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const load = async () => {
      try {
        const s = await api.run(id);
        if (!alive) return;
        setRun(s);
        setError(null);
        t = setTimeout(load, s.state === "running" ? 1000 : 5000);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        t = setTimeout(load, 3000);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id]);

  const activeTab: Tab = tab ?? (run && problemsOf(run) ? "problems" : "recent");

  // Refresh the list when progress moves or the tab changes.
  useEffect(() => {
    if (!run) return;
    const key = `${activeTab}|${limit}|${runDone(run)}|${run.state}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    api.runItems(id, activeTab, 0, limit).then(setItems).catch(() => {});
  }, [run, activeTab, limit]);

  const act = async (name: string, fn: () => Promise<JobSummary>) => {
    setBusy(name);
    try {
      setRun(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const downloadReport = async () => {
    if (!run) return;
    setBusy("report");
    try {
      const all = await api.runItems(id, "all", 0, run.total);
      const sheetRows = all.items.some((i) => i.sheetRow);
      const label: Record<ItemStatus, string> = { verified: "Attached and verified", already: "Attached before", skipped: "Not uploaded", not_verified: "Not verified", failed: "Failed" };
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
      downloadSheet(
        `Upload report - ${run.formName} - ${stamp}.xlsx`,
        [...(sheetRows ? ["Spreadsheet row"] : []), "File", "Path", "Field", "Record ID", "Record", "Result", "Details", "Date and time"],
        all.items.map((i) => [
          ...(sheetRows ? [i.sheetRow ?? null] : []),
          i.name,
          i.path,
          i.fieldLabel,
          i.recordId,
          i.recordLabel,
          i.result ? label[i.result.status] : "Not uploaded yet",
          i.result?.message ?? (i.result?.file ? `The record shows "${i.result.file.filename}"` : ""),
          i.result ? when(i.result.at) : "",
        ]),
        [...(sheetRows ? [10] : []), 32, 40, 20, 12, 26, 16, 60, 20],
      );
    } finally {
      setBusy(null);
    }
  };

  if (!run) return error ? <Callout tone="red">{error}</Callout> : <Spinner label="Wait." />;

  const done = runDone(run);
  const remaining = run.total - done;
  const problems = problemsOf(run);
  const c = run.counts;
  const finishedClean = run.state === "done" && problems === 0;

  const title =
    run.state === "ready" ? `Ready to attach ${plural(run.total, "file")}`
    : run.state === "running" ? `Upload in progress: ${done.toLocaleString()} of ${run.total.toLocaleString()}`
    : run.state === "done" ? (problems ? `${(c.verified + c.already).toLocaleString()} attached · ${plural(problems, "file")} with problems` : run.total === 1 ? "The file is attached and verified" : `All ${(c.verified + c.already).toLocaleString()} files are attached and verified`)
    : run.pausedReason === "trial" ? `The test is complete: ${plural(done, "file")}. Examine the records in Apricot.`
    : `Stopped · ${done.toLocaleString()} of ${run.total.toLocaleString()} complete`;

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "problems", label: "Problems", n: problems },
    { id: "skipped", label: "Not uploaded", n: c.skipped },
    { id: "done", label: "Attached", n: c.verified + c.already },
    { id: "recent", label: "Most recent", n: done },
    { id: "pending", label: "Not started", n: remaining },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-800 flex items-center gap-1.5 cursor-pointer">
        <ArrowLeft className="size-4" /> All uploads
      </button>

      <Card className="p-6">
        <div className="flex items-start gap-5">
          <div className={cx("size-12 rounded-2xl grid place-items-center shrink-0", finishedClean ? "bg-lime-50 text-lime-700" : run.state === "running" ? "bg-sky-50 text-sky-700" : "bg-brand-50 text-brand-700")}>
            {finishedClean ? <CheckCircle2 className="size-6" /> : run.state === "running" ? <Upload className="size-6" /> : run.pausedReason === "trial" ? <FlaskConical className="size-6" /> : run.state === "done" ? <CircleAlert className="size-6" /> : <CirclePause className="size-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-semibold text-stone-900">{title}</div>
              {stateBadge(run)}
            </div>
            <div className="text-sm text-stone-500 mt-1 truncate">
              {run.formName} · {run.connectionName} · from {run.locationLabel}
              {run.replaceExisting && " · replaces files on records"}
            </div>

            <div className="mt-4 space-y-2">
              <Progress value={(done / Math.max(1, run.total)) * 100} tone={finishedClean ? "green" : "apricot"} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-lime-800">✓ {c.verified.toLocaleString()} attached</span>
                {c.already > 0 && <span className="text-lime-800">{c.already.toLocaleString()} attached before</span>}
                {c.skipped > 0 && <span className="text-stone-500">{c.skipped.toLocaleString()} not uploaded</span>}
                {c.not_verified > 0 && <span className="text-amber-700">? {c.not_verified.toLocaleString()} not verified</span>}
                {c.failed > 0 && <span className="text-red-700">✕ {c.failed.toLocaleString()} failed</span>}
                {run.state === "running" && run.etaSeconds != null && remaining > 0 && (
                  <span className="text-stone-400 ml-auto">Time to completion: approximately {formatDuration(run.etaSeconds)}{run.perMinute ? ` · ${Math.round(run.perMinute)} files each minute` : ""}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {run.state === "running" && (
          <p className="mt-5 text-sm text-stone-500">You can close this page. The upload continues while the toolkit window is open.</p>
        )}
        {run.state === "interrupted" && (
          <div className="mt-5">
            <Callout tone="amber" title="This upload stopped when the toolkit closed">
              {done.toLocaleString()} of {run.total.toLocaleString()} files are complete. Select Continue to upload the other files. The toolkit does not upload a file two times.
            </Callout>
          </div>
        )}
        {run.state === "paused" && run.pausedReason === "error" && (
          <div className="mt-5">
            <Callout tone="red" title="The upload stopped because of a problem that affects all files">
              {run.pauseMessage}{" "}
              {run.autoResumeAt
                ? `The toolkit starts again automatically at ${new Date(run.autoResumeAt).toLocaleTimeString(undefined, { timeStyle: "short" })}. You can also continue now.`
                : "Correct the problem, then select Continue."}{" "}
              The toolkit does not upload a file two times.
            </Callout>
          </div>
        )}
        {error && <div className="mt-5"><Callout tone="red">{error}</Callout></div>}

        <div className="mt-6 flex flex-wrap gap-3">
          {run.state === "ready" && <Button size="lg" icon={<Play className="size-4" />} loading={busy === "start"} onClick={() => act("start", () => api.startRun(id))}>Start</Button>}
          {run.state === "running" && <Button variant="secondary" icon={<Pause className="size-4" />} loading={busy === "pause"} onClick={() => act("pause", () => api.pauseRun(id))}>Stop</Button>}
          {(run.state === "paused" || run.state === "interrupted") && (
            <Button size="lg" icon={<Play className="size-4" />} loading={busy === "start"} onClick={() => act("start", () => api.startRun(id))}>
              {run.pausedReason === "trial" ? `Upload the other ${plural(remaining, "file")}` : `${run.autoResumeAt ? "Continue now" : "Continue"} (${plural(remaining, "file")} remain)`}
            </Button>
          )}
          {run.state === "done" && problems > 0 && (
            <Button icon={<RotateCcw className="size-4" />} loading={busy === "retry"} onClick={() => act("retry", () => api.retryRun(id))}>Do again for the {plural(problems, "file")} with problems</Button>
          )}
          <Button variant="secondary" icon={<Download className="size-4" />} loading={busy === "report"} onClick={downloadReport}>Download report</Button>
          {run.state === "done" && <Button variant="ghost" onClick={onAttachMore}>Attach more files</Button>}
          {run.state !== "running" && (
            <Button
              variant="ghost"
              className="ml-auto text-stone-400"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (!confirm("Remove this upload from the list? The files that are attached stay on the records.")) return;
                await api.deleteRun(id);
                onBack();
              }}
            >
              Remove
            </Button>
          )}
        </div>
        {run.pausedReason === "trial" && run.state === "paused" && (
          <p className="text-sm text-stone-500 mt-3">Open the records below in Apricot. Make sure that the files are correct. Then upload the other files.</p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex gap-1 px-3 pt-3 border-b border-stone-100 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setLimit(PAGE);
                setItems(null);
              }}
              className={cx("px-3 py-2 text-sm rounded-t-lg -mb-px border-b-2 cursor-pointer transition-colors whitespace-nowrap", activeTab === t.id ? "border-brand-800 text-stone-900 font-medium" : "border-transparent text-stone-500 hover:text-stone-800")}
            >
              {t.label} <span className="ml-1 text-xs text-stone-400 tabular-nums">{t.n.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="max-h-[480px] overflow-y-auto divide-y divide-stone-100">
          {!items && <div className="p-6"><Spinner /></div>}
          {items?.items.length === 0 && <div className="p-10 text-center text-sm text-stone-500">{activeTab === "problems" ? "There are no problems." : "There are no files here."}</div>}
          {items?.items.map((i) => <ItemRow key={i.n} item={i} />)}
          {items && items.total > items.items.length && (
            <div className="p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE * 5)}>Show more ({(items.total - items.items.length).toLocaleString()} more)</Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ItemRow({ item: i }: { item: JobItemView }) {
  const s = i.result?.status;
  const badge =
    s === "verified" ? <Badge tone="green">Attached</Badge>
    : s === "already" ? <Badge tone="green">Attached before</Badge>
    : s === "skipped" ? <Badge>Not uploaded</Badge>
    : s === "not_verified" ? <Badge tone="amber">Not verified</Badge>
    : s === "failed" ? <Badge tone="red"><CircleAlert className="size-3" /> Failed</Badge>
    : <Badge>Not started</Badge>;
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 text-sm">
      {i.sheetRow && <span className="text-xs text-stone-400 w-12 shrink-0 tabular-nums">Row {i.sheetRow}</span>}
      <div className="flex-1 min-w-0">
        <div className="truncate" title={i.path}>
          {i.name} <span className="text-stone-400">→ {i.recordLabel} · {i.recordId} · {i.fieldLabel}</span>
        </div>
        {i.result?.message && <div className="text-xs text-stone-500">{i.result.message}</div>}
      </div>
      {badge}
    </div>
  );
}
