// "Where are the files?": this computer (incl. network drives, synced SharePoint/OneDrive and
// zip files), an SFTP/FTP server, or files dragged onto the page.

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp, Cloud, Download, FileArchive, FileIcon, FileText, Folder, FolderOpen, HardDrive, Home, KeyRound, Monitor,
  MonitorSmartphone, Network, Plus, Server, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import { api, scanFiles, type ServerInput } from "../api";
import { Badge, Button, Callout, Card, cx, formatBytes, Input, Label, Select, Spinner } from "./ui";
import { fromDataTransfer, fromFileList, fromRef, type FileItem } from "../lib/files";
import type { BrowseResult, FileLocation, FileServer, Place } from "../../shared/types";

export interface PickedFiles {
  location: FileLocation;
  label: string;
  files: FileItem[];
  truncated: boolean;
}

type Tab = "computer" | "server" | "drop";

const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function LocationPicker({ onPicked, intro }: { onPicked: (p: PickedFiles) => void; intro?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>((safeGet("aat.locTab") as Tab) || "computer");
  const [scanning, setScanning] = useState<{ label: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (t: Tab) => {
    setTab(t);
    safeSet("aat.locTab", t);
  };

  const scan = async (location: FileLocation, label: string) => {
    setError(null);
    setScanning({ label, count: 0 });
    try {
      const r = await scanFiles(location, (count) => setScanning({ label, count }));
      if (r.files.length === 0) throw new Error("There are no files in there.");
      onPicked({ location, label, files: r.files.map(fromRef), truncated: r.truncated });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(null);
    }
  };

  if (scanning) {
    return (
      <Card className="p-10 text-center">
        <Spinner label={`Listing the files in ${scanning.label}…`} />
        <div className="mt-3 text-2xl font-semibold tabular-nums text-stone-900">{scanning.count.toLocaleString()}</div>
        <div className="text-sm text-stone-500">files found so far</div>
      </Card>
    );
  }

  const tabs = [
    { id: "computer" as const, icon: Monitor, label: "This computer", desc: "Folders, network drives, SharePoint, zip files" },
    { id: "server" as const, icon: Server, label: "File server", desc: "SFTP or FTP" },
    { id: "drop" as const, icon: Upload, label: "Drag and drop", desc: "Quickest for a few hundred files" },
  ];

  return (
    <div className="space-y-4">
      {intro}
      <div className="grid sm:grid-cols-3 gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => choose(t.id)}
            className={cx(
              "rounded-xl p-3.5 text-left ring-1 transition cursor-pointer flex gap-3 items-start",
              tab === t.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 bg-white hover:ring-stone-300",
            )}
          >
            <t.icon className="size-5 text-brand-700 shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-stone-500 mt-0.5">{t.desc}</span>
            </span>
          </button>
        ))}
      </div>
      {error && <Callout tone="red">{error}</Callout>}
      {tab === "computer" && (
        <ComputerBrowser
          onUseFolder={(dir) => scan({ kind: "computer", root: dir }, dir)}
          onUseZip={(file) => scan({ kind: "zip", file }, file)}
        />
      )}
      {tab === "server" && <ServerPanel onUseFolder={(s, dir) => scan({ kind: "server", serverId: s.id, root: dir }, `${s.name}: ${dir}`)} />}
      {tab === "drop" && <DropPanel onDropped={(files) => onPicked({ location: { kind: "dropped", stageId: crypto.randomUUID() }, label: "Files you dropped", files, truncated: false })} />}
    </div>
  );
}

// ── This computer ────────────────────────────────────────────────────────────

const placeIcon: Record<Place["kind"], typeof Home> = {
  home: Home,
  desktop: MonitorSmartphone,
  documents: FileText,
  downloads: Download,
  cloud: Cloud,
  drive: HardDrive,
  network: Network,
};

