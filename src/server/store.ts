// Saved Apricot connections.
// Names and settings live in a JSON file in the user's data folder.
// The client secret goes into the OS credential store (Windows Credential Manager /
// macOS Keychain) via Bun.secrets, and never into the JSON file.

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dataDir } from "./config";
import type { Connection, Environment } from "../shared/types";

const SECRET_SERVICE = "Apricot Admin Toolkit";

interface StoredConnection extends Connection {
  clientId: string;
}

interface StoreFile {
  connections: StoredConnection[];
  /** Only used when the OS credential store is unavailable. */
  fallbackSecrets?: Record<string, string>;
}

const storePath = () => join(dataDir(), "connections.json");

function load(): StoreFile {
  const p = storePath();
  if (!existsSync(p)) return { connections: [] };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as StoreFile;
  } catch {
    return { connections: [] };
  }
}

function save(data: StoreFile) {
  const p = storePath();
  writeFileSync(p, JSON.stringify(data, null, 2));
  try {
    chmodSync(p, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file is in the user's own profile folder.
  }
}

function publicView(c: StoredConnection): Connection {
  const { clientId: _omit, ...rest } = c;
  return rest;
}

export function listConnections(): Connection[] {
  return load().connections.map(publicView);
}

export function getConnection(id: string): StoredConnection | undefined {
  return load().connections.find((c) => c.id === id);
}

async function setSecret(id: string, secret: string) {
  try {
    await Bun.secrets.set({ service: SECRET_SERVICE, name: id, value: secret });
    return;
  } catch (err) {
    console.warn("  (OS credential store unavailable; storing secret in your user folder instead)");
  }
  const data = load();
  data.fallbackSecrets = { ...data.fallbackSecrets, [id]: secret };
  save(data);
}

export async function getSecret(id: string): Promise<string | null> {
  try {
    const v = await Bun.secrets.get({ service: SECRET_SERVICE, name: id });
    if (v) return v;
  } catch {
    // fall through to file fallback
  }
  return load().fallbackSecrets?.[id] ?? null;
}

export async function addConnection(input: {
  name: string;
  environment: Environment;
  clientId: string;
  clientSecret: string;
  orgId: string | null;
  userLabel: string | null;
}): Promise<Connection> {
  const id = crypto.randomUUID();
  const conn: StoredConnection = {
    id,
    name: input.name,
    environment: input.environment,
    orgId: input.orgId,
    userLabel: input.userLabel,
    clientId: input.clientId,
    clientIdHint: input.clientId.slice(-4),
    createdAt: new Date().toISOString(),
  };
  await setSecret(id, input.clientSecret);
  const data = load();
  data.connections.push(conn);
  save(data);
  return publicView(conn);
}

export async function removeConnection(id: string) {
  try {
    await Bun.secrets.delete({ service: SECRET_SERVICE, name: id });
  } catch {
    // ignore
  }
  const data = load();
  data.connections = data.connections.filter((c) => c.id !== id);
  if (data.fallbackSecrets) delete data.fallbackSecrets[id];
  save(data);
}
