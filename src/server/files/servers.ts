// SFTP and FTP/FTPS servers: saved settings, connections, browsing, listing and reading.

import { join, posix } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import { Client as SSHClient, type SFTPWrapper, type ConnectConfig } from "ssh2";
import { Client as FTPClient } from "basic-ftp";
import { dataDir } from "../config";
import { deleteSecret, getSecret, setSecret } from "../secrets";
import type { BrowseEntry, BrowseResult, FileRef, FileServer, ServerProtocol } from "../../shared/types";
import { FileError, isJunkName, MAX_SCAN_FILES } from "./common";
import { MAX_UPLOAD_BYTES } from "../../shared/fields";

export interface ServerCredentials {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ServerSettings {
  protocol: ServerProtocol;
  host: string;
  port: number;
  username: string;
  auth: "password" | "key";
}

// ── Saved servers ────────────────────────────────────────────────────────────

const storePath = () => join(dataDir(), "file-servers.json");
const secretName = (id: string) => `server:${id}`;

function load(): FileServer[] {
  try {
    return existsSync(storePath()) ? (JSON.parse(readFileSync(storePath(), "utf8")) as FileServer[]) : [];
  } catch {
    return [];
  }
}
const save = (list: FileServer[]) => writeFileSync(storePath(), JSON.stringify(list, null, 2));

export const listServers = () => load();
export const getServer = (id: string) => load().find((s) => s.id === id);

export async function addServer(name: string, settings: ServerSettings, creds: ServerCredentials, hostKey: string | null): Promise<FileServer> {
  const server: FileServer = { id: crypto.randomUUID(), name, ...settings, hostKey, createdAt: new Date().toISOString() };
  await setSecret(secretName(server.id), JSON.stringify(creds));
  save([...load(), server]);
  return server;
}

export async function removeServer(id: string) {
  closeConnection(id);
  await deleteSecret(secretName(id));
  save(load().filter((s) => s.id !== id));
}

async function credentialsFor(id: string): Promise<ServerCredentials> {
  const raw = await getSecret(secretName(id));
  if (!raw) throw new FileError("The toolkit cannot find the saved password for this file server. Remove the file server, then add it again.", "missing_secret");
  return JSON.parse(raw) as ServerCredentials;
}

export function normalizeSettings(input: Partial<ServerSettings>): ServerSettings {
  const protocol: ServerProtocol = input.protocol === "ftp" || input.protocol === "ftps" ? input.protocol : "sftp";
  // People often paste "sftp://host" or "host:2222".
  let host = String(input.host ?? "").trim().replace(/^(s?ftps?):\/\//i, "").replace(/\/.*$/, "");
  let port = Number(input.port) || 0;
  const m = host.match(/^(.+):(\d+)$/);
  if (m) {
    host = m[1]!;
    port = port || Number(m[2]);
  }
  if (!host) throw new FileError("Enter the address of the file server.");
  const username = String(input.username ?? "").trim();
  if (!username) throw new FileError("Enter the user name for the file server.");
  return { protocol, host, port: port || (protocol === "sftp" ? 22 : 21), username, auth: input.auth === "key" ? "key" : "password" };
}

// ── Connections ──────────────────────────────────────────────────────────────

interface Remote {
  list(dir: string): Promise<BrowseEntry[]>;
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
  home(): Promise<string>;
  close(): void;
}

const fingerprint = (key: Buffer) => `SHA256:${new Bun.CryptoHasher("sha256").update(key).digest("base64").replace(/=+$/, "")}`;

function friendlyNetError(err: unknown, s: ServerSettings): FileError {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof FileError) return err;
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return new FileError(`The toolkit cannot find a file server with the name "${s.host}". Make sure that the address is correct.`, "unreachable");
  if (/ECONNREFUSED/i.test(msg)) return new FileError(`"${s.host}" did not accept a connection on port ${s.port}. Make sure that the port is correct and that it is an ${s.protocol.toUpperCase()} file server.`, "unreachable");
  if (/ETIMEDOUT|timed? ?out/i.test(msg))
    return new FileError(`"${s.host}" did not reply. It is possible that your network or firewall blocks it. Or, the address or the port is not correct.`, "unreachable");
  if (/authentication|auth fail|530|login incorrect|permission denied/i.test(msg)) return new FileError("The file server did not accept the user name and the password (or the key).", "auth");
  if (/certificate|self.signed|CERT_/i.test(msg)) return new FileError("The toolkit does not trust the security certificate of the file server. The toolkit did not connect.", "certificate");
  if (/no such file|ENOENT|550/i.test(msg)) return new FileError("This folder or file does not exist on the file server.", "not_found");
  return new FileError(`The connection to the file server failed (${msg}).`, "unreachable");
}

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out`)), ms))),
  ]);
}

/** SFTP: one SSH connection, many reads in parallel over it. */
async function connectSftp(s: ServerSettings, creds: ServerCredentials, expectedKey: string | null, onKey?: (fp: string) => void): Promise<Remote> {
  const client = new SSHClient();
  let mismatch = false;
  const cfg: ConnectConfig = {
    host: s.host,
    port: s.port,
    username: s.username,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 4,
    hostVerifier: (key: Buffer) => {
      const fp = fingerprint(key);
      onKey?.(fp);
      if (expectedKey && fp !== expectedKey) {
        mismatch = true;
        return false;
      }
      return true;
    },
  };
  if (s.auth === "key") {
    cfg.privateKey = creds.privateKey;
    if (creds.passphrase) cfg.passphrase = creds.passphrase;
  } else cfg.password = creds.password;

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client
      .on("ready", () => client.sftp((err, w) => (err ? reject(err) : resolve(w))))
      .on("error", (err) =>
        reject(
          mismatch
            ? new FileError(
                "The identity of this file server changed after you saved it. This can show that a person intercepts the connection. Speak to the owner of the file server. Then remove the file server and add it again.",
                "host_key_changed",
              )
            : err,
        ),
      );
    try {
      client.connect(cfg);
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    client.end();
    throw friendlyNetError(err, s);
  });

  let dead = false;
  client.on("close", () => (dead = true));
  const call = <T>(fn: (cb: (err: Error | null | undefined, v: T) => void) => void, what: string) =>
    timeout(
      new Promise<T>((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v)))),
      90_000,
      what,
    ).catch((err) => {
      throw friendlyNetError(err, s);
    });

  return {
    get closed() {
      return dead;
    },
    async list(dir) {
      const items = await call<any[]>((cb) => sftp.readdir(dir, cb), "Listing the folder");
      return items
        .filter((i) => !i.filename.startsWith(".") && !isJunkName(i.filename))
        .map((i): BrowseEntry => {
          const isDir = (i.attrs.mode & 0o170000) === 0o040000;
          return { name: i.filename, type: isDir ? "dir" : /\.zip$/i.test(i.filename) ? "zip" : "file", size: isDir ? null : i.attrs.size };
        });
    },
    async read(path) {
      const st = await call<any>((cb) => sftp.stat(path, cb), "Checking the file");
      if (st.size > MAX_UPLOAD_BYTES) throw new FileError("This file is larger than the 10 MB limit.", "too_large");
      const buf = await call<Buffer>((cb) => sftp.readFile(path, cb as never), "Downloading the file");
      return new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
    },
    async home() {
      return call<string>((cb) => sftp.realpath(".", cb), "Finding the home folder");
    },
    close() {
      dead = true;
      client.end();
    },
  } as Remote & { closed: boolean };
}

/** FTP/FTPS: a connection handles one thing at a time, so keep a small pool. */
async function connectFtp(s: ServerSettings, creds: ServerCredentials): Promise<Remote> {
  const pool: FTPClient[] = [];
  const idle: FTPClient[] = [];
  const waiters: ((c: FTPClient) => void)[] = [];
  const MAX = 3;
  let closed = false;

  const make = async () => {
    const c = new FTPClient(60_000);
    try {
      await c.access({ host: s.host, port: s.port, user: s.username, password: creds.password, secure: s.protocol === "ftps" });
    } catch (err) {
      c.close();
      throw friendlyNetError(err, s);
    }
    pool.push(c);
    return c;
  };
  const acquire = async (): Promise<FTPClient> => {
    const c = idle.pop();
    if (c && !c.closed) return c;
    if (c) pool.splice(pool.indexOf(c), 1);
    if (pool.length < MAX) return make();
    return new Promise((res) => waiters.push(res));
  };
  const release = (c: FTPClient) => {
    if (c.closed) pool.splice(pool.indexOf(c), 1);
    const w = waiters.shift();
    if (w) {
      if (c.closed) make().then(w, () => {});
      else w(c);
    } else if (!c.closed) idle.push(c);
  };
  const use = async <T>(fn: (c: FTPClient) => Promise<T>): Promise<T> => {
    const c = await acquire();
    try {
      return await fn(c);
    } catch (err) {
      throw friendlyNetError(err, s);
    } finally {
      release(c);
    }
  };

  // Connect once up front so bad credentials fail straight away.
  release(await make());

  return {
    get closed() {
      return closed;
    },
    list: (dir) =>
      use(async (c) =>
        (await c.list(dir))
          .filter((i) => !i.name.startsWith(".") && !isJunkName(i.name) && i.name !== "..")
          .map((i): BrowseEntry => ({
            name: i.name,
            type: i.isDirectory ? "dir" : /\.zip$/i.test(i.name) ? "zip" : "file",
            size: i.isDirectory ? null : i.size,
          })),
      ),
    read: (path) =>
      use(async (c) => {
        const size = await c.size(path).catch(() => 0);
        if (size > MAX_UPLOAD_BYTES) throw new FileError("This file is larger than the 10 MB limit.", "too_large");
        const chunks: Buffer[] = [];
        let total = 0;
        await c.downloadTo(
          new Writable({
            write(chunk: Buffer, _enc, cb) {
              total += chunk.length;
              if (total > MAX_UPLOAD_BYTES + 1) return cb(new FileError("This file is larger than the 10 MB limit.", "too_large"));
              chunks.push(chunk);
              cb();
            },
          }),
          path,
        );
        return new Uint8Array(Buffer.concat(chunks)) as Uint8Array<ArrayBuffer>;
      }),
    home: () => use((c) => c.pwd()),
    close() {
      closed = true;
      for (const c of pool) c.close();
    },
  } as Remote & { closed: boolean };
}

/** Try settings before saving them. Returns the SFTP host key fingerprint to remember. */
export async function testServer(settings: ServerSettings, creds: ServerCredentials): Promise<{ hostKey: string | null; home: string }> {
  let hostKey: string | null = null;
  const r =
    settings.protocol === "sftp"
      ? await connectSftp(settings, creds, null, (fp) => (hostKey = fp))
      : await connectFtp(settings, creds);
  try {
    const home = await r.home();
    await r.list(home);
    return { hostKey, home };
  } finally {
    r.close();
  }
}

const live = new Map<string, { remote: Promise<Remote & { closed?: boolean }>; lastUsed: number }>();

async function connection(serverId: string): Promise<Remote> {
  const hit = live.get(serverId);
  if (hit) {
    const r = await hit.remote.catch(() => null);
    if (r && !r.closed) {
      hit.lastUsed = Date.now();
      return r;
    }
    live.delete(serverId);
  }
  const server = getServer(serverId);
  if (!server) throw new FileError("This file server is not saved now. Add the file server again.", "missing_secret");
  const remote = (async () => {
    const creds = await credentialsFor(serverId);
    return server.protocol === "sftp" ? connectSftp(server, creds, server.hostKey) : connectFtp(server, creds);
  })();
  live.set(serverId, { remote: remote as never, lastUsed: Date.now() });
  try {
    return await remote;
  } catch (err) {
    live.delete(serverId);
    throw err;
  }
}

function closeConnection(serverId: string) {
  const hit = live.get(serverId);
  live.delete(serverId);
  hit?.remote.then((r) => r.close()).catch(() => {});
}

/** Run one remote operation, reconnecting once if the connection dropped. */
async function withRemote<T>(serverId: string, fn: (r: Remote) => Promise<T>): Promise<T> {
  try {
    return await fn(await connection(serverId));
  } catch (err) {
    // Problems that a new connection cannot fix.
    if (err instanceof FileError && ["not_found", "too_large", "host_key_changed", "auth"].includes(err.code)) throw err;
    closeConnection(serverId);
    await Bun.sleep(1500);
    return fn(await connection(serverId));
  }
}

export async function browseServer(serverId: string, dir: string): Promise<BrowseResult> {
  return withRemote(serverId, async (r) => {
    const d = dir.trim() ? posix.normalize(dir.trim()) : await r.home();
    const entries = await r.list(d);
    entries.sort((a, b) => ((a.type === "dir") === (b.type === "dir") ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1));
    const parent = posix.dirname(d);
    return { dir: d, parent: parent === d ? null : parent, entries };
  });
}

export async function scanServer(serverId: string, root: string, onProgress?: (n: number) => void): Promise<{ files: FileRef[]; truncated: boolean }> {
  const base = posix.normalize(root || "/");
  const files: FileRef[] = [];
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > 25) return;
    const entries = await withRemote(serverId, (r) => r.list(dir));
    for (const e of entries) {
      if (e.type === "dir") continue;
      if (files.length >= MAX_SCAN_FILES) {
        truncated = true;
        return;
      }
      const full = posix.join(dir, e.name);
      files.push({ path: posix.relative(base, full), name: e.name, size: e.size });
    }
    onProgress?.(files.length);
    for (const e of entries) if (e.type === "dir") await walk(posix.join(dir, e.name), depth + 1);
  };
  await walk(base, 0);
  return { files, truncated };
}

export async function readServer(serverId: string, root: string, path: string): Promise<Blob> {
  const base = posix.normalize(root || "/");
  const full = posix.normalize(posix.join(base, path));
  if (!full.startsWith(base === "/" ? "/" : `${base}/`)) throw new FileError("This file is not in the selected folder.");
  const data = await withRemote(serverId, (r) => r.read(full));
  return new Blob([data]);
}

/** Drop connections nobody has used for a few minutes. */
setInterval(() => {
  for (const [id, c] of live) if (Date.now() - c.lastUsed > 5 * 60_000) closeConnection(id);
}, 60_000).unref?.();
