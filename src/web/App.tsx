import { useEffect, useState } from "react";
import { History, Home, Paperclip, PlugZap, TriangleAlert } from "lucide-react";
import { api } from "./api";
import { cx, EnvBadge, Spinner } from "./components/ui";
import { ConnectionsPage, ConnectForm } from "./pages/Connections";
import { BonterraLogo } from "./components/BonterraLogo";
import { HomePage } from "./pages/Home";
import { AttachFilesPage } from "./pages/attach/AttachFiles";
import { RunPage, RunsPage } from "./pages/Runs";
import type { Connection, JobSummary } from "../shared/types";

export type Page = "home" | "attach" | "connections" | "runs";
export type Route = { page: Page } | { page: "run"; id: string };

const ACTIVE_KEY = "aat.activeConnection";

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const run = h.match(/^runs\/([\w-]+)$/);
  if (run) return { page: "run", id: run[1]! };
  return { page: h === "attach" || h === "connections" || h === "runs" ? h : "home" };
}

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

export function App() {
  const [route, setRoute] = useState<Route>(readRoute());
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(safeGet(ACTIVE_KEY));
  const [version, setVersion] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runs, setRuns] = useState<JobSummary[]>([]);

  // Keep an eye on runs for the sidebar indicator and the home page.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await api.runs().catch(() => null);
      if (r) setRuns(r);
      t = setTimeout(load, r?.some((x) => x.state === "running") ? 3000 : 10000);
    };
    load();
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = async () => {
    try {
      const list = await api.connections();
      setConnections(list);
      setLoadError(null);
      if (!list.find((c) => c.id === activeId)) choose(list[0]?.id ?? null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  useEffect(() => {
    refresh();
    api.app().then((a) => setVersion(a.version)).catch(() => {});
  }, []);

  const choose = (id: string | null) => {
    setActiveId(id);
    if (id) safeSet(ACTIVE_KEY, id);
  };

  const go = (r: string) => {
    location.hash = `/${r}`;
  };

  if (loadError) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="max-w-md text-center">
          <TriangleAlert className="size-10 text-amber-500 mx-auto mb-3" />
          <p className="text-stone-700">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!connections) return <div className="h-full grid place-items-center"><Spinner label="Starting…" /></div>;

  // First run: nothing to do until we're connected.
  if (connections.length === 0) {
    return (
      <div className="min-h-full grid place-items-center p-6 bg-gradient-to-b from-brand-50 to-stone-50">
        <div className="w-full max-w-lg animate-fade-up">
          <div className="text-center mb-8">
            <BonterraLogo className="h-9 mx-auto mb-8 text-brand-900" />
            <h1 className="text-3xl font-semibold tracking-tight text-brand-900">Apricot Admin Toolkit</h1>
            <p className="mt-2 text-stone-500">Connect to your Apricot organization to get started.</p>
          </div>
          <ConnectForm
            onConnected={async (c) => {
              choose(c.id);
              await refresh();
            }}
          />
        </div>
      </div>
    );
  }

  const active = connections.find((c) => c.id === activeId) ?? connections[0]!;
  const nav: { id: Page; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "attach", label: "Attach files", icon: Paperclip },
    { id: "runs", label: "Uploads", icon: History },
    { id: "connections", label: "Connections", icon: PlugZap },
  ];
  const running = runs.filter((r) => r.state === "running").length;
  const navActive = (id: Page) => route.page === id || (id === "runs" && route.page === "run");

  return (
    <div className="h-full flex">
      <aside className="w-64 shrink-0 border-r border-stone-200/80 bg-white/60 flex flex-col">
        <div className="px-5 pt-6 pb-5">
          <BonterraLogo className="h-6 text-brand-900" />
          <div className="mt-3 text-[13px] font-medium text-stone-600 tracking-tight">Apricot Admin Toolkit</div>
        </div>
        <nav className="px-3 space-y-0.5">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={cx(
                "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer",
                navActive(n.id)
                  ? "bg-brand-100/70 text-brand-900 font-medium shadow-[inset_3px_0_0_var(--color-lime-500)]"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
              )}
            >
              <n.icon className="size-4" /> {n.label}
              {n.id === "runs" && running > 0 && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-sky-700">
                  <span className="size-2 rounded-full bg-sky-500 animate-pulse" /> {running}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <div className="rounded-xl bg-stone-50 ring-1 ring-stone-200/80 p-3">
            <div className="text-xs text-stone-500 mb-1.5">Connected to</div>
            {connections.length > 1 ? (
              <select
                className="w-full bg-transparent text-sm font-medium text-stone-900 focus:outline-none cursor-pointer"
                value={active.id}
                onChange={(e) => choose(e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm font-medium text-stone-900 truncate">{active.name}</div>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <EnvBadge env={active.environment} />
              {active.orgId && <span className="text-xs text-stone-400">Organization {active.orgId}</span>}
            </div>
          </div>
          {version && <div className="text-[11px] text-stone-400 text-center mt-3">Version {version}</div>}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {active.environment === "production" && (
          <div className="sticky top-0 z-10 bg-red-600 text-white text-sm text-center py-1.5">
            You are working in <strong>Production</strong>. Changes affect real records.
          </div>
        )}
        <div className="max-w-5xl mx-auto px-8 py-10">
          {route.page === "home" && <HomePage go={go} connection={active} runs={runs} />}
          {route.page === "attach" && <AttachFilesPage key={active.id} connection={active} onStarted={(id) => go(`runs/${id}`)} />}
          {route.page === "runs" && <RunsPage open={(id) => go(`runs/${id}`)} />}
          {route.page === "run" && <RunPage key={route.id} id={route.id} onBack={() => go("runs")} onAttachMore={() => go("attach")} />}
          {route.page === "connections" && (
            <ConnectionsPage connections={connections} activeId={active.id} onChoose={choose} onChanged={refresh} />
          )}
        </div>
      </main>
    </div>
  );
}
