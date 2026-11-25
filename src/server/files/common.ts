/** A problem with a file or a file location, worded for the person using the toolkit. */
export class FileError extends Error {}

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
    if (total > limit) throw new FileError("This file is over the 10 MB limit.");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks)) as Uint8Array<ArrayBuffer>;
}
