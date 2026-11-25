// Files listed as web links (https://…) in a mapping spreadsheet.

import { FileError } from "./common";
import { MAX_UPLOAD_BYTES } from "../../shared/fields";

export const isUrl = (p: string) => /^https?:\/\//i.test(p.trim());

/** A sensible file name for a link: from the server's Content-Disposition, else the end of the URL. */
function nameFor(url: URL, res: Response): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  const plain = cd.match(/filename="?([^";]+)"?/i)?.[1];
  const fromHeader = star ? decodeURIComponent(star.trim()) : plain?.trim();
  if (fromHeader) return fromHeader;
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return last || "download";
}

export async function readWeb(link: string): Promise<{ blob: Blob; name: string }> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new FileError("This isn't a valid web link.");
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (res.status === 404) throw new FileError("The link says the file doesn't exist (404).");
      if (res.status === 401 || res.status === 403)
        throw new FileError("The link needs a sign-in or has expired, so the file couldn't be downloaded.");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_UPLOAD_BYTES) throw new FileError("This file is over the 10 MB limit.");
      const type = res.headers.get("content-type") ?? "";
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_UPLOAD_BYTES) throw new FileError("This file is over the 10 MB limit.");
      // A sign-in page instead of the file (common with SharePoint/Drive links).
      if (/text\/html/i.test(type) && !/\.html?$/i.test(url.pathname))
        throw new FileError("The link opened a web page instead of a file. It may need a sign-in, or it isn't a direct download link.");
      return { blob: new Blob([buf], { type }), name: nameFor(url, res) };
    } catch (err) {
      if (err instanceof FileError) throw err;
      lastErr = err;
      await Bun.sleep(1000 * 2 ** attempt);
    }
  }
  throw new FileError(`The file couldn't be downloaded from the link (${lastErr instanceof Error ? lastErr.message : String(lastErr)}).`);
}
