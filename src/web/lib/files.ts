// Collecting dropped files/folders and pulling identifiers out of file names.

export interface FileItem {
  id: string;
  file: File;
  /** Path relative to what the user dropped, e.g. "Jane Doe 5531/consent.pdf". */
  path: string;
}

const IGNORED = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const isJunk = (name: string) => IGNORED.has(name.toLowerCase()) || name.startsWith("~$") || name.startsWith("._");

let counter = 0;
const makeItem = (file: File, path: string): FileItem => ({ id: `f${++counter}`, file, path });

/** From an <input type="file"> (files or a folder). */
export function fromFileList(list: FileList | null): FileItem[] {
  if (!list) return [];
  return [...list]
    .filter((f) => !isJunk(f.name))
    .map((f) => makeItem(f, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name));
}

/** From a drag-and-drop, walking into folders. */
export async function fromDataTransfer(dt: DataTransfer): Promise<FileItem[]> {
  const entries = [...dt.items]
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return fromFileList(dt.files);

  const out: FileItem[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      if (!isJunk(file.name)) out.push(makeItem(file, prefix + file.name));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

/** Where one identifier value comes from in a file's name. */
export type PartSource = { type: "part"; index: number } | { type: "number" } | { type: "whole" } | { type: "folder" };

export function stripExtension(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Split a file name into parts at underscores, spaces and commas. Dashes are kept (dates, IDs like CL-0042). */
export function nameParts(item: FileItem): string[] {
  return stripExtension(item.file.name).split(/[_\s,]+/).map((p) => p.trim()).filter(Boolean);
}

export function folderName(item: FileItem): string | null {
  const parts = item.path.split("/");
  return parts.length > 1 ? parts[parts.length - 2]!.trim() || null : null;
}

export function extractValue(item: FileItem, src: PartSource): string | null {
  switch (src.type) {
    case "part":
      return nameParts(item)[src.index] ?? null;
    case "number":
      return stripExtension(item.file.name).match(/\d+/)?.[0] ?? null;
    case "whole":
      return stripExtension(item.file.name).trim() || null;
    case "folder":
      return folderName(item);
  }
}

export const sourceId = (s: PartSource) => (s.type === "part" ? `part:${s.index}` : s.type);
export const parseSourceId = (id: string): PartSource =>
  id.startsWith("part:") ? { type: "part", index: Number(id.slice(5)) } : ({ type: id } as PartSource);

const looksDate = (s: string) => /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[-.]\d{1,2}[-.]\d{4}$|^\d{8}$/.test(s);

/**
 * Sensible defaults: dates go to date-looking parts, the record ID to the first number,
 * and other identifiers to the remaining parts in order.
 */
export function guessSources(items: FileItem[], targets: { kind: "text" | "date" | "record_id" }[]): PartSource[] {
  const sample = items[0];
  if (!sample) return targets.map(() => ({ type: "whole" }));
  const parts = nameParts(sample);
  const inFolders = items.slice(0, 50).every((i) => i.path.includes("/"));
  if (targets.length === 1) {
    const t = targets[0]!;
    if (t.kind === "record_id") return [{ type: "number" }];
    if (parts.length <= 1) return [inFolders && parts.length === 0 ? { type: "folder" } : { type: "whole" }];
    return [{ type: "part", index: 0 }];
  }
  const used = new Set<number>();
  return targets.map((t) => {
    const idx = parts.findIndex((p, i) => !used.has(i) && (t.kind === "date" ? looksDate(p) : !looksDate(p)));
    if (idx >= 0) {
      used.add(idx);
      return { type: "part", index: idx };
    }
    return { type: "whole" };
  });
}