function ComputerBrowser({ onUseFolder, onUseZip }: { onUseFolder: (dir: string) => void; onUseZip: (file: string) => void }) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    api.places().then(setPlaces).catch(() => setPlaces([]));
  }, []);
  const start = safeGet("aat.lastFolder") || "";
  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-[200px_1fr] min-h-[380px]">
        <div className="border-r border-stone-100 bg-stone-50/60 p-2 space-y-0.5">
          {!places && <div className="p-3"><Spinner /></div>}
          {places?.map((p) => {
            const Icon = placeIcon[p.kind];
            return (
              <button
                key={p.path}
                onClick={() => window.dispatchEvent(new CustomEvent("aat-browse", { detail: p.path }))}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-white hover:shadow-sm cursor-pointer text-left"
                title={p.path}
              >
                <Icon className="size-4 text-stone-400 shrink-0" />
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
        <FolderBrowser
          initialDir={start || places?.[0]?.path || ""}
          ready={!!places}
          onUse={(dir) => {
            safeSet("aat.lastFolder", dir);
            onUseFolder(dir);
          }}
          onUseZip={onUseZip}
          footerHint="Network drives and synced SharePoint or OneDrive folders work like any other folder. For SharePoint, open the library in your browser and click Sync first."
        />
      </div>
    </Card>
  );
}

/** A simple folder browser, used for this computer and for file servers. */
function FolderBrowser({
  serverId,
  initialDir,
  ready = true,
  onUse,
  onUseZip,
  footerHint,
}: {
  serverId?: string;
  initialDir: string;
  ready?: boolean;
  onUse: (dir: string) => void;
  onUseZip?: (file: string) => void;
  footerHint?: string;
}) {
  const [view, setView] = useState<BrowseResult | null>(null);
  const [path, setPath] = useState(initialDir);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const open = async (dir: string) => {
    // Only the most recent request counts: a slow folder must not overwrite a newer choice.
    const req = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.browse(dir, serverId);
      if (req !== latest.current) return;
      setView(r);
      setPath(r.dir);
    } catch (e) {
      if (req !== latest.current) return;
      setError((e as Error).message);
      setView(null);
      setPath(dir);
    } finally {
      if (req === latest.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && (initialDir || serverId)) open(initialDir);
  }, [ready, serverId]);

  useEffect(() => {
    if (serverId) return;
    const h = (e: Event) => open((e as CustomEvent<string>).detail);
    window.addEventListener("aat-browse", h);
    return () => window.removeEventListener("aat-browse", h);
  }, [serverId]);

  const sep = view?.dir.includes("\\") ? "\\" : "/";
  const join = (dir: string, name: string) => (dir.endsWith(sep) ? dir + name : dir + sep + name);
  const dirs = view?.entries.filter((e) => e.type === "dir") ?? [];
  const files = view?.entries.filter((e) => e.type !== "dir") ?? [];

  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center gap-2 p-3 border-b border-stone-100">
        <Button variant="ghost" size="sm" icon={<ArrowUp className="size-4" />} disabled={!view?.parent || loading} onClick={() => view?.parent && open(view.parent)} aria-label="Up one folder" />
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            open(path);
          }}
        >
          <Input className="h-8 font-mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} placeholder={serverId ? "/folder" : "Paste a folder path, then press Enter"} spellCheck={false} />
        </form>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[300px] p-1.5">
        {loading && <div className="p-4"><Spinner label="Opening…" /></div>}
        {!loading && error && <div className="p-3"><Callout tone="red">{error}</Callout></div>}
        {!loading && !error && view && (
          <>
            {dirs.map((d) => (
              <button key={d.name} onDoubleClick={() => open(join(view.dir, d.name))} onClick={() => open(join(view.dir, d.name))} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-stone-50 cursor-pointer text-left">
                <Folder className="size-4 text-brand-600 shrink-0" />
                <span className="truncate">{d.name}</span>
              </button>
            ))}
            {files.slice(0, 200).map((f) =>
              f.type === "zip" && onUseZip ? (
                <div key={f.name} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-stone-50">
                  <FileArchive className="size-4 text-amber-600 shrink-0" />
                  <span className="truncate flex-1">{f.name}</span>
                  <Button size="sm" variant="secondary" className="h-7" onClick={() => onUseZip(join(view.dir, f.name))}>Use this zip</Button>
                </div>
              ) : (
                <div key={f.name} className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-stone-400">
                  <FileIcon className="size-4 shrink-0" />
                  <span className="truncate flex-1">{f.name}</span>
                  {f.size != null && <span className="text-xs tabular-nums">{formatBytes(f.size)}</span>}
                </div>
              ),
            )}
            {files.length > 200 && <div className="px-2.5 py-1.5 text-sm text-stone-400">…and {(files.length - 200).toLocaleString()} more files</div>}
            {view.entries.length === 0 && <div className="p-6 text-center text-sm text-stone-400">This folder is empty.</div>}
          </>
        )}
        {!loading && !error && !view && <div className="p-6 text-center text-sm text-stone-400">Choose a place on the left, or paste a folder path above.</div>}
      </div>
      <div className="p-3 border-t border-stone-100 flex items-center gap-3">
        <p className="flex-1 text-xs text-stone-500 leading-relaxed">{footerHint}</p>
        <Button icon={<FolderOpen className="size-4" />} disabled={!view || loading} onClick={() => view && onUse(view.dir)}>
          Use this folder
        </Button>
      </div>
    </div>
  );
}

