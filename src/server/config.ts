import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import pkg from "../../package.json";

export const APP_NAME = "Apricot Admin Toolkit";
export const VERSION: string = pkg.version;
export const PORT = Number(process.env.APRICOT_TOOLKIT_PORT) || 4317;

export const API_BASE = process.env.APRICOT_API_BASE || "https://api.bonterra.network";
export const TOKEN_URL = `${API_BASE}/v1/oauth/token`;
export const AUDIENCE = "https://api.bonterra.network";

/** Per-user folder for settings and run reports. Never needs admin rights. */
export function dataDir(): string {
  const override = process.env.APRICOT_TOOLKIT_DATA;
  let dir: string;
  if (override) dir = override;
  else if (process.platform === "win32") {
    dir = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "ApricotAdminToolkit");
  } else if (process.platform === "darwin") {
    dir = join(homedir(), "Library", "Application Support", "Apricot Admin Toolkit");
  } else {
    dir = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "apricot-admin-toolkit");
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}
