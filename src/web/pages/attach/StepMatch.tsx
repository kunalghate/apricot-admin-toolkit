import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, FileText, Search, Upload } from "lucide-react";
import { api } from "../../api";
import { Button, Callout, Card, cx, Label, Progress, Select } from "../../components/ui";
import { extractKey, KEY_RULES, suggestRule, type FileItem, type KeyRule } from "../../lib/files";
import { downloadSheet, readTable } from "../../lib/sheets";
import { isIdentifierCandidate } from "../../../shared/fields";
import type { Connection, MatchBy, MatchResult } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import type { Row } from "./model";

type Source = "names" | "sheet";

export function StepMatch({
  connection,
  target,
  files,
  onBack,
  onMatched,
}: {
  connection: Connection;
  target: Target;
  files: FileItem[];
  onBack: () => void;
  onMatched: (rows: Row[]) => void;
}) {
  const idFields = useMemo(
    () => target.fields.filter((f) => isIdentifierCandidate(f) && !f.hidden).sort((a, b) => a.order - b.order),
    [target.fields],
  );
  const [source, setSource] = useState<Source>("names");
  const [identifier, setIdentifier] = useState<string>("record_id");
  const [rule, setRule] = useState<KeyRule>(() => suggestRule(files, true));
  const [sheet, setSheet] = useState<{ name: string; rows: string[][] } | null>(null);
  const [fileCol, setFileCol] = useState(0);
  const [idCol, setIdCol] = useState(1);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetInput = useRef<HTMLInputElement>(null);

  const idLabel = identifier === "record_id" ? "Apricot record ID" : (idFields.find((f) => String(f.id) === identifier)?.label ?? "ID");
  const matchBy: MatchBy = identifier === "record_id" ? { kind: "record_id" } : { kind: "field", fieldId: Number(identifier) };

  const changeIdentifier = (v: string) => {
    setIdentifier(v);
    setRule(suggestRule(files, v === "record_id"));
  };

  // Spreadsheet lookup: file name → identifier
  const sheetMap = useMemo(() => {
    const m = new Map<string, string>();
    if (!sheet) return m;
    for (const r of sheet.rows.slice(1)) {
      const name = (r[fileCol] ?? "").trim().toLowerCase();
      const id = (r[idCol] ?? "").trim();
      if (name && id) m.set(name, id);
    }
    return m;
  }, [sheet, fileCol, idCol]);

  const keyFor = (f: FileItem): string | null => {
    if (source === "names") return extractKey(f, rule);
    const n = f.file.name.toLowerCase();
    return sheetMap.get(n) ?? sheetMap.get(f.path.toLowerCase()) ?? null;
  };

  const keyed = files.map((f) => ({ f, key: keyFor(f) }));
  const withKey = keyed.filter((k) => k.key).length;

  const loadSheet = async (file: File) => {
    setSheetError(null);
    try {
      const rows = await readTable(file);
      if (rows.length < 2) throw new Error("That spreadsheet looks empty. It needs a header row and at least one row of data.");
      const headers = rows[0]!.map((h) => h.toLowerCase());
      const fc = Math.max(0, headers.findIndex((h) => /file/.test(h)));
      let ic = headers.findIndex((h, i) => i !== fc && (h === idLabel.toLowerCase() || /record id|\bid\b/.test(h)));
      if (ic < 0) ic = fc === 0 ? 1 : 0;
      setSheet({ name: file.name, rows });
      setFileCol(fc);
      setIdCol(ic);
    } catch (e) {
      setSheetError((e as Error).message || "Couldn't read that file. Use an Excel (.xlsx) or CSV file.");
    }
  };

  const findRecords = async () => {
    setError(null);
    const keys = [...new Set(keyed.map((k) => k.key).filter((k): k is string => !!k))];
    const results = new Map<string, MatchResult>();
    setProgress(0);
    try {
      const chunk = 40;
      for (let i = 0; i < keys.length; i += chunk) {
        const part = await api.match(connection.id, {
          formId: target.form.id,
          fileFieldId: target.fileField.id,
          matchBy,
          keys: keys.slice(i, i + chunk),
        });
        for (const r of part) results.set(r.key, r);
        setProgress(Math.round(((i + chunk) / keys.length) * 100));
      }
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
      return;
    }
    const rows: Row[] = keyed.map(({ f, key }) => {
      if (!key) return { item: f, key: null, lookup: "no_key", record: null };
      const r = results.get(key.trim());
      if (!r) return { item: f, key, lookup: "not_found", record: null };
      if (r.status === "found") return { item: f, key, lookup: "found", record: r.record };
      if (r.status === "multiple") return { item: f, key, lookup: "multiple", record: null, candidates: r.records };
      if (r.status === "error") return { item: f, key, lookup: "error", lookupMessage: r.message, record: null };
      return { item: f, key, lookup: "not_found", record: null };
    });
    setProgress(null);
    onMatched(rows);
  };

  const busy = progress !== null;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <Label hint="This is what links each file to a record.">How do your files identify the record?</Label>
        <Select value={identifier} onChange={(e) => changeIdentifier(e.target.value)} className="max-w-md">
          <option value="record_id">Apricot record ID (the number Apricot gives each record)</option>
          {idFields.length > 0 && (
            <optgroup label={`A field on ${target.form.name}`}>
              {idFields.map((f) => (
                <option key={f.id} value={String(f.id)}>{f.label}</option>
              ))}
            </optgroup>
          )}
        </Select>

        <div className="mt-6 grid grid-cols-2 gap-2 max-w-xl">
          {(
            [
              { id: "names", icon: FileText, title: "From the file names", desc: `The ${idLabel} is in each file's name` },
              { id: "sheet", icon: FileSpreadsheet, title: "From a spreadsheet", desc: "A list saying which file goes where" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              onClick={() => setSource(o.id)}
              className={cx(
                "rounded-xl p-4 text-left ring-1 transition cursor-pointer",
                source === o.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300",
              )}
            >
              <o.icon className="size-5 text-brand-700 mb-2" />
              <div className="font-medium text-sm">{o.title}</div>
              <div className="text-xs text-stone-500 mt-0.5">{o.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {source === "names" && (
        <Card className="p-6">
          <Label>Which part of the file name is the {idLabel}?</Label>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            {KEY_RULES.map((r) => (
              <label
                key={r.id}
                className={cx(
                  "flex gap-3 rounded-xl p-3 ring-1 cursor-pointer transition",
                  rule === r.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300",
                )}
              >
                <input type="radio" className="accent-brand-800 mt-1" checked={rule === r.id} onChange={() => setRule(r.id)} />
                <span>
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block text-xs text-stone-500 font-mono mt-0.5">{r.example}</span>
                </span>
              </label>
            ))}
          </div>
          <PreviewTable rows={keyed.slice(0, 8)} idLabel={idLabel} />
        </Card>
      )}

      {source === "sheet" && (
        <Card className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              icon={<Download className="size-4" />}
              onClick={() =>
                downloadSheet(
                  `Attach files - ${target.form.name}.xlsx`,
                  ["File name", idLabel],
                  files.map((f) => [f.file.name, null]),
                  [48, 28],
                )
              }
            >
              Download a template with your {files.length} files
            </Button>
            <span className="text-sm text-stone-500">Fill in the {idLabel} column, save, then upload it here.</span>
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) loadSheet(f);
            }}
            className="rounded-xl border-2 border-dashed border-stone-200 p-6 text-center"
          >
            <Upload className="size-5 mx-auto text-stone-400 mb-2" />
            <div className="text-sm">
              {sheet ? <>Using <strong>{sheet.name}</strong> · {sheet.rows.length - 1} rows</> : "Drop your filled-in spreadsheet here"}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => sheetInput.current?.click()}>
              {sheet ? "Choose a different file" : "Choose file"}
            </Button>
            <input ref={sheetInput} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadSheet(f); e.target.value = ""; }} />
          </div>
          {sheetError && <Callout tone="red">{sheetError}</Callout>}
          {sheet && (
            <>
              <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <Label>Column with the file names</Label>
                  <Select value={fileCol} onChange={(e) => setFileCol(Number(e.target.value))}>
                    {sheet.rows[0]!.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Column with the {idLabel}</Label>
                  <Select value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>
                    {sheet.rows[0]!.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </Select>
                </div>
              </div>
              <PreviewTable rows={keyed.slice(0, 8)} idLabel={idLabel} />
            </>
          )}
        </Card>
      )}

      {error && <Callout tone="red" title="Couldn't look up records">{error}</Callout>}

      <Card className="p-5 flex items-center gap-4">
        <div className="flex-1">
          {busy ? (
            <div className="space-y-2">
              <div className="text-sm text-stone-600">Looking up records in Apricot…</div>
              <Progress value={progress} />
            </div>
          ) : (
            <div className="text-sm text-stone-600">
              <strong className="text-stone-900">{withKey.toLocaleString()}</strong> of {files.length.toLocaleString()} files have a {idLabel}.
              {withKey < files.length && " You can match the rest by hand on the next screen."}
            </div>
          )}
        </div>
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>Back</Button>
        <Button icon={<Search className="size-4" />} onClick={findRecords} loading={busy} disabled={withKey === 0 && files.length > 0 && source === "sheet" && !sheet}>
          Find records
        </Button>
      </Card>
    </div>
  );
}

function PreviewTable({ rows, idLabel }: { rows: { f: FileItem; key: string | null }[]; idLabel: string }) {
  return (
    <div className="mt-5 rounded-xl ring-1 ring-stone-200 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_200px] gap-3 px-4 py-2 bg-stone-50 text-xs font-medium text-stone-500 uppercase tracking-wide">
        <span>File</span>
        <span />
        <span>{idLabel}</span>
      </div>
      {rows.map(({ f, key }) => (
        <div key={f.id} className="grid grid-cols-[1fr_auto_200px] gap-3 px-4 py-2 text-sm border-t border-stone-100">
          <span className="truncate text-stone-700" title={f.path}>{f.path}</span>
          <span className="text-stone-300">→</span>
          {key ? <span className="font-mono text-stone-900 truncate">{key}</span> : <span className="text-amber-700">Not found in name</span>}
        </div>
      ))}
    </div>
  );
}
