import { useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, Download, FlaskConical, Pause, Play, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, plural, Progress } from "../../components/ui";
import { downloadSheet } from "../../lib/sheets";
import type { Connection } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import { duplicateIds, fileExtension, rowState, STATE_COPY, willUpload, type Row } from "./model";

const CONCURRENCY = 3;
type Phase = "ready" | "running" | "paused" | "done";

export function StepUpload({
  connection,
  target,
  rows,
  setRows,
  replaceExisting,
  onBack,
  onStartOver,
}: {
  connection: Connection;
  target: Target;
  rows: Row[];
  setRows: (r: Row[] | ((prev: Row[]) => Row[])) => void;
  replaceExisting: boolean;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [confirmed, setConfirmed] = useState(connection.environment !== "production");
  const [trialDone, setTrialDone] = useState(false);
  const pausedRef = useRef(false);
  const rejectedExts = useRef(new Set<string>());

  const dupes = useMemo(() => duplicateIds(rows), [rows]);
  const planned = rows.filter((r) => willUpload(rowState(r, replaceExisting, dupes)));
  const replacing = planned.filter((r) => r.record?.existingFile).length;

  const stat = (s: string) => planned.filter((r) => r.result?.status === s).length;
  const verified = stat("verified");
  const notVerified = stat("not_verified");
  const failed = stat("failed");
  const skipped = stat("skipped");
  const finished = verified + notVerified + failed + skipped;
  const remaining = planned.filter((r) => !r.result || r.result.status === "uploading").length;

  const setResult = (id: string, result: Row["result"]) =>
    setRows((prev) => prev.map((r) => (r.item.id === id ? { ...r, result } : r)));

  const run = async (queue: Row[]) => {
    if (queue.length === 0) return;
    pausedRef.current = false;
    setPhase("running");
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        while (pausedRef.current) await new Promise((r) => setTimeout(r, 300));
        const row = queue[next++]!;
        const ext = fileExtension(row.item.file.name);
        if (ext && rejectedExts.current.has(ext)) {
          setResult(row.item.id, { status: "skipped", message: `Apricot rejected .${ext} files earlier in this run, so this one was skipped.` });
          continue;
        }
        setResult(row.item.id, { status: "uploading" });
        try {
          const outcome = await api.upload(connection.id, row.item.file, row.record!.id, target.fileField.id);
          if (outcome.status === "failed" && outcome.rejectedType && ext) rejectedExts.current.add(ext);
          setResult(row.item.id, outcome);
        } catch (e) {
          setResult(row.item.id, { status: "failed", message: (e as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setPhase("done");
  };

  const pending = () => planned.filter((r) => !r.result);
  const tryFirst = async () => {
    await run(pending().slice(0, 3));
    setTrialDone(true);
  };
  const runAll = () => run(pending());
  const retryProblems = () => {
    rejectedExts.current.clear();
    const retry = planned.filter((r) => r.result && r.result.status !== "verified");
    setRows((prev) => prev.map((r) => (retry.some((x) => x.item.id === r.item.id) ? { ...r, result: undefined } : r)));
    run(retry);
  };

  const downloadReport = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
    const statusText = (r: Row) => {
      const res = r.result;
      if (res?.status === "verified") return ["Attached ✓", `Apricot shows "${res.file.filename}"`];
      if (res?.status === "not_verified") return ["Not confirmed", res.message];
      if (res?.status === "failed") return ["Failed", res.message];
      if (res?.status === "skipped") return ["Skipped", res.message];
      const s = rowState(r, replaceExisting, dupes);
      return [willUpload(s) ? "Not uploaded yet" : STATE_COPY[s].label, STATE_COPY[s].help];
    };
    downloadSheet(
      `Attach files report - ${target.form.name} - ${stamp}.xlsx`,
      ["File", "Folder path", "Record ID", "Record", "Result", "Details"],
      rows.map((r) => {
        const [result, details] = statusText(r);
        return [r.item.file.name, r.item.path, r.record?.id ?? null, r.record?.label ?? null, result ?? "", details ?? ""];
      }),
      [36, 40, 12, 28, 18, 60],
    );
  };

  const pct = planned.length ? (finished / planned.length) * 100 : 0;
  const problems = planned.filter((r) => r.result && ["failed", "not_verified", "skipped"].includes(r.result.status));
  const isProd = connection.environment === "production";

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start gap-5">
          <div className={cx("size-12 rounded-2xl grid place-items-center shrink-0", phase === "done" && remaining === 0 && failed + notVerified === 0 ? "bg-lime-50 text-lime-700" : "bg-brand-50 text-brand-600")}>
            {phase === "done" && remaining === 0 ? <CheckCircle2 className="size-6" /> : <Upload className="size-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-stone-900">
              {phase === "ready" && `Attach ${plural(planned.length, "file")} to "${target.fileField.label}"`}
              {phase === "running" && `Uploading… ${finished} of ${planned.length}`}
              {phase === "paused" && `Paused · ${finished} of ${planned.length} done`}
              {phase === "done" && remaining > 0 && `${verified} attached · ${remaining} still to go`}
              {phase === "done" && remaining === 0 && (failed + notVerified + skipped === 0 ? (verified === 1 ? "File attached and verified" : `All ${verified.toLocaleString()} files attached and verified`) : `${verified.toLocaleString()} attached · ${failed + notVerified + skipped} need attention`)}
            </div>
            <div className="text-sm text-stone-500 mt-1">
              {target.form.name} · {connection.name}
              {replacing > 0 && phase === "ready" && ` · ${plural(replacing, "existing file")} will be replaced`}
            </div>
            {phase !== "ready" && (
              <div className="mt-4 space-y-2">
                <Progress value={pct} tone={phase === "done" && remaining === 0 && failed + notVerified === 0 ? "green" : "apricot"} />
                <div className="flex gap-4 text-sm">
                  <span className="text-lime-800">✓ {verified} attached</span>
                  {notVerified > 0 && <span className="text-amber-700">? {notVerified} not confirmed</span>}
                  {failed > 0 && <span className="text-red-700">✕ {failed} failed</span>}
                  {skipped > 0 && <span className="text-stone-500">{skipped} skipped</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {phase === "ready" && (
          <div className="mt-6 space-y-4">
            <Callout tone="neutral" icon={<ShieldCheck className="size-4" />}>
              After each upload, the toolkit reads the record back from Apricot to make sure the file is really there.
              Keep this page open while it runs.
            </Callout>
            {isProd && (
              <label className="flex items-start gap-3 rounded-xl bg-red-50 ring-1 ring-red-200 p-4 cursor-pointer">
                <input type="checkbox" className="accent-red-600 mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="text-sm text-red-900">
                  I understand this will change <strong>{plural(planned.length, "record")} in Production</strong>
                  {replacing > 0 && <> and replace {replacing} existing file{replacing > 1 ? "s" : ""}, which can't be undone</>}.
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-3">
              {planned.length > 3 && (
                <Button variant="secondary" size="lg" icon={<FlaskConical className="size-4" />} disabled={!confirmed} onClick={tryFirst}>
                  Try 3 first
                </Button>
              )}
              <Button size="lg" icon={<Upload className="size-4" />} disabled={!confirmed} onClick={runAll}>
                {planned.length === 1 ? "Upload 1 file" : `Upload all ${planned.length.toLocaleString()}`}
              </Button>
            </div>
          </div>
        )}

        {(phase === "running" || phase === "paused") && (
          <div className="mt-5 flex gap-3">
            {phase === "running" ? (
              <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => { pausedRef.current = true; setPhase("paused"); }}>Pause</Button>
            ) : (
              <Button icon={<Play className="size-4" />} onClick={() => { pausedRef.current = false; setPhase("running"); }}>Resume</Button>
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="mt-6 flex flex-wrap gap-3">
            {remaining > 0 && (
              <Button size="lg" icon={<Upload className="size-4" />} onClick={runAll}>
                {trialDone ? "Looks good. " : ""}Upload the remaining {remaining.toLocaleString()}
              </Button>
            )}
            {problems.length > 0 && remaining === 0 && (
              <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={retryProblems}>Try the {problems.length} again</Button>
            )}
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={downloadReport}>Download report</Button>
            {remaining === 0 && <Button variant="ghost" onClick={onStartOver}>Attach more files</Button>}
          </div>
        )}
        {trialDone && phase === "done" && remaining > 0 && (
          <p className="text-sm text-stone-500 mt-3">Check those 3 records in Apricot. If they look right, upload the rest.</p>
        )}
      </Card>

      {phase !== "ready" && (
        <Card className="overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto divide-y divide-stone-100">
            {planned
              .filter((r) => r.result)
              .sort((a, b) => order(a) - order(b))
              .slice(0, 1000)
              .map((r) => (
                <div key={r.item.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <ResultIcon row={r} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.item.file.name} <span className="text-stone-400">→ {r.record?.label} · {r.record?.id}</span></div>
                    {r.result && "message" in r.result && <div className="text-xs text-stone-500">{r.result.message}</div>}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {phase === "ready" && (
        <div className="flex justify-between">
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        </div>
      )}
    </div>
  );
}

// Problems first, then in-progress, then successes.
const order = (r: Row) =>
  ({ failed: 0, not_verified: 1, skipped: 2, uploading: 3, verified: 4 })[r.result?.status ?? "verified"] ?? 5;

function ResultIcon({ row }: { row: Row }) {
  const s = row.result?.status;
  if (s === "verified") return <Badge tone="green">Attached</Badge>;
  if (s === "uploading") return <Badge tone="blue">Uploading…</Badge>;
  if (s === "not_verified") return <Badge tone="amber">Not confirmed</Badge>;
  if (s === "skipped") return <Badge>Skipped</Badge>;
  return <Badge tone="red"><CircleAlert className="size-3" /> Failed</Badge>;
}
