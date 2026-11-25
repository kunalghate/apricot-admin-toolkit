import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileIcon, FolderOpen, Trash2, Upload, X } from "lucide-react";
import { Badge, Button, Callout, Card, cx, formatBytes } from "../../components/ui";
import { fromDataTransfer, fromFileList, type FileItem } from "../../lib/files";
import { fileExtension, fileTypeRisk, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../../../shared/fields";
import type { Target } from "./AttachFiles";


export function StepFiles({
  files,
  setFiles,
  target,
  onBack,
  onNext,
}: {
  files: FileItem[];
  setFiles: (f: FileItem[]) => void;
  target: Target;
  onBack: () => void;
  onNext: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const add = (more: FileItem[]) => {
    // Skip exact repeats (same path and size) if the user drops the same thing twice.
    const seen = new Set(files.map((f) => `${f.path}|${f.file.size}`));
    setFiles([...files, ...more.filter((f) => !seen.has(`${f.path}|${f.file.size}`))]);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    setReading(true);
    try {
      add(await fromDataTransfer(e.dataTransfer));
    } finally {
      setReading(false);
    }
  };

  const total = files.reduce((n, f) => n + f.file.size, 0);
  const blocked = files.filter((f) => fileTypeRisk(f.file.name) === "blocked");
  const unusual = files.filter((f) => fileTypeRisk(f.file.name) === "unusual");
  const large = files.filter((f) => f.file.size > MAX_UPLOAD_BYTES);
  const types = [...new Set(files.map((f) => fileExtension(f.file.name) || "no extension"))];

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx(
            "rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
            dragging ? "border-brand-400 bg-brand-50" : "border-stone-200 bg-stone-50/50",
          )}
        >
          <div className="size-14 mx-auto rounded-2xl bg-white ring-1 ring-stone-200 grid place-items-center mb-4 shadow-sm">
            <Upload className={cx("size-6", dragging ? "text-brand-500" : "text-stone-400")} />
          </div>
          <div className="text-lg font-medium text-stone-900">{reading ? "Reading files…" : "Drag a folder or files here"}</div>
          <p className="text-sm text-stone-500 mt-1 mb-5">
            They'll go into <strong>{target.fileField.label}</strong> on <strong>{target.form.name}</strong>. Nothing is uploaded yet.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" icon={<FolderOpen className="size-4" />} onClick={() => folderInput.current?.click()}>
              Choose a folder
            </Button>
            <Button variant="secondary" icon={<FileIcon className="size-4" />} onClick={() => fileInput.current?.click()}>
              Choose files
            </Button>
          </div>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { add(fromFileList(e.target.files)); e.target.value = ""; }} />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => { add(fromFileList(e.target.files)); e.target.value = ""; }}
          />
        </div>
      </Card>

      {files.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
            <div className="text-sm">
              <span className="font-medium">{files.length.toLocaleString()} files</span>
              <span className="text-stone-500"> · {formatBytes(total)} · {types.slice(0, 6).join(", ")}{types.length > 6 ? "…" : ""}</span>
            </div>
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setFiles([])}>
              Clear all
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
            {files.slice(0, 500).map((f) => {
              const risk = fileTypeRisk(f.file.name);
              return (
                <div key={f.id} className="flex items-center gap-3 px-5 py-2 text-sm group">
                  <FileIcon className="size-4 text-stone-400 shrink-0" />
                  <span className="flex-1 min-w-0 truncate" title={f.path}>{f.path}</span>
                  {risk === "blocked" && <Badge tone="red">Unsafe type</Badge>}
                  {risk === "unusual" && <Badge tone="amber">Unusual type</Badge>}
                  {f.file.size > MAX_UPLOAD_BYTES && <Badge tone="red">Over {MAX_UPLOAD_LABEL}</Badge>}
                  <span className="text-stone-400 tabular-nums w-16 text-right">{formatBytes(f.file.size)}</span>
                  <button className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-stone-700 cursor-pointer" onClick={() => setFiles(files.filter((x) => x.id !== f.id))} aria-label="Remove">
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
            {files.length > 500 && <div className="px-5 py-2 text-sm text-stone-500">…and {files.length - 500} more</div>}
          </div>
        </Card>
      )}

      {(blocked.length > 0 || unusual.length > 0 || large.length > 0) && (
        <div className="space-y-2">
          {blocked.length > 0 && (
            <Callout tone="red" title={`${blocked.length} program file${blocked.length > 1 ? "s" : ""} will be skipped`}>
              Files like .exe can't be attached to Apricot records.
            </Callout>
          )}
          {unusual.length > 0 && (
            <Callout tone="amber" title={`${unusual.length} file${unusual.length > 1 ? "s have" : " has"} a less common type`}>
              Each Apricot organization decides which file types it accepts. These will be tried. If Apricot rejects a type,
              the toolkit will tell you and skip the rest of that type.
            </Callout>
          )}
          {large.length > 0 && (
            <Callout tone="red" title={`${large.length} file${large.length > 1 ? "s are" : " is"} over ${MAX_UPLOAD_LABEL} and will be skipped`}>
              The Apricot API only accepts files up to {MAX_UPLOAD_LABEL}. Compress or split these, or attach them in Apricot directly.
            </Callout>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Back</Button>
        <Button disabled={files.length === 0} icon={<ArrowRight className="size-4" />} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
