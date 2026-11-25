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

export type KeyRule = "first_number" | "before_separator" | "whole_name" | "folder";

export const KEY_RULES: { id: KeyRule; label: string; example: string }[] = [
  { id: "first_number", label: "The first number in the file name", example: "consent_5531.pdf → 5531" },
  { id: "before_separator", label: "Everything before the first _ or space", example: "CL-0042_consent.pdf → CL-0042" },
  { id: "whole_name", label: "The whole file name", example: "CL-0042.pdf → CL-0042" },
  { id: "folder", label: "The name of the folder it's in", example: "CL-0042/consent.pdf → CL-0042" },
];

export function stripExtension(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function extractKey(item: FileItem, rule: KeyRule): string | null {
  const base = stripExtension(item.file.name).trim();
  switch (rule) {
    case "first_number":
      return base.match(/\d+/)?.[0] ?? null;
    case "before_separator":
      return base.split(/[_\s]+/)[0]?.trim() || null;
    case "whole_name":
      return base || null;
    case "folder": {
      const parts = item.path.split("/");
      return parts.length > 1 ? parts[parts.length - 2]!.trim() || null : null;
    }
  }
}

/** Pick a sensible default rule by looking at the files. */
export function suggestRule(items: FileItem[], byRecordId: boolean): KeyRule {
  if (byRecordId) return "first_number";
  const sample = items.slice(0, 50);
  const inFolders = sample.filter((i) => i.path.includes("/")).length;
  const folders = new Set(sample.map((i) => i.path.split("/").slice(-2, -1)[0]));
  if (inFolders === sample.length && folders.size > 1) return "folder";
  const withSep = sample.filter((i) => /[_\s]/.test(stripExtension(i.file.name))).length;
  return withSep > sample.length / 2 ? "before_separator" : "whole_name";
}
