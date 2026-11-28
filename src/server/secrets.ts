// Secrets (Apricot client secrets, SFTP/FTP passwords and keys) go into the OS credential store:
// Windows Credential Manager or the macOS Keychain, via Bun.secrets. If that's unavailable,
// they fall back to a file in the user's own data folder, readable only by them.

import { join } from "node:path";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataDir } from "./config";

const SERVICE = "Apricot Admin Toolkit";
const fallbackPath = () => join(dataDir(), "secrets.json");

function readFallback(): Record<string, string> {
  try {
    return existsSync(fallbackPath()) ? JSON.parse(readFileSync(fallbackPath(), "utf8")) : {};
  } catch {
    return {};
  }
}

function writeFallback(data: Record<string, string>) {
  writeFileSync(fallbackPath(), JSON.stringify(data, null, 2));
  try {
    chmodSync(fallbackPath(), 0o600);
  } catch {}
}

export async function setSecret(name: string, value: string) {
  try {
    await Bun.secrets.set({ service: SERVICE, name, value });
    return;
  } catch {
    console.warn("  (The credential store of this computer is not available. The toolkit keeps the secret in your user folder.)");
  }
  writeFallback({ ...readFallback(), [name]: value });
}

export async function getSecret(name: string): Promise<string | null> {
  try {
    const v = await Bun.secrets.get({ service: SERVICE, name });
    if (v) return v;
  } catch {}
  return readFallback()[name] ?? null;
}

export async function deleteSecret(name: string) {
  try {
    await Bun.secrets.delete({ service: SERVICE, name });
  } catch {}
  const data = readFallback();
  if (name in data) {
    delete data[name];
    writeFallback(data);
  }
}
