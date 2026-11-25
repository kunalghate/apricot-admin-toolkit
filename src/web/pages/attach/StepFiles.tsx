import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, FileIcon, FileSpreadsheet, FileText, Globe, Link2, Plus, RefreshCw, Upload, X } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, formatBytes, Label, plural, Select, Spinner } from "../../components/ui";
import { LocationPicker, type PickedFiles } from "../../components/LocationPicker";
import { type FileItem } from "../../lib/files";
import { readTable } from "../../lib/sheets";
import {
  guessFieldForColumn, guessFileColumns, indexFiles, isAbsolutePath, pathStyle, resolveFile, sheetRowNumber, type Resolution, type Sheet,
} from "../../lib/mapping";
import { fileExtension, fileTypeRisk, isAttachmentField, isImageField, isImageFile, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../../../shared/fields";
import type { FileLocation } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import type { Source } from "./model";

type Mode = "names" | "sheet";

export function StepFiles({
  target,
  initial,
  onBack,
  onNext,
}: {
  target: Target;
  initial: Source | null;
  onBack: () => void;
  onNext: (s: Source) => void;
}) {
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "names");
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <Label hint="This decides how each file gets linked to the right record.">How do you know which file goes to which record?</Label>
        <div className="grid sm:grid-cols-2 gap-2 max-w-3xl mt-2">
          {(
            [
              { id: "names", icon: FileText, title: "The file names say", desc: "e.g. 25698_consent.pdf or Doe_Jane_1985-03-02.pdf" },
              { id: "sheet", icon: FileSpreadsheet, title: "A spreadsheet says", desc: "A list with a file (name, path or link) and the record it belongs to on each row" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              onClick={() => setMode(o.id)}
              className={cx("rounded-xl p-4 text-left ring-1 transition cursor-pointer", mode === o.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300")}
            >
              <o.icon className="size-5 text-brand-700 mb-2" />
              <div className="font-medium text-sm">{o.title}</div>
              <div className="text-xs text-stone-500 mt-0.5">{o.desc}</div>
            </button>
          ))}
        </div>
      </Card>
      {mode === "names" ? (
        <NamesFiles key="names" target={target} initial={initial?.mode === "names" ? initial : null} onBack={onBack} onNext={onNext} />
      ) : (
        <SheetFiles key="sheet" target={target} initial={initial?.mode === "sheet" ? initial : null} onBack={onBack} onNext={onNext} />
      )}
    </div>
  );
}

// ── Files whose names identify the record ────────────────────────────────────

function NamesFiles({ target, initial, onBack, onNext }: { target: Target; initial: Source | null; onBack: () => void; onNext: (s: Source) => void }) {
  const [picked, setPicked] = useState<PickedFiles | null>(
    initial ? { location: initial.location, label: initial.locationLabel, files: initial.files, truncated: false } : null,
  );
  if (!picked) return <LocationPicker onPicked={setPicked} />;
  const files = picked.files;
  return (
    <>
      <FileSummary files={files} label={picked.label} truncated={picked.truncated} imageOnly={isImageField(target.fileField)} fieldLabel={target.fileField.label} onChange={() => setPicked(null)} />
      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        <Button
          disabled={files.length === 0}
          icon={<ArrowRight className="size-4" />}
          onClick={() => onNext({ mode: "names", location: picked.location, locationLabel: picked.label, files })}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

function FileSummary({
  files,
  label,
  truncated,
  imageOnly,
  fieldLabel,
  onChange,
}: {
  files: FileItem[];
  label: string;
  truncated: boolean;
  imageOnly: boolean;
  fieldLabel: string;
  onChange: () => void;
}) {
  const total = files.reduce((n, f) => n + (f.size ?? 0), 0);
  const blocked = files.filter((f) => fileTypeRisk(f.name) === "blocked");
  const unusual = files.filter((f) => fileTypeRisk(f.name) === "unusual");
  const large = files.filter((f) => (f.size ?? 0) > MAX_UPLOAD_BYTES);
  const notImages = imageOnly ? files.filter((f) => !isImageFile(f.name)) : [];
  const types = [...new Set(files.map((f) => fileExtension(f.name) || "no extension"))];
  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-stone-100">
          <div className="text-sm min-w-0">
            <div className="font-medium">{plural(files.length, "file")} <span className="font-normal text-stone-500">· {formatBytes(total)} · {types.slice(0, 6).join(", ")}{types.length > 6 ? "…" : ""}</span></div>
            <div className="text-xs text-stone-500 truncate" title={label}>From {label}</div>
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onChange}>Choose different files</Button>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
          {files.slice(0, 300).map((f) => {
            const risk = fileTypeRisk(f.name);
            return (
              <div key={f.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                <FileIcon className="size-4 text-stone-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate" title={f.path}>{f.path}</span>
                {risk === "blocked" && <Badge tone="red">Unsafe type</Badge>}
                {risk === "unusual" && <Badge tone="amber">Unusual type</Badge>}
                {(f.size ?? 0) > MAX_UPLOAD_BYTES && <Badge tone="red">Over {MAX_UPLOAD_LABEL}</Badge>}
                {f.size != null && <span className="text-stone-400 tabular-nums w-16 text-right">{formatBytes(f.size)}</span>}
              </div>
            );
          })}
          {files.length > 300 && <div className="px-5 py-2 text-sm text-stone-500">…and {(files.length - 300).toLocaleString()} more</div>}
        </div>
      </Card>
      <div className="space-y-2">
        {truncated && <Callout tone="amber" title="That's a very large folder">Only the first 100,000 files were listed. Choose a smaller folder to be sure every file is included.</Callout>}
        {blocked.length > 0 && <Callout tone="red" title={`${plural(blocked.length, "program file")} will be skipped`}>Files like .exe can't be attached to Apricot records.</Callout>}
        {notImages.length > 0 && <Callout tone="red" title={`${plural(notImages.length, "file")} aren't pictures and will be skipped`}>"{fieldLabel}" is an Image field, so only pictures (.jpg, .png, .gif…) can go in it.</Callout>}
        {unusual.length > 0 && !imageOnly && (
          <Callout tone="amber" title={`${plural(unusual.length, "file")} with a less common type`}>
            Each Apricot organization decides which file types it accepts. These will be tried. If Apricot rejects a type, the rest of that type are skipped.
          </Callout>
        )}
        {large.length > 0 && <Callout tone="red" title={`${plural(large.length, "file")} over ${MAX_UPLOAD_LABEL} will be skipped`}>The Apricot API only accepts files up to {MAX_UPLOAD_LABEL}. Compress or split these, or attach them in Apricot directly.</Callout>}
      </div>
    </>
  );
}

// ── A mapping spreadsheet ────────────────────────────────────────────────────

function SheetFiles({ target, initial, onBack, onNext }: { target: Target; initial: Source | null; onBack: () => void; onNext: (s: Source) => void }) {
  const fileFields = target.fields.filter((f) => isAttachmentField(f) && f.active && !f.hidden);
  const [sheet, setSheet] = useState<Sheet | null>(initial?.sheet?.sheet ?? null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [fileCols, setFileCols] = useState<{ col: number; fieldId: number }[]>(initial?.sheet?.fileCols ?? []);
  const [picked, setPicked] = useState<PickedFiles | null>(
    initial && initial.location.kind !== "web" ? { location: initial.location, label: initial.locationLabel, files: initial.files, truncated: false } : null,
  );
  const [fullPaths, setFullPaths] = useState<{ checking: boolean; files: FileItem[] | null; error?: string }>({ checking: false, files: null });
  const [useFolderInstead, setUseFolderInstead] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);

  const loadSheet = async (file: File) => {
    setSheetError(null);
    try {
      const all = await readTable(file);
      if (all.length < 2) throw new Error("That spreadsheet looks empty. It needs a header row and at least one row of data.");
      const width = Math.max(...all.slice(0, 50).map((r) => r.length));
      const header = Array.from({ length: width }, (_, i) => all[0]![i]?.trim() || `Column ${i + 1}`);
      const s: Sheet = { name: file.name, header, rows: all.slice(1) };
      setSheet(s);
      const guessed = guessFileColumns(s);
      const options = fileFields.map((f) => ({ id: f.id, label: f.label, image: isImageField(f) }));
      const taken = new Set<number>();
      setFileCols(
        guessed.map((col, i) => {
          // By header words first; otherwise the first column → the field chosen on step 1, others → the next unused field.
          const next = fileFields.find((f) => !taken.has(f.id) && f.id !== target.fileField.id)?.id ?? target.fileField.id;
          const fid = guessFieldForColumn(s, col, options, taken, i === 0 && !taken.has(target.fileField.id) ? target.fileField.id : next);
          taken.add(fid);
          return { col, fieldId: fid };
        }),
      );
      setPicked(null);
      setFullPaths({ checking: false, files: null });
      setUseFolderInstead(false);
    } catch (e) {
      setSheetError((e as Error).message || "Couldn't read that file. Use an Excel (.xlsx) or CSV file.");
    }
  };

  const values = useMemo(() => (sheet ? sheet.rows.flatMap((r) => fileCols.map((c) => r[c.col] ?? "")).filter((v) => v.trim()) : []), [sheet, fileCols]);
  const style = pathStyle(values);
  const usesLocation = style === "relative" || (style === "full" && useFolderInstead);

  // Full paths: check whether they exist on this computer as written.
  useEffect(() => {
    if (!sheet || style !== "full" || useFolderInstead) return;
    let cancelled = false;
    (async () => {
      setFullPaths({ checking: true, files: null });
      try {
        const unique = [...new Set(values.filter(isAbsolutePath).map((v) => v.trim()))];
        const found: FileItem[] = [];
        for (let i = 0; i < unique.length; i += 5000) {
          const part = unique.slice(i, i + 5000);
          const sizes = await api.stat(part);
          sizes.forEach((size, j) => {
            if (size != null) {
              const path = part[j]!.replace(/^["']+|["']+$/g, "");
              found.push({ id: `abs:${path}`, path, name: path.split(/[\\/]/).pop()!, size });
            }
          });
        }
        if (!cancelled) setFullPaths({ checking: false, files: found });
      } catch (e) {
        if (!cancelled) setFullPaths({ checking: false, files: [], error: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheet, style, useFolderInstead, values.length]);

  // Where the files are, and what each cell resolves to.
  const hasCols = fileCols.length > 0;
  const located = useMemo<{ location: FileLocation; label: string; files: FileItem[] } | null>(() => {
    if (!sheet || !hasCols) return null;
    if (style === "links") return { location: { kind: "web" }, label: "Web links in the spreadsheet", files: [] };
    if (style === "full" && !useFolderInstead)
      return fullPaths.files ? { location: { kind: "computer", root: "" }, label: "The paths in the spreadsheet", files: fullPaths.files } : null;
    return picked ? { location: picked.location, label: picked.label, files: picked.files } : null;
  }, [sheet, hasCols, style, useFolderInstead, fullPaths.files, picked]);

  const resolved = useMemo<Resolution[][] | null>(() => {
    if (!sheet || !located) return null;
    const root = located.location.kind === "computer" || located.location.kind === "server" ? located.location.root : "";
    const idx = indexFiles(located.files, root);
    return sheet.rows.map((r) => fileCols.map((c) => resolveFile(r[c.col] ?? "", idx)));
  }, [sheet, located, fileCols]);

  const stats = useMemo(() => {
    if (!resolved) return null;
    const s = { found: 0, missing: 0, ambiguous: 0, empty: 0 };
    for (const row of resolved) for (const r of row) s[r.status]++;
    const used = new Set<string>();
    for (const row of resolved) for (const r of row) if (r.status === "found") used.add(r.file.id);
    const unused = located ? located.files.filter((f) => !used.has(f.id)).length : 0;
    const examples: { row: number; value: string; status: "missing" | "ambiguous" }[] = [];
    resolved.forEach((row, i) =>
      row.forEach((r, j) => {
        if ((r.status === "missing" || r.status === "ambiguous") && examples.length < 6)
          examples.push({ row: sheetRowNumber(i), value: sheet!.rows[i]![fileCols[j]!.col] ?? "", status: r.status });
      }),
    );
    return { ...s, unused, examples };
  }, [resolved]);

  const usedCols = fileCols.map((c) => c.col);
  const otherCols = sheet ? sheet.header.map((_, i) => i).filter((i) => !usedCols.includes(i)) : [];

  return (
    <>
      {/* 1. The spreadsheet */}
      <Card className="p-6">
        <Label hint="Excel (.xlsx) or CSV. Use it as it is: you'll tell the toolkit which columns are which.">The spreadsheet</Label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) loadSheet(f);
          }}
          className="mt-2 rounded-xl border-2 border-dashed border-stone-200 p-5 flex items-center gap-4"
        >
          <div className="size-10 rounded-xl bg-brand-50 text-brand-700 grid place-items-center shrink-0">
            <FileSpreadsheet className="size-5" />
          </div>
          <div className="flex-1 text-sm">
            {sheet ? (
              <>
                <strong>{sheet.name}</strong> <span className="text-stone-500">· {plural(sheet.rows.length, "row")} · {plural(sheet.header.length, "column")}</span>
              </>
            ) : (
              <span className="text-stone-500">Drop the spreadsheet here, or choose it.</span>
            )}
          </div>
          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => sheetInput.current?.click()}>
            {sheet ? "Choose a different one" : "Choose spreadsheet"}
          </Button>
          <input ref={sheetInput} type="file" accept=".xlsx,.csv" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadSheet(f);
            e.target.value = "";
          }} />
        </div>
        {sheetError && <div className="mt-3"><Callout tone="red">{sheetError}</Callout></div>}
      </Card>

      {/* 2. Which columns have files */}
      {sheet && (
        <Card className="p-6">
          <Label hint="A column can hold file names, paths (like C:\Exports\abc.pdf), or web links. Each column goes into one file field.">
            Which columns have the files?
          </Label>
          <div className="mt-3 space-y-2 max-w-3xl">
            {fileCols.map((c, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl ring-1 ring-stone-200 p-3">
                <div className="flex-1 min-w-0">
                  <Select value={c.col} onChange={(e) => setFileCols(fileCols.map((x, j) => (j === i ? { ...x, col: Number(e.target.value) } : x)))}>
                    {sheet.header.map((h, col) => (
                      <option key={col} value={col} disabled={col !== c.col && usedCols.includes(col)}>{h}</option>
                    ))}
                  </Select>
                  <div className="text-xs text-stone-500 mt-1.5 truncate font-mono">
                    e.g. {sheet.rows.slice(0, 3).map((r) => r[c.col]).filter(Boolean).join("  ·  ") || "(empty)"}
                  </div>
                </div>
                <ArrowRight className="size-4 text-stone-400 shrink-0" />
                <div className="w-64">
                  <Select value={c.fieldId} onChange={(e) => setFileCols(fileCols.map((x, j) => (j === i ? { ...x, fieldId: Number(e.target.value) } : x)))}>
                    {fileFields.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}{isImageField(f) ? " (pictures)" : ""} · ID {f.id}</option>
                    ))}
                  </Select>
                </div>
                <button className="text-stone-400 hover:text-stone-700 cursor-pointer" onClick={() => setFileCols(fileCols.filter((_, j) => j !== i))} aria-label="Remove">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {fileCols.length === 0 && <Callout tone="amber">Couldn't spot a column with files in it. Add one below.</Callout>}
            {otherCols.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus className="size-4" />}
                onClick={() => {
                  const fid = fileFields.find((f) => !fileCols.some((c) => c.fieldId === f.id))?.id ?? target.fileField.id;
                  setFileCols([...fileCols, { col: otherCols[0]!, fieldId: fid }]);
                }}
              >
                {fileCols.length ? "Add another file column" : "Add a file column"}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* 3. Where the files are */}
      {sheet && fileCols.length > 0 && (
        <>
          {style === "links" && (
            <Callout tone="blue" icon={<Globe className="size-4" />} title="These are web links">
              The toolkit downloads each file from its link during the upload. Links must open the file directly, without a sign-in.
            </Callout>
          )}
          {style === "full" && !useFolderInstead && (
            <Card className="p-5 flex items-center gap-4">
              <Link2 className="size-5 text-brand-700 shrink-0" />
              <div className="flex-1 text-sm">
                {fullPaths.checking ? (
                  <Spinner label="Checking the paths in the spreadsheet on this computer…" />
                ) : (
                  <>
                    The spreadsheet has full paths. <strong>{(fullPaths.files?.length ?? 0).toLocaleString()}</strong> of {new Set(values).size.toLocaleString()} files are at those paths on this computer.
                    {fullPaths.error && <div className="text-red-700 mt-1">{fullPaths.error}</div>}
                  </>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setUseFolderInstead(true)}>The files are somewhere else</Button>
            </Card>
          )}
          {usesLocation &&
            (picked ? (
              <Card className="p-5 flex items-center gap-4">
                <CheckCircle2 className="size-5 text-lime-700 shrink-0" />
                <div className="flex-1 text-sm min-w-0">
                  <div className="truncate">Files from <strong title={picked.label}>{picked.label}</strong></div>
                  <div className="text-xs text-stone-500">{plural(picked.files.length, "file")} there</div>
                </div>
                <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => setPicked(null)}>Change</Button>
              </Card>
            ) : (
              <LocationPicker
                onPicked={setPicked}
                intro={
                  <div>
                    <div className="text-sm font-medium text-stone-800">Where are the files listed in the spreadsheet?</div>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Pick the folder that contains them (subfolders are included). Paths written on someone else's computer are matched by their ending.
                    </p>
                  </div>
                }
              />
            ))}
        </>
      )}

      {/* 4. What was found */}
      {stats && (
        <Card className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat n={stats.found} label="files found" tone="green" />
            <Stat n={stats.missing} label="not found" tone={stats.missing ? "red" : "neutral"} />
            <Stat n={stats.ambiguous} label="match several files" tone={stats.ambiguous ? "amber" : "neutral"} />
            <Stat n={stats.empty} label="empty cells" tone="neutral" />
          </div>
          {stats.examples.length > 0 && (
            <div className="mt-5 rounded-xl ring-1 ring-stone-200 divide-y divide-stone-100 text-sm">
              {stats.examples.map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-xs text-stone-400 w-14 shrink-0">Row {e.row}</span>
                  <span className="flex-1 truncate font-mono text-xs">{e.value}</span>
                  <Badge tone={e.status === "missing" ? "red" : "amber"}>{e.status === "missing" ? "Not found" : "Several match"}</Badge>
                </div>
              ))}
            </div>
          )}
          {(stats.missing > 0 || stats.ambiguous > 0) && (
            <p className="text-sm text-stone-500 mt-3">You can continue. You'll see every problem on the Review step, and can download the list to fix in the spreadsheet.</p>
          )}
          {stats.unused > 0 && located && located.files.length > 0 && (
            <p className="text-xs text-stone-400 mt-2">{plural(stats.unused, "file")} in that location {stats.unused === 1 ? "isn't" : "aren't"} in the spreadsheet. They'll be left alone.</p>
          )}
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        <Button
          disabled={!sheet || !located || !resolved || !stats || stats.found + stats.ambiguous === 0}
          icon={<ArrowRight className="size-4" />}
          onClick={() =>
            sheet && located && resolved && onNext({ mode: "sheet", location: located.location, locationLabel: located.label, files: located.files, sheet: { sheet, fileCols, resolved } })
          }
        >
          Continue
        </Button>
      </div>
    </>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "green" | "red" | "amber" | "neutral" }) {
  const color = { green: "text-lime-700", red: "text-red-600", amber: "text-amber-600", neutral: "text-stone-400" }[tone];
  return (
    <div>
      <div className={cx("text-2xl font-semibold tabular-nums", n ? color : "text-stone-300")}>{n.toLocaleString()}</div>
      <div className="text-sm text-stone-500">{label}</div>
    </div>
  );
}
