/**
 * What kind of file problem it is. Code decides what to do (pause the upload, reconnect, or
 * record a failure for this file) from the code, never from the message text.
 *  - unreachable: a location does not reply (file server, network drive). Pause and do again later.
 *  - missing_secret: a saved file server or its password is missing. Pause.
 *  - auth / host_key_changed / not_found / too_large: about this file or these settings. Do not reconnect.
 */
export type FileErrorCode = "unreachable" | "missing_secret" | "auth" | "host_key_changed" | "certificate" | "not_found" | "too_large" | "other";

/** A problem with a file or a file location, worded for the person who uses the toolkit (ASD-STE100). */
export class FileError extends Error {
  constructor(
    message: string,
    public code: FileErrorCode = "other",
  ) {
    super(message);
  }
}

/** Files that operating systems and Office create on their own; never upload these. */
export function isJunkName(name: string): boolean {
  const n = name.toLowerCase();
  return n === ".ds_store" || n === "thumbs.db" || n === "desktop.ini" || n.startsWith("~$") || n.startsWith("._");
}

/** Upper limit for one listing. Well beyond a sensible single run. */
export const MAX_SCAN_FILES = 100_000;

/** Last part of a "/"-separated path. */
export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Read a stream fully, refusing to go past a size limit. */
export async function collect(stream: NodeJS.ReadableStream, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > limit) throw new FileError("This file is larger than the 10 MB limit.", "too_large");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks)) as Uint8Array<ArrayBuffer>;
}
