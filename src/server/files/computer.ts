// Files on this computer: local folders, mapped network drives (S:\, \\server\share),
// and SharePoint/OneDrive libraries synced to the computer (they appear as normal folders).

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { BrowseEntry, BrowseResult, FileRef, Place } from "../../shared/types";
import { FileError, isJunkName, MAX_SCAN_FILES } from "./common";

const isWin = process.platform === "win32";

/** System folders that only confuse people. Some are skipped anywhere, some only at the top of a drive or home folder. */
const SKIP_ALWAYS = new Set(["$recycle.bin", "system volume information", "node_modules"]);
const SKIP_AT_TOP = new Set(["appdata", "library", "windows", "program files", "program files (x86)", "programdata", "applications", "system", "private", "bin", "sbin", "usr", "etc", "var", "opt", "cores", "dev", "volumes"]);
const isTop = (dir: string) => dirname(dir) === dir || resolve(dir) === resolve(homedir());
const skipDir = (parent: string, name: string) => {
  const n = name.toLowerCase();
  return SKIP_ALWAYS.has(n) || (isTop(parent) && SKIP_AT_TOP.has(n));
};

/** Paths from spreadsheets or pasted by people: strip quotes ("Copy as path" adds them) and whitespace. */
export function cleanPath(p: string): string {
  return p.trim().replace(/^["']+|["']+$/g, "").trim();
}

/** Run with a time limit, so a disconnected network drive doesn't freeze the page. */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<T>((res) => (t = setTimeout(() => res(fallback), ms)));
  try {
    return await Promise.race([p, timer]);
  } finally {
    clearTimeout(t);
  }
}

const isDir = (p: string) =>
  withTimeout(
    stat(p).then((s) => s.isDirectory()).catch(() => false),
    1500,
    false,
  );

/** Shortcuts shown on the left of the folder picker. */
export async function places(): Promise<Place[]> {
  const home = homedir();
  const out: Place[] = [];
  const add = async (label: string, path: string | undefined, kind: Place["kind"]) => {
    if (path && !out.some((p) => p.path === path) && (await isDir(path))) out.push({ label, path, kind });
  };

  if (isWin) {
    const od = process.env.OneDriveCommercial || process.env.OneDrive;
    // Desktop/Documents are often redirected into OneDrive on work laptops.
    await add("Desktop", od && existsSync(join(od, "Desktop")) ? join(od, "Desktop") : join(home, "Desktop"), "desktop");
    await add("Documents", od && existsSync(join(od, "Documents")) ? join(od, "Documents") : join(home, "Documents"), "documents");
    await add("Downloads", join(home, "Downloads"), "downloads");
    await add("Your folder", home, "home");
    if (process.env.OneDriveCommercial) await add(basename(process.env.OneDriveCommercial), process.env.OneDriveCommercial, "cloud");
    if (process.env.OneDriveConsumer) await add("OneDrive (personal)", process.env.OneDriveConsumer, "cloud");
    // Synced SharePoint libraries live in a folder named after the organization, e.g. "C:\Users\me\Contoso".
    const org = process.env.OneDriveCommercial?.match(/OneDrive - (.+)$/)?.[1];
    if (org) await add(`SharePoint (${org})`, join(home, org), "cloud");
    // Drive letters, including mapped network drives. Checked in parallel with a time limit.
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const found = await Promise.all(letters.map(async (l) => ((await isDir(`${l}:\\`)) ? l : null)));
    for (const l of found) if (l) out.push({ label: `${l}: drive`, path: `${l}:\\`, kind: l === "C" ? "drive" : "network" });
  } else {
    await add("Desktop", join(home, "Desktop"), "desktop");
    await add("Documents", join(home, "Documents"), "documents");
    await add("Downloads", join(home, "Downloads"), "downloads");
    await add("Your folder", home, "home");
    // OneDrive and SharePoint on a Mac sync into ~/Library/CloudStorage.
    const cloud = join(home, "Library", "CloudStorage");
    for (const name of await readdir(cloud).catch(() => [] as string[])) {
      const label = name.replace(/^OneDrive-SharedLibraries-/, "SharePoint (").replace(/^OneDrive-/, "OneDrive (").replace(/^GoogleDrive-/, "Google Drive (");
      await add(label.includes("(") ? `${label})` : label, join(cloud, name), "cloud");
    }
    // Network shares and USB drives on a Mac.
    for (const name of await readdir("/Volumes").catch(() => [] as string[])) {
      if (name === "Macintosh HD") continue;
      await add(name, join("/Volumes", name), "network");
    }
  }
  return out;
}

export async function browse(dir: string): Promise<BrowseResult> {
  const d = cleanPath(dir);
  if (!d || !isAbsolute(d)) throw new FileError("Enter the full path of the folder, for example C:\\Users\\you\\Documents or /Users/you/Documents.");
  const abs = resolve(d);
  const dirents = await withTimeout(
    readdir(abs, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") throw new FileError("This folder does not exist on this computer.", "not_found");
      if (e.code === "ENOTDIR") throw new FileError("This is a file, not a folder.");
      if (e.code === "EACCES" || e.code === "EPERM") throw new FileError("You do not have permission to open this folder.", "auth");
      throw new FileError(`The toolkit cannot open this folder (${e.code ?? e.message}).`);
    }),
    20_000,
    null,
  );
  if (!dirents) throw new FileError("This folder did not open in the usual time. If it is on a network drive, make sure that you are connected to the network.", "unreachable");

  const entries: BrowseEntry[] = [];
  const files: { name: string; full: string }[] = [];
  for (const e of dirents) {
    if (e.name.startsWith(".") || isJunkName(e.name)) continue;
    if (e.isDirectory()) {
      if (!skipDir(abs, e.name)) entries.push({ name: e.name, type: "dir", size: null });
    } else if (e.isFile()) files.push({ name: e.name, full: join(abs, e.name) });
  }
  // Sizes for the first few hundred files only; enough for the picker.
  const sized = await Promise.all(
    files.slice(0, 300).map(async (f) => ({ ...f, size: await stat(f.full).then((s) => s.size).catch(() => null) })),
  );
  for (const f of [...sized, ...files.slice(300).map((f) => ({ ...f, size: null }))])
    entries.push({ name: f.name, type: /\.zip$/i.test(f.name) ? "zip" : "file", size: f.size });

  entries.sort((a, b) => (a.type === "dir") === (b.type === "dir") ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1);
  const parent = dirname(abs);
  return { dir: abs, parent: parent === abs ? null : parent, entries };
}