// ── File servers ─────────────────────────────────────────────────────────────

function ServerPanel({ onUseFolder }: { onUseFolder: (s: FileServer, dir: string) => void }) {
  const [servers, setServers] = useState<FileServer[] | null>(null);
  const [active, setActive] = useState<FileServer | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api.servers().then((s) => {
    setServers(s);
    if (s.length === 0) setAdding(true);
  });
  useEffect(() => {
    load().catch(() => setServers([]));
  }, []);

  if (!servers) return <Spinner />;
  if (adding)
    return (
      <AddServer
        canCancel={servers.length > 0}
        onCancel={() => setAdding(false)}
        onAdded={async (s) => {
          await load();
          setAdding(false);
          setActive(s);
        }}
      />
    );

  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-[220px_1fr] min-h-[380px]">
        <div className="border-r border-stone-100 bg-stone-50/60 p-2 space-y-0.5">
          {servers.map((s) => (
            <div key={s.id} className={cx("group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer", active?.id === s.id ? "bg-white shadow-sm" : "hover:bg-white")} onClick={() => setActive(s)}>
              <Server className="size-4 text-stone-400 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-stone-800">{s.name}</span>
                <span className="block truncate text-xs text-stone-400">{s.protocol.toUpperCase()} · {s.username}@{s.host}</span>
              </span>
              <button
                className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-600 cursor-pointer"
                title="Remove this server"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm(`Remove "${s.name}"? Its saved password is deleted too.`)) return;
                  await api.removeServer(s.id);
                  if (active?.id === s.id) setActive(null);
                  load();
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => setAdding(true)} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-brand-700 hover:bg-white cursor-pointer">
            <Plus className="size-4" /> Add a server
          </button>
        </div>
        {active ? (
          <FolderBrowser key={active.id} serverId={active.id} initialDir={safeGet(`aat.serverDir.${active.id}`) || ""} onUse={(dir) => {
            safeSet(`aat.serverDir.${active.id}`, dir);
            onUseFolder(active, dir);
          }} footerHint="Files are downloaded one at a time during the upload. Nothing is stored on this computer." />
        ) : (
          <div className="grid place-items-center text-sm text-stone-400 p-10">Choose a server on the left.</div>
        )}
      </div>
    </Card>
  );
}

