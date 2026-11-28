import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileIcon, FileSpreadsheet, FileText, Folder, FolderOpen, Globe, Link2, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, formatBytes, Label, plural, Select, Spinner } from "../../components/ui";
import { LocationPicker, type PickedFiles } from "../../components/LocationPicker";
import { type FileItem } from "../../lib/files";
import { readTable } from "../../lib/sheets";
import {
  guessFieldForColumn, guessFileColumns, indexFiles, isAbsolutePath, pathStyle, resolveFile, sheetRowNumber, type PathStyle, type Resolution, type Sheet,
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
        <Label>Match files to records</Label>
        <div className="grid sm:grid-cols-2 gap-2 max-w-3xl mt-2">
          {(
            [
              { id: "names", icon: FileText, title: "By file name", desc: "The name has the record ID or other details, like 25698_consent.pdf" },
              { id: "sheet", icon: FileSpreadsheet, title: "By spreadsheet", desc: "Each row lists a file (name, path or link) and its record" },
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
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onChange}>Select different files</Button>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
          {files.slice(0, 300).map((f) => {
            const risk = fileTypeRisk(f.name);
            return (
              <div key={f.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                <FileIcon className="size-4 text-stone-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate" title={f.path}>{f.path}</span>
                {risk === "blocked" && <Badge tone="red">Unsafe file type</Badge>}
                {risk === "unusual" && <Badge tone="amber">Unusual file type</Badge>}
                {(f.size ?? 0) > MAX_UPLOAD_BYTES && <Badge tone="red">More than {MAX_UPLOAD_LABEL}</Badge>}
                {f.size != null && <span className="text-stone-400 tabular-nums w-16 text-right">{formatBytes(f.size)}</span>}
              </div>
            );
          })}
          {files.length > 300 && <div className="px-5 py-2 text-sm text-stone-500">…and {(files.length - 300).toLocaleString()} more</div>}
        </div>
      </Card>
      <div className="space-y-2">
        {truncated && <Callout tone="amber" title="This folder is very large">Only the first 100,000 files are included. Select a smaller folder to include them all.</Callout>}
        {blocked.length > 0 && <Callout tone="red" title={`${plural(blocked.length, "program file")} will be skipped`}>You cannot attach program files, for example .exe files, to Apricot records.</Callout>}
        {notImages.length > 0 && <Callout tone="red" title={`${plural(notImages.length, "file")} will be skipped because ${notImages.length === 1 ? "it is not an image" : "they are not images"}`}>"{fieldLabel}" is an image field. It accepts only images, for example .jpg, .png or .gif files.</Callout>}
        {unusual.length > 0 && !imageOnly && (
          <Callout tone="amber" title={`${plural(unusual.length, "file")} with an unusual file type`}>
            Each Apricot organization sets the file types that it accepts. The toolkit will try to upload these files. If Apricot rejects a file type, the toolkit does not upload the other files of that type.
          </Callout>
        )}
        {large.length > 0 && <Callout tone="red" title={`${plural(large.length, "file")} over ${MAX_UPLOAD_LABEL} will be skipped`}>The Apricot API accepts files up to {MAX_UPLOAD_LABEL}. Make these files smaller, or attach them in Apricot.</Callout>}
      </div>
    </>
  );
}

// ── A mapping spreadsheet ────────────────────────────────────────────────────

type Place = { location: FileLocation; label: string; files: FileItem[] };

/** "…/Exports/Customer export" instead of the whole path; the full path shows on hover. */
const shortPlace = (label: string) => {
  const parts = label.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 && /[\\/]/.test(label) ? `…/${parts.slice(-2).join("/")}` : label;
};
/** Remembered so going Back and forward keeps the choices. Keyed by spreadsheet column. */
interface PickState {
  shared: PickedFiles | null;
  own: Record<number, PickedFiles>;
}

function SheetFiles({ target, initial, onBack, onNext }: { target: Target; initial: Source | null; onBack: () => void; onNext: (s: Source) => void }) {
  const fileFields = target.fields.filter((f) => isAttachmentField(f) && f.active && !f.hidden);
  const restored = initial?.sheet?.pickState as PickState | undefined;
  const [sheet, setSheet] = useState<Sheet | null>(initial?.sheet?.sheet ?? null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [fileCols, setFileCols] = useState<{ col: number; fieldId: number }[]>(initial?.sheet?.fileCols ?? []);
  const [suggested, setSuggested] = useState<{ col: number; fieldId: number }[]>([]);
  const [shared, setShared] = useState<PickedFiles | null>(restored?.shared ?? null);
  const [own, setOwn] = useState<Record<number, PickedFiles>>(restored?.own ?? {});
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [fullPaths, setFullPaths] = useState<{ checking: boolean; files: FileItem[] | null; error?: string }>({ checking: false, files: null });
  const sheetInput = useRef<HTMLInputElement>(null);
  const fieldLabel = (id: number) => fileFields.find((f) => f.id === id)?.label ?? `Field ${id}`;

  const loadSheet = async (file: File) => {
    setSheetError(null);
    try {
      const all = await readTable(file);
      if (all.length < 2) throw new Error("The spreadsheet is empty. It must have a header row and one or more rows of data.");
      const width = Math.max(...all.slice(0, 50).map((r) => r.length));
      const header = Array.from({ length: width }, (_, i) => all[0]![i]?.trim() || `Column ${i + 1}`);
      const s: Sheet = { name: file.name, header, rows: all.slice(1) };
      setSheet(s);
      // Only the field chosen on step 1 is selected. Other file columns are offered, not assumed.
      const options = fileFields.map((f) => ({ id: f.id, label: f.label, image: isImageField(f) }));
      const guesses = guessFileColumns(s).map((col) => ({ col, fieldId: guessFieldForColumn(s, col, options, new Set(), 0) }));
      const primary = guesses.find((g) => g.fieldId === target.fileField.id) ?? guesses.find((g) => g.fieldId === 0) ?? guesses[0];
      setFileCols(primary ? [{ col: primary.col, fieldId: target.fileField.id }] : []);
      const used = new Set([target.fileField.id]);
      setSuggested(
        guesses
          .filter((g) => g !== primary)
          .map((g) => {
            const fid = g.fieldId && !used.has(g.fieldId) ? g.fieldId : (fileFields.find((f) => !used.has(f.id))?.id ?? 0);
            if (fid) used.add(fid);
            return { col: g.col, fieldId: fid };
          })
          .filter((g) => g.fieldId),
      );
      setShared(null);
      setOwn({});
      setPickingFor(null);
      setFullPaths({ checking: false, files: null });
    } catch (e) {
      setSheetError((e as Error).message || "The toolkit cannot read this file. Use an Excel (.xlsx) or CSV file.");
    }
  };

  // How each file column writes its files: links, full paths, or names/relative paths.
  const styles = useMemo(() => {
    const m = new Map<number, PathStyle>();
    if (sheet) for (const c of fileCols) m.set(c.col, pathStyle(sheet.rows.map((r) => r[c.col] ?? "")));
    return m;
  }, [sheet, fileCols]);

  // Full paths: check whether they exist on this computer as written.
  const fullCols = fileCols.filter((c) => styles.get(c.col) === "full" && !own[c.col]).map((c) => c.col);
  const fullKey = fullCols.join(",");
  useEffect(() => {
    if (!sheet || fullCols.length === 0) return;
    let cancelled = false;
    (async () => {
      setFullPaths({ checking: true, files: null });
      try {
        const unique = [...new Set(fullCols.flatMap((col) => sheet.rows.map((r) => (r[col] ?? "").trim())).filter(isAbsolutePath))];
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
  }, [sheet, fullKey]);

  const needsShared = fileCols.some((c) => !own[c.col] && styles.get(c.col) === "relative");

  // Where each column's files come from.
  const places = useMemo(() => {
    const list: Place[] = [];
    const keys: string[] = [];
    const colLocation: number[] = [];
    let ready = fileCols.length > 0;
    for (const c of fileCols) {
      const o = own[c.col];
      const st = styles.get(c.col);
      let key: string;
      let place: Place | null;
      if (o) [key, place] = [`own:${c.col}`, { location: o.location, label: o.label, files: o.files }];
      else if (st === "links") [key, place] = ["web", { location: { kind: "web" }, label: "the web links in the spreadsheet", files: [] }];
      else if (st === "full") [key, place] = ["full", fullPaths.files ? { location: { kind: "computer", root: "" }, label: "the paths in the spreadsheet", files: fullPaths.files } : null];
      else [key, place] = ["shared", shared ? { location: shared.location, label: shared.label, files: shared.files } : null];
      if (!place) {
        ready = false;
        colLocation.push(-1);
        continue;
      }
      let i = keys.indexOf(key);
      if (i < 0) {
        keys.push(key);
        list.push(place);
        i = list.length - 1;
      }
      colLocation.push(i);
    }
    return { list, colLocation, ready };
  }, [fileCols, own, shared, fullPaths.files, styles]);

  const resolved = useMemo<Resolution[][] | null>(() => {
    if (!sheet || !places.ready) return null;
    const indexes = places.list.map((p) => indexFiles(p.files, p.location.kind === "computer" || p.location.kind === "server" ? p.location.root : ""));
    return sheet.rows.map((r) => fileCols.map((c, j) => resolveFile(r[c.col] ?? "", indexes[places.colLocation[j]!]!)));
  }, [sheet, places, fileCols]);

  const stats = useMemo(() => {
    if (!resolved || !sheet) return null;
    const s = { found: 0, missing: 0, ambiguous: 0, empty: 0 };
    const perCol = fileCols.map(() => ({ found: 0, total: 0 }));
    const used = new Set<string>();
    const examples: { row: number; value: string; status: "missing" | "ambiguous" }[] = [];
    resolved.forEach((row, i) =>
      row.forEach((r, j) => {
        s[r.status]++;
        if (r.status !== "empty") perCol[j]!.total++;
        if (r.status === "found") {
          perCol[j]!.found++;
          used.add(r.file.id);
        }
        if ((r.status === "missing" || r.status === "ambiguous") && examples.length < 6)
          examples.push({ row: sheetRowNumber(i), value: sheet.rows[i]![fileCols[j]!.col] ?? "", status: r.status });
      }),
    );
    const listed = places.list.flatMap((p) => p.files);
    const unused = listed.filter((f) => !used.has(f.id)).length;
    return { ...s, perCol, unused, listed: listed.length, examples };
  }, [resolved]);

  const usedCols = fileCols.map((c) => c.col);
  const otherCols = sheet ? sheet.header.map((_, i) => i).filter((i) => !usedCols.includes(i)) : [];
  const pendingSuggestions = suggested.filter((g) => !usedCols.includes(g.col));
  const removeCol = (i: number) => {
    const col = fileCols[i]!.col;
    setFileCols(fileCols.filter((_, j) => j !== i));
    const { [col]: _gone, ...rest } = own;
    setOwn(rest);
  };

  return (
    <>
      {/* 1. The spreadsheet */}
      <Card className="p-6">
        <Label hint="Excel (.xlsx) or CSV. Use it as you received it.">Spreadsheet</Label>
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
              <span className="text-stone-500">Drag the spreadsheet here, or select it.</span>
            )}
          </div>
          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => sheetInput.current?.click()}>
            {sheet ? "Select a different spreadsheet" : "Select spreadsheet"}
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
          <Label hint="A column can have file names, paths (for example C:\Exports\abc.pdf) or web links. The files in one column go into one file field.">
            Which column has the files for "{target.fileField.label}"?
          </Label>
          <div className="mt-3 space-y-2 max-w-3xl">
            {fileCols.map((c, i) => (
              <div key={c.col} className="flex items-center gap-3 rounded-xl ring-1 ring-stone-200 p-3">
                <div className="flex-1 min-w-0">
                  <Select value={c.col} onChange={(e) => setFileCols(fileCols.map((x, j) => (j === i ? { ...x, col: Number(e.target.value) } : x)))}>
                    {sheet.header.map((h, col) => (
                      <option key={col} value={col} disabled={col !== c.col && usedCols.includes(col)}>{h}</option>
                    ))}
                  </Select>
                  <div className="text-xs text-stone-500 mt-1.5 truncate font-mono">
                    For example: {sheet.rows.slice(0, 3).map((r) => r[c.col]).filter(Boolean).join("  ·  ") || "(empty)"}
                  </div>
                </div>
                <ArrowRight className="size-4 text-stone-400 shrink-0" />
                <div className="w-64">
                  <Select value={c.fieldId} onChange={(e) => setFileCols(fileCols.map((x, j) => (j === i ? { ...x, fieldId: Number(e.target.value) } : x)))}>
                    {fileFields.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}{isImageField(f) ? " (image field)" : ""} · ID {f.id}</option>
                    ))}
                  </Select>
                </div>
                <button className="text-stone-400 hover:text-stone-700 cursor-pointer" onClick={() => removeCol(i)} aria-label="Remove">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {fileCols.length === 0 && <Callout tone="amber">No column with files was found. Add one below.</Callout>}
            {pendingSuggestions.map((g) => (
              <div key={g.col} className="flex items-center gap-3 rounded-xl bg-sky-50/60 ring-1 ring-sky-200/70 px-3 py-2.5 text-sm">
                <Sparkles className="size-4 text-sky-600 shrink-0" />
                <span className="flex-1 min-w-0 text-stone-700">
                  This spreadsheet also has a <strong>{sheet.header[g.col]}</strong> column. Attach those files to <strong>{fieldLabel(g.fieldId)}</strong> too?
                </span>
                <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setFileCols([...fileCols, g])}>Add</Button>
                <button className="text-stone-400 hover:text-stone-700 cursor-pointer" onClick={() => setSuggested(suggested.filter((x) => x.col !== g.col))} aria-label="Dismiss">
                  <X className="size-4" />
                </button>
              </div>
            ))}
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
                Add a file column
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* 3. Where the files are */}
      {sheet && fileCols.length > 0 && (
        <>
          {pickingFor !== null ? (
            <LocationPicker
              onPicked={(p) => {
                setOwn({ ...own, [pickingFor]: p });
                setPickingFor(null);
              }}
              intro={
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-stone-800">Where are the "{sheet.header[pickingFor]}" files?</div>
                    <p className="text-xs text-stone-500 mt-0.5">Select the folder that has these files. Subfolders are included.</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setPickingFor(null)}>Cancel</Button>
                </div>
              }
            />
          ) : needsShared && !shared ? (
            <LocationPicker
              onPicked={setShared}
              intro={
                <div>
                  <div className="text-sm font-medium text-stone-800">Where are the files?</div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Select the folder that has them. Subfolders are included. If some files are in another place, you can set that next.
                  </p>
                </div>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 px-5 pt-4 pb-2">
                <div className="flex-1 text-sm font-medium text-stone-800">File locations</div>
                {shared && fileCols.some((c) => !own[c.col] && styles.get(c.col) === "relative") && (
                  <Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => setShared(null)}>Change folder</Button>
                )}
              </div>
              <div className="divide-y divide-stone-100">
                {fileCols.map((c, j) => {
                  const st = styles.get(c.col);
                  const o = own[c.col];
                  const p = places.colLocation[j]! >= 0 ? places.list[places.colLocation[j]!] : null;
                  const pc = stats?.perCol[j];
                  const Icon = o ? Folder : st === "links" ? Globe : st === "full" ? Link2 : Folder;
                  const checking = st === "full" && !o && fullPaths.checking;
                  return (
                    <div key={c.col} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <Icon className="size-4 text-brand-700 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          <strong>{sheet.header[c.col]}</strong> <span className="text-stone-400">→ {fieldLabel(c.fieldId)}</span>
                        </div>
                        <div className="text-xs text-stone-500 truncate" title={p?.label}>
                          {checking ? "Checking the paths on this computer…" : p ? `From ${shortPlace(p.label)}` : "No location selected"}
                        </div>
                      </div>
                      {pc && pc.total > 0 && (
                        <Badge tone={pc.found === pc.total ? "green" : pc.found === 0 ? "red" : "amber"}>
                          {pc.found === 0 ? "No files found here" : `${pc.found.toLocaleString()} of ${pc.total.toLocaleString()} found`}
                        </Badge>
                      )}
                      {o && (
                        <Button variant="ghost" size="sm" onClick={() => {
                          const { [c.col]: _gone, ...rest } = own;
                          setOwn(rest);
                        }}>
                          Undo
                        </Button>
                      )}
                      {st !== "links" && (
                        <Button variant={pc && pc.total > 0 && pc.found === 0 ? "primary" : "secondary"} size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => setPickingFor(c.col)}>
                          Change location
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              {fileCols.some((c) => styles.get(c.col) === "links" && !own[c.col]) && (
                <p className="px-5 pb-4 pt-1 text-xs text-stone-500">Web links are downloaded during the upload. Each link must open the file directly, with no sign-in.</p>
              )}
              {fullPaths.error && <p className="px-5 pb-4 text-xs text-red-700">{fullPaths.error}</p>}
            </Card>
          )}
        </>
      )}

      {/* 4. What was found */}
      {stats && pickingFor === null && (
        <Card className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat n={stats.found} label="files found" tone="green" />
            <Stat n={stats.missing} label="files not found" tone={stats.missing ? "red" : "neutral"} />
            <Stat n={stats.ambiguous} label="have more than one file" tone={stats.ambiguous ? "amber" : "neutral"} />
            <Stat n={stats.empty} label="empty cells" tone="neutral" />
          </div>
          {stats.examples.length > 0 && (
            <div className="mt-5 rounded-xl ring-1 ring-stone-200 divide-y divide-stone-100 text-sm">
              {stats.examples.map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-xs text-stone-400 w-14 shrink-0">Row {e.row}</span>
                  <span className="flex-1 truncate font-mono text-xs">{e.value}</span>
                  <Badge tone={e.status === "missing" ? "red" : "amber"}>{e.status === "missing" ? "Not found" : "More than one file"}</Badge>
                </div>
              ))}
            </div>
          )}
          {(stats.missing > 0 || stats.ambiguous > 0) && (
            <p className="text-sm text-stone-500 mt-3">
              You can continue. The Review step lists every problem, and you can download them to fix in the spreadsheet.
              {stats.missing > 0 && " If a column shows no files found, its files are probably in another folder. Use \"Change location\" on that column."}
            </p>
          )}
          {stats.unused > 0 && stats.listed > 0 && (
            <p className="text-xs text-stone-400 mt-2">{plural(stats.unused, "file")} in the selected {places.list.length > 1 ? "locations" : "location"} {stats.unused === 1 ? "is" : "are"} not in the spreadsheet. The toolkit does not upload {stats.unused === 1 ? "it" : "them"}.</p>
          )}
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        <Button
          disabled={!sheet || !resolved || !stats || stats.found + stats.ambiguous === 0 || pickingFor !== null}
          icon={<ArrowRight className="size-4" />}
          onClick={() => {
            if (!sheet || !resolved) return;
            const first = places.list[0]!;
            onNext({
              mode: "sheet",
              location: first.location,
              locationLabel: first.label,
              files: first.files,
              locations: places.list.map((p) => ({ location: p.location, label: p.label })),
              sheet: { sheet, fileCols, resolved, colLocation: places.colLocation, pickState: { shared, own } satisfies PickState },
            });
          }}
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