/** Every file under a folder (recursively), with paths relative to it. */
export async function scan(root: string, onProgress?: (n: number) => void): Promise<{ files: FileRef[]; truncated: boolean }> {
  const base = resolve(cleanPath(root));
  if (!(await isDir(base))) throw new FileError("This folder does not exist on this computer, or the toolkit cannot open it.", "not_found");
  const files: FileRef[] = [];
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > 25) return;
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const subdirs: string[] = [];
    const here: string[] = [];
    for (const e of dirents) {
      if (e.name.startsWith(".") || isJunkName(e.name)) continue;
      if (e.isDirectory()) {
        if (!skipDir(dir, e.name)) subdirs.push(join(dir, e.name));
      } else if (e.isFile()) here.push(join(dir, e.name));
    }
    // stat in small batches: fast locally, gentle on network drives.
    for (let i = 0; i < here.length; i += 64) {
      const batch = await Promise.all(
        here.slice(i, i + 64).map(async (full) => ({ full, size: await stat(full).then((s) => s.size).catch(() => null) })),
      );
      for (const f of batch) {
        if (files.length >= MAX_SCAN_FILES) {
          truncated = true;
          return;
        }
        files.push({ path: relative(base, f.full).split(sep).join("/"), name: basename(f.full), size: f.size });
      }
      onProgress?.(files.length);
    }
    for (const s of subdirs) await walk(s, depth + 1);
  };
  await walk(base, 0);
  return { files, truncated };
}

/** Sizes for absolute paths (spreadsheets that list full paths). null = not found. */
export async function statPaths(paths: string[]): Promise<(number | null)[]> {
  const out: (number | null)[] = new Array(paths.length).fill(null);
  for (let i = 0; i < paths.length; i += 64) {
    await Promise.all(
      paths.slice(i, i + 64).map(async (p, j) => {
        const c = cleanPath(p);
        if (!c || !isAbsolute(c)) return;
        out[i + j] = await withTimeout(
          stat(c).then((s) => (s.isFile() ? s.size : null)).catch(() => null),
          5000,
          null,
        );
      }),
    );
  }
  return out;
}

/** Resolve a file path inside a root folder, refusing anything that escapes it. root "" = absolute paths. */
export function resolveIn(root: string, path: string): string {
  if (!root) {
    const c = cleanPath(path);
    if (!isAbsolute(c)) throw new FileError("The path of this file is not a full path.");
    return resolve(c);
  }
  const base = resolve(cleanPath(root));
  const full = resolve(base, path);
  const rel = relative(base, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new FileError("This file is not in the selected folder.");
  return full;
}

export async function readLocal(full: string): Promise<Blob> {
  const f = Bun.file(full);
  if (!(await f.exists())) throw new FileError("The file is not in its location now. It is possible that a person moved, renamed, or deleted it.", "not_found");
  return f;
}
