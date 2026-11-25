import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, FileIcon, RefreshCw, Undo2, X } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, Input } from "../../components/ui";
import type { Connection } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import { ATTENTION_STATES, duplicateIds, rowState, STATE_COPY, willUpload, type Row, type RowState } from "./model";

type Filter = "all" | "attention" | "ready" | "existing";

export function StepReview({
  connection,
  target,
  rows,
  setRows,
  replaceExisting,
  setReplaceExisting,
  onBack,
  onNext,
}: {
  connection: Connection;
  target: Target;
  rows: Row[];
  setRows: (r: Row[] | ((prev: Row[]) => Row[])) => void;
  replaceExisting: boolean;
  setReplaceExisting: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const dupes = useMemo(() => duplicateIds(rows), [rows]);
  const states = rows.map((r) => rowState(r, replaceExisting, dupes));
  const count = (pred: (s: RowState) => boolean) => states.filter(pred).length;

  const ready = count(willUpload);
  const attention = count((s) => ATTENTION_STATES.includes(s));
  const existing = rows.filter((r) => !r.excluded && r.record?.existingFile && !dupes.has(r.item.id)).length;

  const [filter, setFilter] = useState<Filter>(attention > 0 ? "attention" : "all");

  const visible = rows
    .map((r, i) => ({ r, s: states[i]! }))
    .filter(({ s }) =>
      filter === "all"
        ? true
        : filter === "attention"
          ? ATTENTION_STATES.includes(s)
          : filter === "ready"
            ? willUpload(s)
            : s === "has_file" || s === "replace",
    );

  const update = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));

  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: "attention", label: "Needs attention", n: attention },
    { id: "ready", label: "Ready", n: ready },
    { id: "existing", label: "Already have a file", n: existing },
    { id: "all", label: "All", n: rows.length },
  ];

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        <Summary tone="green" icon={<CheckCircle2 className="size-5" />} n={ready} label="ready to attach" />
        <Summary tone="amber" icon={<RefreshCw className="size-5" />} n={existing} label="records already have a file" />
        <Summary tone={attention ? "red" : "neutral"} icon={<CircleAlert className="size-5" />} n={attention} label="need your attention" />
      </div>

      {existing > 0 && (
        <Card className="p-5">
          <div className="text-sm font-medium mb-3">When a record already has a file in "{target.fileField.label}":</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { v: false, title: "Skip it (recommended)", desc: "Keep the existing file. Nothing is lost." },
              { v: true, title: "Replace it", desc: "Upload the new file. The old one can't be restored." },
            ].map((o) => (
              <label
                key={String(o.v)}
                className={cx(
                  "flex gap-3 rounded-xl p-3 ring-1 cursor-pointer transition",
                  replaceExisting === o.v ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300",
                )}
              >
                <input type="radio" className="accent-brand-800 mt-1" checked={replaceExisting === o.v} onChange={() => setReplaceExisting(o.v)} />
                <span>
                  <span className="block text-sm font-medium">{o.title}</span>
                  <span className="block text-xs text-stone-500 mt-0.5">{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex gap-1 px-3 pt-3 border-b border-stone-100">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={cx(
                "px-3 py-2 text-sm rounded-t-lg -mb-px border-b-2 cursor-pointer transition-colors",
                filter === t.id ? "border-brand-800 text-stone-900 font-medium" : "border-transparent text-stone-500 hover:text-stone-800",
              )}
            >
              {t.label} <span className="ml-1 text-xs text-stone-400 tabular-nums">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="max-h-[480px] overflow-y-auto divide-y divide-stone-100">
          {visible.length === 0 && (
            <div className="p-10 text-center text-sm text-stone-500">
              {filter === "attention" ? "🎉 Nothing needs your attention." : "Nothing here."}
            </div>
          )}
          {visible.slice(0, 1000).map(({ r, s }) => (
            <ReviewRow key={r.item.id} row={r} state={s} connection={connection} target={target} update={update} />
          ))}
        </div>
      </Card>

      {attention > 0 && ready > 0 && (
        <Callout tone="neutral">You can continue now. Files that still need attention won't be uploaded.</Callout>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        <Button disabled={ready === 0} icon={<ArrowRight className="size-4" />} onClick={onNext}>
          Continue with {ready === 1 ? "1 file" : `${ready.toLocaleString()} files`}
        </Button>
      </div>
    </div>
  );
}

function Summary({ tone, icon, n, label }: { tone: "green" | "amber" | "red" | "neutral"; icon: React.ReactNode; n: number; label: string }) {
  const color = { green: "text-lime-700", amber: "text-amber-600", red: "text-red-600", neutral: "text-stone-400" }[tone];
  return (
    <Card className="p-5 flex items-center gap-4">
      <div className={color}>{icon}</div>
      <div>
        <div className="text-2xl font-semibold tabular-nums text-stone-900">{n.toLocaleString()}</div>
        <div className="text-sm text-stone-500">{label}</div>
      </div>
    </Card>
  );
}

function ReviewRow({
  row,
  state,
  connection,
  target,
  update,
}: {
  row: Row;
  state: RowState;
  connection: Connection;
  target: Target;
  update: (id: string, patch: Partial<Row>) => void;
}) {
  const [manualId, setManualId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = STATE_COPY[state];
  const needsFix = ["no_key", "not_found", "error"].includes(state);

  const useRecord = async () => {
    const id = Number(manualId.trim());
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const rec = await api.record(connection.id, id, target.form.id, target.fileField.id);
      update(row.item.id, { record: rec, lookup: "found", manual: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("px-5 py-3 text-sm", row.excluded && "opacity-50")}>
      <div className="flex items-center gap-3">
        <FileIcon className="size-4 text-stone-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="truncate text-stone-800" title={row.item.path}>{row.item.file.name}</div>
          <div className="text-xs text-stone-500 truncate">
            {row.record ? (
              <>
                → <span className="text-stone-800 font-medium">{row.record.label}</span> · record {row.record.id}
                {row.manual && " · matched by hand"}
                {row.record.existingFile && <> · currently has "{row.record.existingFile.filename}"</>}
              </>
            ) : row.key ? (
              <>Looked for "{row.key}"{row.lookupMessage ? ` · ${row.lookupMessage}` : ""}</>
            ) : (
              copy.help
            )}
          </div>
        </div>
        <Badge tone={copy.tone}>{copy.label}</Badge>
        {row.excluded ? (
          <Button variant="ghost" size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => update(row.item.id, { excluded: false })}>Undo</Button>
        ) : (
          <button className="text-stone-400 hover:text-stone-700 cursor-pointer" title="Remove from this batch" onClick={() => update(row.item.id, { excluded: true })}>
            <X className="size-4" />
          </button>
        )}
      </div>

      {state === "multiple" && row.candidates && (
        <div className="mt-2 ml-7 flex flex-wrap gap-2">
          {row.candidates.map((c) => (
            <Button key={c.id} variant="secondary" size="sm" onClick={() => update(row.item.id, { record: c, lookup: "found", manual: true })}>
              {c.label} · {c.id}
            </Button>
          ))}
        </div>
      )}
      {state === "duplicate" && <div className="mt-1 ml-7 text-xs text-amber-700">{copy.help}</div>}
      {needsFix && !row.excluded && (
        <div className="mt-2 ml-7 flex items-center gap-2">
          <Input
            className="h-8 max-w-[200px]"
            placeholder="Apricot record ID"
            inputMode="numeric"
            value={manualId}
            onChange={(e) => setManualId(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && useRecord()}
          />
          <Button size="sm" variant="secondary" loading={busy} disabled={!manualId} onClick={useRecord}>Use this record</Button>
          {err && <span className="text-xs text-red-700">{err}</span>}
        </div>
      )}
    </div>
  );
}