function AddServer({ onAdded, onCancel, canCancel }: { onAdded: (s: FileServer) => void; onCancel: () => void; canCancel: boolean }) {
  const [protocol, setProtocol] = useState("sftp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [auth, setAuth] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<{ hostKey: string | null; home: string } | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  const input = (): ServerInput => ({
    name: name.trim() || host.trim(),
    settings: { protocol, host, port: Number(port) || undefined, username, auth: protocol === "sftp" ? auth : "password" },
    credentials: auth === "key" && protocol === "sftp" ? { privateKey, passphrase: passphrase || undefined } : { password },
    hostKey: tested?.hostKey ?? null,
  });

  const test = async () => {
    setBusy(true);
    setError(null);
    setTested(null);
    try {
      setTested(await api.testServer(input()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onAdded(await api.addServer(input()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setTested(null);
  };

  return (
    <Card className="p-6 space-y-5">
      <div>
        <div className="font-medium text-stone-900">Add a file server</div>
        <p className="text-sm text-stone-500 mt-0.5">Ask whoever sent the files for these details. The password is kept in your computer's secure storage.</p>
      </div>
      <div className="grid sm:grid-cols-[140px_1fr_100px] gap-3">
        <div>
          <Label>Type</Label>
          <Select value={protocol} onChange={(e) => edit(setProtocol)(e.target.value)}>
            <option value="sftp">SFTP</option>
            <option value="ftps">FTPS (secure FTP)</option>
            <option value="ftp">FTP</option>
          </Select>
        </div>
        <div>
          <Label>Server address</Label>
          <Input value={host} onChange={(e) => edit(setHost)(e.target.value)} placeholder="sftp.example.org" spellCheck={false} />
        </div>
        <div>
          <Label>Port</Label>
          <Input value={port} onChange={(e) => edit(setPort)(e.target.value.replace(/\D/g, ""))} placeholder={protocol === "sftp" ? "22" : "21"} inputMode="numeric" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>User name</Label>
          <Input value={username} onChange={(e) => edit(setUsername)(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {protocol === "sftp" && (
          <div>
            <Label>Sign in with</Label>
            <Select value={auth} onChange={(e) => edit(setAuth)(e.target.value as "password" | "key")}>
              <option value="password">A password</option>
              <option value="key">A private key file</option>
            </Select>
          </div>
        )}
      </div>
      {auth === "key" && protocol === "sftp" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Private key</Label>
            <div className="flex gap-2 items-center">
              <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => keyInput.current?.click()}>
                {privateKey ? "Key loaded ✓" : "Choose key file"}
              </Button>
              <input ref={keyInput} type="file" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) edit(setPrivateKey)(await f.text());
                e.target.value = "";
              }} />
            </div>
          </div>
          <div>
            <Label hint="Only if the key has one">Key passphrase</Label>
            <Input type="password" value={passphrase} onChange={(e) => edit(setPassphrase)(e.target.value)} autoComplete="off" />
          </div>
        </div>
      ) : (
        <div className="max-w-sm">
          <Label>Password</Label>
          <Input type="password" value={password} onChange={(e) => edit(setPassword)(e.target.value)} autoComplete="off" />
        </div>
      )}
      {protocol === "ftp" && <Callout tone="amber">Plain FTP sends the password and files unencrypted. Use SFTP or FTPS if the server supports it.</Callout>}
      {error && <Callout tone="red">{error}</Callout>}
      {tested && (
        <Callout tone="green" icon={<ShieldCheck className="size-4" />} title="Connected">
          {tested.hostKey ? (
            <>
              The server's identity is <span className="font-mono text-xs break-all">{tested.hostKey}</span>. The toolkit remembers it and
              warns you if it ever changes.
            </>
          ) : (
            "The details work."
          )}
        </Callout>
      )}
      {tested && (
        <div className="max-w-sm">
          <Label hint="So you can recognise it later">Name for this server</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={host} />
        </div>
      )}
      <div className="flex gap-2">
        {tested ? (
          <Button loading={busy} onClick={save} icon={<ShieldCheck className="size-4" />}>Save server</Button>
        ) : (
          <Button loading={busy} disabled={!host.trim() || !username.trim()} onClick={test}>Connect</Button>
        )}
        {canCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </Card>
  );
}

// ── Drag and drop ────────────────────────────────────────────────────────────

function DropPanel({ onDropped }: { onDropped: (files: FileItem[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const done = (files: FileItem[]) => files.length && onDropped(files);
  return (
    <Card className="p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          setReading(true);
          try {
            done(await fromDataTransfer(e.dataTransfer));
          } finally {
            setReading(false);
          }
        }}
        className={cx("rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors", dragging ? "border-brand-400 bg-brand-50" : "border-stone-200 bg-stone-50/50")}
      >
        <div className="size-14 mx-auto rounded-2xl bg-white ring-1 ring-stone-200 grid place-items-center mb-4 shadow-sm">
          <Upload className={cx("size-6", dragging ? "text-brand-500" : "text-stone-400")} />
        </div>
        <div className="text-lg font-medium text-stone-900">{reading ? "Reading files…" : "Drag a folder or files here"}</div>
        <p className="text-sm text-stone-500 mt-1 mb-5">Nothing is uploaded yet.</p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" icon={<FolderOpen className="size-4" />} onClick={() => folderInput.current?.click()}>Choose a folder</Button>
          <Button variant="secondary" icon={<FileIcon className="size-4" />} onClick={() => fileInput.current?.click()}>Choose files</Button>
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { done(fromFileList(e.target.files)); e.target.value = ""; }} />
        <input ref={folderInput} type="file" hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { done(fromFileList(e.target.files)); e.target.value = ""; }} />
      </div>
      <p className="text-xs text-stone-500 mt-3 flex items-center gap-1.5">
        <Badge>Tip</Badge> For thousands of files, choose them from <strong>This computer</strong> instead. It's faster, and nothing needs copying.
      </p>
    </Card>
  );
}
