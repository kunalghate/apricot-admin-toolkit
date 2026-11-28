import { useMemo, useState } from "react";
import { ArrowLeft, Check, Hash, Layers, Search } from "lucide-react";
import { api } from "../../api";
import { Button, Callout, Card, cx, Label, Progress, Select } from "../../components/ui";
import { extractValue, guessSources, nameParts, parseSourceId, sourceId, type PartSource } from "../../lib/files";
import { guessColumnFor, guessRecordIdColumn, sheetRowNumber } from "../../lib/mapping";
import { displayKey, identifierOptions, joinKey, normalizeValue, type IdentifierOption } from "../../../shared/identifiers";
import type { Connection, MatchBy, MatchResult } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import type { Row, Source } from "./model";

type Mode = "record_id" | "fields";

/** One thing needed per row: the record ID, or the value of one identifying field. */
interface Ident {
  key: string;
  label: string;
  kind: "text" | "date" | "record_id";
  fieldId?: number;
}

const RECORD_ID: Ident = { key: "record_id", label: "Apricot record ID", kind: "record_id" };
const MAX_FIELDS = 4;
const CHUNK = 100;
const PARALLEL = 3;

const normalize = (v: string | null, id: Ident): string | null => {
  if (v == null) return null;
  if (id.kind === "record_id") {
    const t = v.trim().replace(/\.0+$/, ""); // Excel sometimes gives "25698.0"
    return /^\d+$/.test(t) ? t : null;
  }
  return normalizeValue(v, id.kind);
};

interface Keyed {
  raw: (string | null)[];
  norm: (string | null)[];
}

