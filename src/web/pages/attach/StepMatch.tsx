import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Download, FileSpreadsheet, FileText, Hash, Layers, Search, Upload } from "lucide-react";
import { api } from "../../api";
import { Button, Callout, Card, cx, Label, Progress, Select } from "../../components/ui";
import {
  extractValue,
  guessSources,
  nameParts,
  parseSourceId,
  sourceId,
  type FileItem,
  type PartSource,
} from "../../lib/files";
import { downloadSheet, readTable } from "../../lib/sheets";
import { displayKey, identifierOptions, joinKey, normalizeValue, type IdentifierOption } from "../../../shared/identifiers";
import type { Connection, MatchBy, MatchResult } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import type { Row } from "./model";

type Source = "names" | "sheet";
type Mode = "record_id" | "fields";

/** One thing we need per file: the record ID, or the value of one identifying field. */
interface Ident {
  key: string;
  label: string;
  kind: "text" | "date" | "record_id";
  fieldId?: number;
}

const RECORD_ID: Ident = { key: "record_id", label: "Apricot record ID", kind: "record_id" };
const MAX_FIELDS = 4;

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
  const options = useMemo(() => identifierOptions(target.fields), [target.fields]);
  const [mode, setMode] = useState<Mode>("record_id");
  const [picked, setPicked] = useState<string[]>([]);
  const [source, setSource] = useState<Source>("names");
  const [sources, setSources] = useState<PartSource[]>(() => guessSources(files, [RECORD_ID]));
  const [sheet, setSheet] = useState<{ name: string; rows: string[][] } | null>(null);
  const [fileCol, setFileCol] = useState(0);
  const [cols, setCols] = useState<number[]>([1]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetInput = useRef<HTMLInputElement>(null);

  const toIdent = (o: IdentifierOption): Ident => ({ key: o.key, label: o.label, kind: o.kind, fieldId: o.fieldId });
  const idents: Ident[] = mode === "record_id" ? [RECORD_ID] : picked.map((k) => toIdent(options.find((x) => x.key === k)!));

  const resetSources = (next: Ident[]) => {
    setSources(guessSources(files, next));
    setCols(next.map((_, i) => i + 1));
  };
  const chooseMode = (m: Mode) => {
    setMode(m);
    resetSources(m === "record_id" ? [RECORD_ID] : picked.map((k) => toIdent(options.find((x) => x.key === k)!)));
  };
  const togglePick = (o: IdentifierOption) => {
    const next = picked.includes(o.key) ? picked.filter((k) => k !== o.key) : [...picked, o.key].slice(0, MAX_FIELDS);
    setPicked(next);
    resetSources(next.map((k) => toIdent(options.find((x) => x.key === k)!)));
  };

  const combinedLabel = idents.map((i) => i.label).join(" + ") || "identifier";

  // Spreadsheet: file name → values
  const sheetMap = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!sheet) return m;
    for (const r of sheet.rows.slice(1)) {
      const name = (r[fileCol] ?? "").trim().toLowerCase();
      if (name) m.set(name, cols.map((c) => (r[c] ?? "").trim()));
    }
    return m;
  }, [sheet, fileCol, cols]);

  /** Raw values per identifier for one file, plus normalized values (null when unusable). */
  const valuesFor = (f: FileItem): { raw: (string | null)[]; norm: (string | null)[] } => {
    let raw: (string | null)[];
    if (source === "names") raw = idents.map((_, i) => extractValue(f, sources[i] ?? { type: "whole" }));
    else {
      const row = sheetMap.get(f.file.name.toLowerCase()) ?? sheetMap.get(f.path.toLowerCase());
      raw = idents.map((_, i) => row?.[i] || null);
    }
    const norm = raw.map((v, i) => {
      if (v == null) return null;
      const kind = idents[i]!.kind;
      return kind === "record_id" ? (/^\d+$/.test(v.trim()) ? v.trim() : null) : normalizeValue(v, kind);
    });
    return { raw, norm };
  };

  const keyed = files.map((f) => ({ f, ...valuesFor(f) }));
  const complete = keyed.filter((k) => idents.length > 0 && k.norm.every((v) => v != null)).length;

  const loadSheet = async (file: File) => {
    setSheetError(null);
    try {
      const rows = await readTable(file);
      if (rows.length < 2) throw new Error("That spreadsheet looks empty. It needs a header row and at least one row of data.");
      const headers = rows[0]!.map((h) => h.toLowerCase().trim());
      const fc = Math.max(0, headers.findIndex((h) => /file/.test(h)));
      const free = headers.map((_, j) => j).filter((j) => j !== fc);
      const guess = idents.map((id, i) => {
        const exact = headers.findIndex((h, j) => j !== fc && h === id.label.toLowerCase());
        return exact >= 0 ? exact : (free[i] ?? 0);
      });
      setSheet({ name: file.name, rows });
      setFileCol(fc);
      setCols(guess);
    } catch (e) {
      setSheetError((e as Error).message || "Couldn't read that file. Use an Excel (.xlsx) or CSV file.");
    }
  };

  const findRecords = async () => {
    setError(null);
    const matchBy: MatchBy =
      mode === "record_id"
        ? { kind: "record_id" }
        : { kind: "fields", keys: idents.map((i) => ({ key: i.key, kind: i.kind === "date" ? "date" : "text" })) };
    const tuples = new Map<string, string[]>();
    for (const k of keyed) if (k.norm.every((v) => v != null)) tuples.set(joinKey(k.norm as string[]), k.norm as string[]);
    const all = [...tuples.values()];
    const results = new Map<string, MatchResult>();
    setProgress(0);
    try {
      const chunk = 40;
      for (let i = 0; i < all.length; i += chunk) {
        const part = await api.match(connection.id, {
          formId: target.form.id,
          fileFieldId: target.fileField.id,
          matchBy,
          keys: all.slice(i, i + chunk),
        });
        for (const r of part) results.set(r.key, r);
        setProgress(Math.round(((i + chunk) / all.length) * 100));
      }
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
      return;
    }
    const rows: Row[] = keyed.map(({ f, raw, norm }): Row => {
      const missing = norm.findIndex((v) => v == null);
      if (missing >= 0) {
        const id = idents[missing]!;
        const why =
          raw[missing] == null
            ? `No ${id.label} found in the ${source === "names" ? "file name" : "spreadsheet"}`
            : `"${raw[missing]}" isn't a valid ${id.kind === "date" ? "date" : id.label}`;
        return { item: f, key: null, lookup: "no_key", lookupMessage: why, record: null };
      }
      const values = norm as string[];
      const display = displayKey(values);
      const r = results.get(joinKey(values));
      if (!r) return { item: f, key: display, lookup: "not_found", record: null };
      if (r.status === "found") return { item: f, key: display, lookup: "found", record: r.record };
      if (r.status === "multiple") return { item: f, key: display, lookup: "multiple", record: null, candidates: r.records };
      if (r.status === "error") return { item: f, key: display, lookup: "error", lookupMessage: r.message, record: null };
      return { item: f, key: display, lookup: "not_found", record: null };
    });
    setProgress(null);
    onMatched(rows);
  };

  const busy = progress !== null;
  const partsSample = files[0] ? nameParts(files[0]) : [];
  const maxParts = Math.max(1, ...files.slice(0, 30).map((f) => nameParts(f).length));
  const canFind = idents.length > 0 && !(source === "sheet" && !sheet);

  return (
    <div className="space-y-6">
      {/* 1. What identifies a record */}
      <Card className="p-6">
        <Label hint="This is how each file gets linked to the right record.">How should records be identified?</Label>
        <div className="grid sm:grid-cols-2 gap-2 max-w-2xl mt-2">
          {(
            [
              { id: "record_id", icon: Hash, title: "Apricot record ID", desc: "The number Apricot gives each record" },
              { id: "fields", icon: Layers, title: "Fields on this form", desc: "One field, or several together (e.g. last name + date of birth)" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              onClick={() => chooseMode(o.id)}
              className={cx(
                "rounded-xl p-4 text-left ring-1 transition cursor-pointer",
                mode === o.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300",
              )}
            >
              <o.icon className="size-5 text-brand-700 mb-2" />
              <div className="font-medium text-sm">{o.title}</div>
              <div className="text-xs text-stone-500 mt-0.5">{o.desc}</div>
            </button>
          ))}
        </div>

        {mode === "fields" && (
          <div className="mt-6">
            <div className="text-sm font-medium text-stone-800">
              Which fields? <span className="font-normal text-stone-500">Pick more than one if a single field isn't unique on its own.</span>
            </div>
            {options.length === 0 ? (
              <div className="mt-3">
                <Callout tone="amber">This form has no text, number, date or name fields to match on. Use the record ID instead.</Callout>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {options.map((o) => {
                  const on = picked.includes(o.key);
                  const order = picked.indexOf(o.key) + 1;
                  return (
                    <button
                      key={o.key}
                      onClick={() => togglePick(o)}
                      disabled={!on && picked.length >= MAX_FIELDS}
                      title={`Field ID ${o.fieldId}`}
                      className={cx(
                        "inline-flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1.5 text-sm ring-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                        on ? "bg-brand-800 text-white ring-brand-800" : "bg-white ring-stone-200 hover:ring-stone-300 text-stone-700",
                      )}
                    >
                      <span
                        className={cx(
                          "size-5 rounded-full grid place-items-center text-[11px] font-semibold",
                          on ? "bg-lime-500 text-brand-900" : "bg-stone-100 text-stone-400",
                        )}
                      >
                        {on ? order : <Check className="size-3" />}
                      </span>
                      {o.label}
                      <span className={cx("text-[11px] font-mono", on ? "text-brand-200" : "text-stone-400")}>{o.fieldId}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {picked.length > 1 && (
              <p className="text-sm text-stone-600 mt-3">
                A record matches only when <strong>all {picked.length}</strong> agree: {combinedLabel}.
              </p>
            )}
          </div>
        )}
      </Card>

      {idents.length > 0 && (
        <Card className="p-6">
          <Label>Where are these values?</Label>
          <div className="grid grid-cols-2 gap-2 max-w-xl mt-2">
            {(
              [
                { id: "names", icon: FileText, title: "In the file names", desc: "e.g. Doe_Jane_1985-03-02.pdf" },
                { id: "sheet", icon: FileSpreadsheet, title: "In a spreadsheet", desc: "A list saying which file goes where" },
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

          {source === "names" && (
            <div className="mt-6 space-y-4">
              {files[0] && (
                <div className="text-sm text-stone-600 leading-7">
                  File names are split into parts at underscores and spaces. For example,{" "}
                  <span className="font-mono text-stone-800">{files[0].file.name}</span> becomes{" "}
                  {partsSample.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1 mr-1 rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800">
                      <span className="text-stone-400">{i + 1}</span>
                      {p}
                    </span>
                  ))}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
                {idents.map((id, i) => (
                  <div key={id.key}>
                    <Label>{id.label}</Label>
                    <Select
                      value={sourceId(sources[i] ?? { type: "whole" })}
                      onChange={(e) => setSources(idents.map((_, j) => (j === i ? parseSourceId(e.target.value) : (sources[j] ?? { type: "whole" }))))}
                    >
                      {Array.from({ length: maxParts }, (_, p) => (
                        <option key={p} value={`part:${p}`}>
                          Part {p + 1}
                          {partsSample[p] ? ` (e.g. "${partsSample[p]}")` : ""}
                        </option>
                      ))}
                      <option value="number">The first number in the name</option>
                      <option value="whole">The whole file name</option>
                      <option value="folder">The name of the folder it's in</option>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {source === "sheet" && (
            <div className="mt-6 space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  icon={<Download className="size-4" />}
                  onClick={() =>
                    downloadSheet(
                      `Attach files - ${target.form.name}.xlsx`,
                      ["File name", ...idents.map((i) => i.label)],
                      files.map((f) => [f.file.name, ...idents.map(() => null)]),
                      [48, ...idents.map(() => 26)],
                    )
                  }
                >
                  Download a template with your {files.length} files
                </Button>
                <span className="text-sm text-stone-500">Fill it in, save, then add it here.</span>
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
                  {sheet ? (
                    <>
                      Using <strong>{sheet.name}</strong> · {sheet.rows.length - 1} rows
                    </>
                  ) : (
                    "Drop your filled-in spreadsheet here"
                  )}
                </div>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => sheetInput.current?.click()}>
                  {sheet ? "Choose a different file" : "Choose file"}
                </Button>
                <input
                  ref={sheetInput}
                  type="file"
                  accept=".xlsx,.csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) loadSheet(f);
                    e.target.value = "";
                  }}
                />
              </div>
              {sheetError && <Callout tone="red">{sheetError}</Callout>}
              {sheet && (
                <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
                  <div>
                    <Label>Column with the file names</Label>
                    <Select value={fileCol} onChange={(e) => setFileCol(Number(e.target.value))}>
                      {sheet.rows[0]!.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </Select>
                  </div>
                  {idents.map((id, i) => (
                    <div key={id.key}>
                      <Label>Column with {id.label}</Label>
                      <Select value={cols[i] ?? 0} onChange={(e) => setCols(idents.map((_, j) => (j === i ? Number(e.target.value) : (cols[j] ?? 0))))}>
                        {sheet.rows[0]!.map((h, j) => (
                          <option key={j} value={j}>{h || `Column ${j + 1}`}</option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(source === "names" || sheet) && <PreviewTable rows={keyed.slice(0, 8)} idents={idents} />}
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
          ) : idents.length === 0 ? (
            <div className="text-sm text-stone-500">Choose at least one field above.</div>
          ) : (
            <div className="text-sm text-stone-600">
              <strong className="text-stone-900">{complete.toLocaleString()}</strong> of {files.length.toLocaleString()} files have a usable{" "}
              {combinedLabel}.{complete < files.length && " You can match the rest by hand on the next screen."}
            </div>
          )}
        </div>
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button icon={<Search className="size-4" />} onClick={findRecords} loading={busy} disabled={!canFind}>
          Find records
        </Button>
      </Card>
    </div>
  );
}

function PreviewTable({ rows, idents }: { rows: { f: FileItem; raw: (string | null)[]; norm: (string | null)[] }[]; idents: Ident[] }) {
  const grid = { gridTemplateColumns: `minmax(0,1.4fr) repeat(${idents.length}, minmax(0,1fr))` };
  return (
    <div className="mt-6 rounded-xl ring-1 ring-stone-200 overflow-hidden">
      <div className="grid gap-3 px-4 py-2 bg-stone-50 text-xs font-medium text-stone-500 uppercase tracking-wide" style={grid}>
        <span>File</span>
        {idents.map((i) => (
          <span key={i.key} className="truncate">{i.label}</span>
        ))}
      </div>
      {rows.map(({ f, raw, norm }) => (
        <div key={f.id} className="grid gap-3 px-4 py-2 text-sm border-t border-stone-100" style={grid}>
          <span className="truncate text-stone-700" title={f.path}>{f.path}</span>
          {idents.map((id, i) =>
            norm[i] != null ? (
              <span key={id.key} className="font-mono text-stone-900 truncate" title={raw[i] ?? ""}>
                {norm[i]}
                {raw[i] !== norm[i] && <span className="text-stone-400 font-sans text-xs"> (from "{raw[i]}")</span>}
              </span>
            ) : (
              <span key={id.key} className="text-amber-700 truncate">{raw[i] == null ? "Not found" : `"${raw[i]}" isn't valid`}</span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
