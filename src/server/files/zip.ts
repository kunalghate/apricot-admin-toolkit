// Reading files straight out of a .zip, without unpacking thousands of files first.

import yauzl from "yauzl";
import type { FileRef } from "../../shared/types";
import { baseName, collect, FileError, isJunkName, MAX_SCAN_FILES } from "./common";
import { MAX_UPLOAD_BYTES } from "../../shared/fields";

interface OpenZip {
  zip: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
  lastUsed: number;
}

const open = new Map<string, Promise<OpenZip>>();

function openZip(file: string): Promise<OpenZip> {
  let p = open.get(file);
  if (!p) {
    p = new Promise<OpenZip>((resolve, reject) => {
      yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zip) => {
        if (err || !zip) {
          open.delete(file);
          return reject(
            /ENOENT/.test(String(err))
              ? new FileError("This zip file is not in its location now.", "not_found")
              : new FileError("The toolkit cannot open this zip file. It is possible that the file is damaged or is not a zip file."),
          );
        }
        const entries = new Map<string, yauzl.Entry>();
        zip.on("entry", (e: yauzl.Entry) => {
          // Skip folders, Mac metadata and Office lock files.
          if (!e.fileName.endsWith("/") && !e.fileName.startsWith("__MACOSX/") && !isJunkName(baseName(e.fileName))) {
            entries.set(e.fileName, e);
          }
          zip.readEntry();
        });
        zip.on("end", () => resolve({ zip, entries, lastUsed: Date.now() }));
        zip.on("error", (e) => {
          open.delete(file);
          reject(new FileError(`The toolkit cannot read this zip file (${e.message}).`));
        });
        zip.readEntry();
      });
    });
    open.set(file, p);
  }
  return p;
}

export async function scanZip(file: string): Promise<{ files: FileRef[]; truncated: boolean }> {
  const z = await openZip(file);
  const files: FileRef[] = [];
  for (const [path, e] of z.entries) {
    if (files.length >= MAX_SCAN_FILES) return { files, truncated: true };
    files.push({ path, name: baseName(path), size: e.uncompressedSize });
  }
  return { files, truncated: false };
}

export async function readZip(file: string, path: string): Promise<Blob> {
  const z = await openZip(file);
  z.lastUsed = Date.now();
  const e = z.entries.get(path);
  if (!e) throw new FileError("This file is not in the zip file.", "not_found");
  if (e.uncompressedSize > MAX_UPLOAD_BYTES) throw new FileError("This file is larger than the 10 MB limit.", "too_large");
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
    z.zip.openReadStream(e, (err, s) => (err || !s ? reject(new FileError("The toolkit cannot read this file in the zip file. It is possible that the zip file is damaged or has a password.")) : resolve(s))),
  );
  return new Blob([await collect(stream, MAX_UPLOAD_BYTES + 1)]);
}

/** Close zips nobody has used for a while, so the file isn't held open. */
setInterval(async () => {
  for (const [file, p] of open) {
    const z = await p.catch(() => null);
    if (z && Date.now() - z.lastUsed > 10 * 60_000) {
      z.zip.close();
      open.delete(file);
    }
  }
}, 60_000).unref?.();
