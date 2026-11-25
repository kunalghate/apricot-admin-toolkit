import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Download, FileIcon, RefreshCw, Search, Undo2, X } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, Input, plural } from "../../components/ui";
import { downloadSheet } from "../../lib/sheets";
import { isImageField } from "../../../shared/fields";
import type { Connection } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import { ATTENTION_STATES, duplicateIds, existingFile, rowState, STATE_COPY, willUpload, type Row, type RowState, type Source } from "./model";

type Filter = "all" | "attention" | "ready" | "existing";
const PAGE = 100;

export function useRowStates(target: Target, rows: Row[], replaceExisting: boolean) {
  const imageFields = useMemo(() => new Set(target.fields.filter(isImageField).map((f) => f.id)), [target.fields]);
  const dupes = useMemo(() => duplicateIds(rows), [rows]);
  const states = useMemo(() => rows.map((r) => rowState(r, replaceExisting, dupes, imageFields)), [rows, replaceExisting, dupes, imageFields]);
  return { states, dupes, imageFields };
}

export function StepReview({
  connection,
  target,
  source,
  rows,
  setRows,
  replaceExisting,
  setReplaceExisting,
  onBack,
  onNext,
}: {
  connection: Connection;
  target: Target;
  source: Source;
  rows: Row[];
  setRows: (r: Row[] | ((prev: Row[]) => Row[])) => void;
  replaceExisting: boolean;
  setReplaceExisting: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { states } = useRowStates(target, rows, replaceExisting);
  const fieldLabel = useMemo(() => new Map(target.fields.map((f) => [f.id, f.label])), [target.fields]);
  const multiField = new Set(rows.map((r) => r.fieldId)).size > 1;

  const ready = states.filter(willUpload).length;
  const attention = states.filter((s) => ATTENTION_STATES.includes(s)).length;
  const existing = states.filter((s) => s === "has_file" || s === "replace").length;

  const [filter, setFilter] = useState<Filter>(attention > 0 ? "attention" : "all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .map((r, i) => ({ r, s: states[i]! }))
      .filter(({ s }) =>
        filter === "all" ? true : filter === "attention" ? ATTENTION_STATES.includes(s) : filter === "ready" ? willUpload(s) : s === "has_file" || s === "replace",
      )
      .filter(
        ({ r }) =>
          !q ||
          (r.file?.path ?? r.fileWanted ?? "").toLowerCase().includes(q) ||
          (r.key ?? "").toLowerCase().includes(q) ||
          (r.record?.label ?? "").toLowerCase().includes(q) ||
          String(r.record?.id ?? "").includes(q) ||
          String(r.sheetRow ?? "") === q,
      );
  }, [rows, states, filter, query]);

  const update = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const downloadList = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
    const describe = (r: Row, s: RowState) => {
      const copy = STATE_COPY[s];
      const target = r.record ? `record ${r.record.id} (${r.record.label})` : "";
      const detail = s === "has_file" || s === "replace" ? `${copy.help} Currently "${existingFile(r)?.filename}".` : r.lookupMessage || copy.help;
      return { status: copy.label, detail: [target, detail].filter(Boolean).join(": ") };
    };
    if (source.sheet) {
      // The customer's own spreadsheet, with a status for each row added at the end.
      const { sheet } = source.sheet;
      const byRow = new Map<number, { status: string; detail: string }[]>();
      rows.forEach((r, i) => {
        const d = describe(r, states[i]!);
        const label = multiField ? `${fieldLabel.get(r.fieldId)}: ` : "";
        const list = byRow.get(r.sheetRow!) ?? [];
        list.push({ status: label + d.status, detail: label + d.detail });
        byRow.set(r.sheetRow!, list);
      });
      downloadSheet(
        `${sheet.name.replace(/\.(xlsx|csv)$/i, "")} - checked ${stamp}.xlsx`,
        [...sheet.header, "Toolkit status", "Details"],
        sheet.rows.map((cells, i) => {
          const s = byRow.get(i + 2) ?? [{ status: "No file", detail: "This row has no file in it." }];
          return [...sheet.header.map((_, c) => cells[c] ?? ""), s.map((x) => x.status).join("; "), s.map((x) => x.detail).join("; ")];
        }),
        [...sheet.header.map(() => 18), 24, 70],
      );
    } else {
      downloadSheet(
        `Attach files check - ${target.form.name} - ${stamp}.xlsx`,
        ["File", "Path", "Looked for", "Record ID", "Record", "Status", "Details"],
        rows.map((r, i) => {
          const d = describe(r, states[i]!);
          return [r.file?.name ?? "", r.file?.path ?? "", r.key ?? "", r.record?.id ?? null, r.record?.label ?? "", d.status, d.detail];
        }),
        [32, 40, 24, 12, 28, 20, 60],
      );
    }
  };

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
        <Summary tone="amber" icon={<RefreshCw className="size-5" />} n={existing} label="already have a file" />
        <Summary tone={attention ? "red" : "neutral"} icon={<CircleAlert className="size-5" />} n={attention} label="need your attention" />
      </div>

      {existing > 0 && (
        <Card className="p-5">
          <div className="text-sm font-medium mb-3">When a record already has a file in that field:</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { v: false, title: "Skip it (recommended)", desc: "Keep the existing file. Nothing is lost." },
              { v: true, title: "Replace it", desc: "Upload the new file. The old one can't be restored." },
            ].map((o) => (
              <label key={String(o.v)} className={cx("flex gap-3 rounded-xl p-3 ring-1 cursor-pointer transition", replaceExisting === o.v ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300")}>
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
        <div className="flex flex-wrap items-end gap-3 px-3 pt-3 border-b border-stone-100">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setFilter(t.id);
                  setShown(PAGE);
                }}
                className={cx("px-3 py-2 text-sm rounded-t-lg -mb-px border-b-2 cursor-pointer transition-colors", filter === t.id ? "border-brand-800 text-stone-900 font-medium" : "border-transparent text-stone-500 hover:text-stone-800")}
              >
                {t.label} <span className="ml-1 text-xs text-stone-400 tabular-nums">{t.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 pb-2">
            <div className="relative">
              <Search className="size-4 text-stone-400 absolute left-2.5 top-2" />
              <Input className="h-8 w-56 pl-8" placeholder={source.sheet ? "Search, or a row number" : "Search"} value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
            </div>
            <Button variant="secondary" size="sm" icon={<Download className="size-3.5" />} onClick={downloadList} title="Download every row with its status, to fix problems in Excel">
              Download this list
            </Button>
          </div>
        </div>
        <div className="max-h-[520px] overflow-y-auto divide-y divide-stone-100">
          {visible.length === 0 && (
            <div className="p-10 text-center text-sm text-stone-500">{query ? "Nothing matches your search." : filter === "attention" ? "Nothing needs your attention." : "Nothing here."}</div>
          )}
          {visible.slice(0, shown).map(({ r, s }) => (
            <ReviewRow key={r.id} row={r} state={s} connection={connection} target={target} fieldLabel={multiField ? fieldLabel.get(r.fieldId) : undefined} update={update} />
          ))}
          {visible.length > shown && (
            <div className="p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setShown(shown + PAGE * 5)}>
                Show more ({(visible.length - shown).toLocaleString()} left)
              </Button>
            </div>
          )}
        </div>
      </Card>

      {attention > 0 && ready > 0 && (
        <Callout tone="neutral">
          You can continue now. Rows that still need attention won't be uploaded. {source.sheet ? "For many problems, it's often quicker to download the list, fix the spreadsheet, and start again." : ""}
        </Callout>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        <Button disabled={ready === 0} icon={<ArrowRight className="size-4" />} onClick={onNext}>
          Continue with {plural(ready, "file")}
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
  fieldLabel,
  update,
}: {
  row: Row;
  state: RowState;
  connection: Connection;
  target: Target;
  fieldLabel?: string;
  update: (id: string, patch: Partial<Row>) => void;
}) {
  const [manualId, setManualId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = STATE_COPY[state];
  const needsRecord = ["no_key", "not_found", "error"].includes(state);
  const current = existingFile(row);

  const useRecord = async () => {
    const id = Number(manualId.trim());
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const rec = await api.record(connection.id, id, target.form.id, [row.fieldId]);
      update(row.id, { record: rec, lookup: "found", manual: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("px-5 py-3 text-sm", row.excluded && "opacity-50")}>
      <div className="flex items-center gap-3">
        {row.sheetRow ? <span className="text-xs text-stone-400 w-12 shrink-0 tabular-nums">Row {row.sheetRow}</span> : <FileIcon className="size-4 text-stone-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="truncate text-stone-800" title={row.file?.path ?? row.fileWanted}>
            {row.file?.name ?? row.fileWanted}
            {fieldLabel && <span className="text-stone-400"> → {fieldLabel}</span>}
          </div>
          <div className="text-xs text-stone-500 truncate">
            {row.record ? (
              <>
                → <span className="text-stone-800 font-medium">{row.record.label}</span> · record {row.record.id}
                {row.manual && " · matched by hand"}
                {current && <> · currently has "{current.filename}"</>}
              </>
            ) : row.key ? (
              <>Looked for "{row.key}"{row.lookupMessage ? ` · ${row.lookupMessage}` : ""}</>
            ) : (
              row.lookupMessage || copy.help
            )}
          </div>
        </div>
        <Badge tone={copy.tone}>{copy.label}</Badge>
        {row.excluded ? (
          <Button variant="ghost" size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => update(row.id, { excluded: false })}>Undo</Button>
        ) : (
          <button className="text-stone-400 hover:text-stone-700 cursor-pointer" title="Remove from this batch" onClick={() => update(row.id, { excluded: true })}>
            <X className="size-4" />
          </button>
        )}
      </div>

      {state === "file_missing" && <div className="mt-1 ml-[60px] text-xs text-red-700">{copy.help}</div>}
      {state === "file_ambiguous" && row.fileCandidates && (
        <div className="mt-2 ml-[60px] space-y-1">
          <div className="text-xs text-stone-500">Which file did the spreadsheet mean?</div>
          <div className="flex flex-wrap gap-2">
            {row.fileCandidates.map((f) => (
              <Button key={f.id} variant="secondary" size="sm" className="font-mono text-xs" onClick={() => update(row.id, { file: f, fileIssue: undefined })}>
                {f.path}
              </Button>
            ))}
          </div>
        </div>
      )}
      {state === "multiple" && row.candidates && (
        <div className="mt-2 ml-7 flex flex-wrap gap-2">
          {row.candidates.map((c) => (
            <Button key={c.id} variant="secondary" size="sm" onClick={() => update(row.id, { record: c, lookup: "found", manual: true })}>
              {c.label} · {c.id}
            </Button>
          ))}
        </div>
      )}
      {state === "duplicate" && <div className="mt-1 ml-7 text-xs text-amber-700">{copy.help}</div>}
      {needsRecord && !row.excluded && row.file && (
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