export function StepMatch({
  connection,
  target,
  source,
  onBack,
  onMatched,
}: {
  connection: Connection;
  target: Target;
  source: Source;
  onBack: () => void;
  onMatched: (rows: Row[]) => void;
}) {
  const options = useMemo(() => identifierOptions(target.fields), [target.fields]);
  const sheet = source.sheet?.sheet;
  const fileColIdx = source.sheet?.fileCols.map((c) => c.col) ?? [];
  const toIdent = (o: IdentifierOption): Ident => ({ key: o.key, label: o.label, kind: o.kind, fieldId: o.fieldId });

  const initialIdCol = sheet ? guessRecordIdColumn(sheet, fileColIdx) : null;
  const [mode, setMode] = useState<Mode>(sheet && initialIdCol == null && options.length ? "fields" : "record_id");
  const [picked, setPicked] = useState<string[]>([]);
  const idents: Ident[] = mode === "record_id" ? [RECORD_ID] : picked.map((k) => toIdent(options.find((x) => x.key === k)!));

  // File names: where each value comes from.
  const [sources, setSources] = useState<PartSource[]>(() => guessSources(source.files, [RECORD_ID]));
  // Spreadsheet: which column has each value.
  const [cols, setCols] = useState<number[]>(() => [initialIdCol ?? 0]);

  const guessCols = (next: Ident[]) => {
    if (!sheet) return;
    const used = [...fileColIdx];
    setCols(
      next.map((id) => {
        const c = id.kind === "record_id" ? guessRecordIdColumn(sheet, used) : guessColumnFor(sheet, options.find((o) => o.key === id.key)!, used);
        const col = c ?? sheet.header.findIndex((_, i) => !used.includes(i));
        used.push(col);
        return Math.max(0, col);
      }),
    );
  };
  const resetFor = (next: Ident[]) => {
    setSources(guessSources(source.files, next));
    guessCols(next);
  };
  const chooseMode = (m: Mode) => {
    setMode(m);
    resetFor(m === "record_id" ? [RECORD_ID] : picked.map((k) => toIdent(options.find((x) => x.key === k)!)));
  };
  const togglePick = (o: IdentifierOption) => {
    const next = picked.includes(o.key) ? picked.filter((k) => k !== o.key) : [...picked, o.key].slice(0, MAX_FIELDS);
    setPicked(next);
    resetFor(next.map((k) => toIdent(options.find((x) => x.key === k)!)));
  };

  const combinedLabel = idents.map((i) => i.label).join(" + ") || "identifier";

  const keyedOf = (raw: (string | null)[]): Keyed => ({ raw, norm: raw.map((v, i) => normalize(v, idents[i]!)) });
  const keyedFiles = useMemo(
    () => (sheet ? [] : source.files.map((f) => ({ f, ...keyedOf(idents.map((_, i) => extractValue(f, sources[i] ?? { type: "whole" }))) }))),
    [source.files, sources, mode, picked, sheet],
  );
  const keyedRows = useMemo(
    () => (sheet ? sheet.rows.map((r) => keyedOf(idents.map((_, i) => r[cols[i] ?? 0]?.trim() || null))) : []),
    [sheet, cols, mode, picked],
  );
  const total = sheet ? keyedRows.length : keyedFiles.length;
  const complete = (sheet ? keyedRows : keyedFiles).filter((k) => idents.length > 0 && k.norm.every((v) => v != null)).length;

  const [progress, setProgress] = useState<{ done: number; total: number; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const findRecords = async () => {
    setError(null);
    const matchBy: MatchBy =
      mode === "record_id" ? { kind: "record_id" } : { kind: "fields", keys: idents.map((i) => ({ key: i.key, kind: i.kind === "date" ? "date" : "text" })) };
    const fileFieldIds = sheet ? [...new Set(source.sheet!.fileCols.map((c) => c.fieldId))] : [target.fileField.id];
    const tuples = new Map<string, string[]>();
    for (const k of sheet ? keyedRows : keyedFiles) if (k.norm.every((v) => v != null)) tuples.set(joinKey(k.norm as string[]), k.norm as string[]);
    const all = [...tuples.values()];
    const chunks: string[][][] = [];
    for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
    const results = new Map<string, MatchResult>();
    const started = Date.now();
    setProgress({ done: 0, total: all.length, startedAt: started });
    try {
      let next = 0;
      let done = 0;
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL, chunks.length) }, async () => {
          while (next < chunks.length) {
            const part = chunks[next++]!;
            let res: MatchResult[] | null = null;
            for (let attempt = 0; !res; attempt++) {
              try {
                res = await api.match(connection.id, { formId: target.form.id, fileFieldIds, matchBy, keys: part });
              } catch (e) {
                if (attempt >= 2) throw e;
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
              }
            }
            for (const r of res) results.set(r.key, r);
            done += part.length;
            setProgress({ done, total: all.length, startedAt: started });
          }
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
      return;
    }

    const lookup = (k: Keyed): Pick<Row, "key" | "lookup" | "lookupMessage" | "record" | "candidates"> => {
      const missing = k.norm.findIndex((v) => v == null);
      if (missing >= 0) {
        const id = idents[missing]!;
        const where = sheet ? "spreadsheet" : "file name";
        const msg = k.raw[missing] == null ? `No ${id.label} in the ${where}` : `"${k.raw[missing]}" isn't a valid ${id.kind === "date" ? "date" : id.label}`;
        return { key: null, lookup: "no_key", lookupMessage: msg, record: null };
      }
      const values = k.norm as string[];
      const key = displayKey(values);
      const r = results.get(joinKey(values));
      if (r?.status === "found") return { key, lookup: "found", record: r.record };
      if (r?.status === "multiple") return { key, lookup: "multiple", record: null, candidates: r.records };
      if (r?.status === "error") return { key, lookup: "error", lookupMessage: r.message, record: null };
      return { key, lookup: "not_found", record: null };
    };

    let rows: Row[];
    if (!sheet) {
      rows = keyedFiles.map(({ f, ...k }): Row => ({ id: f.id, file: f, fieldId: target.fileField.id, ...lookup(k) }));
    } else {
      const { fileCols, resolved, colLocation } = source.sheet!;
      rows = [];
      keyedRows.forEach((k, i) => {
        const l = lookup(k);
        fileCols.forEach((c, j) => {
          const res = resolved[i]![j]!;
          if (res.status === "empty") return;
          rows.push({
            id: `r${i}:${j}`,
            file: res.status === "found" ? res.file : null,
            fileIssue: res.status === "missing" ? "missing" : res.status === "ambiguous" ? "ambiguous" : undefined,
            fileWanted: sheet.rows[i]![c.col] ?? "",
            fileCandidates: res.status === "ambiguous" ? res.candidates : undefined,
            fieldId: c.fieldId,
            loc: colLocation[j] ?? 0,
            sheetRow: sheetRowNumber(i),
            ...l,
          });
        });
      });
    }
    setProgress(null);
    onMatched(rows);
  };

  const busy = progress !== null;
  const partsSample = source.files[0] ? nameParts(source.files[0]) : [];
  const maxParts = Math.max(1, ...source.files.slice(0, 30).map((f) => nameParts(f).length));
  const eta = progress && progress.done > 0 ? Math.round((((Date.now() - progress.startedAt) / progress.done) * (progress.total - progress.done)) / 1000) : null;

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
              className={cx("rounded-xl p-4 text-left ring-1 transition cursor-pointer", mode === o.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300")}
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
                      <span className={cx("size-5 rounded-full grid place-items-center text-[11px] font-semibold", on ? "bg-lime-500 text-brand-900" : "bg-stone-100 text-stone-400")}>
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

      {/* 2. Where the values are */}
      {idents.length > 0 && (
        <Card className="p-6">
          {sheet ? (
            <>
              <Label hint={`From ${sheet.name}`}>Which column has each value?</Label>
              <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mt-2">
                {idents.map((id, i) => (
                  <div key={id.key}>
                    <div className="text-xs text-stone-500 mb-1">{id.label}</div>
                    <Select value={cols[i] ?? 0} onChange={(e) => setCols(idents.map((_, j) => (j === i ? Number(e.target.value) : (cols[j] ?? 0))))}>
                      {sheet.header.map((h, j) => (
                        <option key={j} value={j}>{h}</option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
              <Preview idents={idents} rows={keyedRows.slice(0, 8).map((k, i) => ({ id: String(i), label: `Row ${sheetRowNumber(i)}`, title: "", ...k }))} />
            </>
          ) : (
            <>
              <Label>Where in the file names?</Label>
              {source.files[0] && (
                <div className="text-sm text-stone-600 leading-7">
                  File names are split into parts at underscores and spaces. For example, <span className="font-mono text-stone-800">{source.files[0].name}</span> becomes{" "}
                  {partsSample.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1 mr-1 rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800">
                      <span className="text-stone-400">{i + 1}</span>
                      {p}
                    </span>
                  ))}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mt-4">
                {idents.map((id, i) => (
                  <div key={id.key}>
                    <div className="text-xs text-stone-500 mb-1">{id.label}</div>
                    <Select value={sourceId(sources[i] ?? { type: "whole" })} onChange={(e) => setSources(idents.map((_, j) => (j === i ? parseSourceId(e.target.value) : (sources[j] ?? { type: "whole" }))))}>
                      {Array.from({ length: maxParts }, (_, p) => (
                        <option key={p} value={`part:${p}`}>Part {p + 1}{partsSample[p] ? ` (e.g. "${partsSample[p]}")` : ""}</option>
                      ))}
                      <option value="number">The first number in the name</option>
                      <option value="whole">The whole file name</option>
                      <option value="folder">The name of the folder it's in</option>
                    </Select>
                  </div>
                ))}
              </div>
              <Preview idents={idents} rows={keyedFiles.slice(0, 8).map(({ f, ...k }) => ({ id: f.id, label: f.name, title: f.path, ...k }))} />
            </>
          )}
        </Card>
      )}

      {error && <Callout tone="red" title="Couldn't look up records">{error}</Callout>}

      <Card className="p-5 flex items-center gap-4">
        <div className="flex-1">
          {busy ? (
            <div className="space-y-2">
              <div className="text-sm text-stone-600 flex justify-between">
                <span>Looking up records in Apricot… {progress.done.toLocaleString()} of {progress.total.toLocaleString()}</span>
                {eta != null && eta > 5 && <span className="text-stone-400">about {formatDuration(eta)} left</span>}
              </div>
              <Progress value={progress.total ? (progress.done / progress.total) * 100 : 100} />
            </div>
          ) : idents.length === 0 ? (
            <div className="text-sm text-stone-500">Choose at least one field above.</div>
          ) : (
            <div className="text-sm text-stone-600">
              <strong className="text-stone-900">{complete.toLocaleString()}</strong> of {total.toLocaleString()} {sheet ? "rows" : "files"} have a usable {combinedLabel}.
              {complete < total && " You can match the rest by hand on the next screen."}
            </div>
          )}
        </div>
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>Back</Button>
        <Button icon={<Search className="size-4" />} onClick={findRecords} loading={busy} disabled={idents.length === 0}>Find records</Button>
      </Card>
    </div>
  );
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min`;
}

function Preview({ rows, idents }: { rows: ({ id: string; label: string; title: string } & Keyed)[]; idents: Ident[] }) {
  const grid = { gridTemplateColumns: `minmax(0,1.2fr) repeat(${idents.length}, minmax(0,1fr))` };
  return (
    <div className="mt-6 rounded-xl ring-1 ring-stone-200 overflow-hidden">
      <div className="grid gap-3 px-4 py-2 bg-stone-50 text-xs font-medium text-stone-500 uppercase tracking-wide" style={grid}>
        <span />
        {idents.map((i) => (
          <span key={i.key} className="truncate">{i.label}</span>
        ))}
      </div>
      {rows.map(({ id, label, title, raw, norm }) => (
        <div key={id} className="grid gap-3 px-4 py-2 text-sm border-t border-stone-100" style={grid}>
          <span className="truncate text-stone-500" title={title}>{label}</span>
          {idents.map((ident, i) =>
            norm[i] != null ? (
              <span key={ident.key} className="font-mono text-stone-900 truncate" title={raw[i] ?? ""}>
                {norm[i]}
                {raw[i]?.trim() !== norm[i] && <span className="text-stone-400 font-sans text-xs"> (from "{raw[i]}")</span>}
              </span>
            ) : (
              <span key={ident.key} className="text-amber-700 truncate">{raw[i] == null ? "Empty" : `"${raw[i]}" isn't valid`}</span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
