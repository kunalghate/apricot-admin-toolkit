// One way to list and read files, wherever they live.

import { join } from "node:path";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dataDir } from "../config";
import type { FileLocation, FileRef } from "../../shared/types";
import { readLocal, resolveIn, scan } from "./computer";
import { readZip, scanZip } from "./zip";
import { readServer, scanServer } from "./servers";
import { isUrl, readWeb } from "./web";
import { baseName, FileError } from "./common";

export { FileError } from "./common";

// ── Files dragged onto the page ──────────────────────────────────────────────
// Browsers don't reveal where dropped files live, so they're copied into the toolkit's
// own folder. That way a long run keeps going even if the page is closed or refreshed.

export const stagingRoot = () => {
  const d = join(dataDir(), "dropped-files");
  mkdirSync(d, { recursive: true });
  return d;
};

export function stageDir(stageId: string): string {
  if (!/^[a-z0-9-]{8,64}$/i.test(stageId)) throw new FileError("The folder of dropped files is not valid.");
  return join(stagingRoot(), stageId);
}

export async function stageFile(stageId: string, relPath: string, data: Blob) {
  const clean = relPath.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join("/");
  if (!clean) throw new FileError("The file does not have a name.");
  const full = resolveIn(stageDir(stageId), clean);
  await Bun.write(full, data, { createPath: true });
}

export function removeStage(stageId: string) {
  rmSync(stageDir(stageId), { recursive: true, force: true });
}

/** Remove dropped-file copies nobody needs any more. `keep` = stages used by unfinished runs. */
export function cleanStaging(keep: Set<string>, maxAgeDays = 14) {
  for (const name of readdirSync(stagingRoot())) {
    if (keep.has(name)) continue;
    const full = join(stagingRoot(), name);
    try {
      if (Date.now() - statSync(full).mtimeMs > maxAgeDays * 86_400_000) rmSync(full, { recursive: true, force: true });
    } catch {}
  }
}

// ── Listing and reading ──────────────────────────────────────────────────────

export async function scanLocation(loc: FileLocation, onProgress?: (n: number) => void): Promise<{ files: FileRef[]; truncated: boolean }> {
  switch (loc.kind) {
    case "computer":
      return scan(loc.root, onProgress);
    case "dropped":
      return scan(stageDir(loc.stageId), onProgress);
    case "zip":
      return scanZip(loc.file);
    case "server":
      return scanServer(loc.serverId, loc.root, onProgress);
    case "web":
      return { files: [], truncated: false };
  }
}

/** Read one file. Paths that are web links are downloaded whatever the location. */
export async function readFile(loc: FileLocation, path: string): Promise<{ blob: Blob; name: string }> {
  if (isUrl(path)) return readWeb(path);
  const name = baseName(path.replace(/\\/g, "/"));
  switch (loc.kind) {
    case "computer":
      return { blob: await readLocal(resolveIn(loc.root, path)), name };
    case "dropped":
      return { blob: await readLocal(resolveIn(stageDir(loc.stageId), path)), name };
    case "zip":
      return { blob: await readZip(loc.file, path), name };
    case "server":
      return { blob: await readServer(loc.serverId, loc.root, path), name };
    case "web":
      throw new FileError("This row does not have a web link.");
  }
}
