import { useState } from "react";
import { CheckCircle2, KeyRound, Lock, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Card, Callout, cx, EnvBadge, Input, Label, PageHeader } from "../components/ui";
import type { Connection, Environment } from "../../shared/types";

export function ConnectForm({ onConnected, onCancel }: { onConnected: (c: Connection) => void; onCancel?: () => void }) {
  const [environment, setEnvironment] = useState<Environment>("sandbox");
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await api.addConnection({ name, environment, clientId, clientSecret });
      onConnected(c);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <Label>Environment</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["sandbox", "production"] as const).map((env) => (
              <button
                type="button"
                key={env}
                onClick={() => setEnvironment(env)}
                className={cx(
                  "rounded-xl px-4 py-3 text-left ring-1 transition cursor-pointer",
                  environment === env ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300",
                )}
              >
                <div className="font-medium text-sm">{env === "sandbox" ? "Sandbox" : "Production"}</div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {env === "sandbox" ? "A test copy. Safe to experiment." : "Your live data. Changes affect real records."}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="cname" hint="Optional, so you can tell connections apart">Name</Label>
          <Input id="cname" placeholder={environment === "sandbox" ? "For example: Sandbox" : "For example: Main office"} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cid">Client ID</Label>
          <Input id="cid" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="csecret">Client Secret</Label>
          <Input id="csecret" type="password" autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required />
        </div>

        {error && <Callout tone="red" title="Could not connect">{error}</Callout>}

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" loading={busy} icon={<KeyRound className="size-4" />} className="flex-1">
            {busy ? "Connecting…" : "Connect"}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
        <p className="flex items-start gap-2 text-xs text-stone-500">
          <Lock className="size-3.5 mt-0.5 shrink-0" />
          Your secret is kept in your computer's secure credential store ({navigator.userAgent.includes("Windows") ? "Windows Credential Manager" : "Keychain"}).
          The toolkit sends the secret only to Apricot, to sign in.
        </p>
        <p className="text-xs text-stone-500">
          If you do not have a Client ID, ask your Apricot administrator for API credentials.
        </p>
      </form>
    </Card>
  );
}

export function ConnectionsPage({
  connections,
  activeId,
  onChoose,
  onChanged,
}: {
  connections: Connection[];
  activeId: string;
  onChoose: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, { ok: boolean; message: string }>>({});

  const check = async (c: Connection) => {
    setChecking(c.id);
    try {
      const r = await api.check(c.id);
      setStatus((s) => ({ ...s, [c.id]: { ok: true, message: `The connection is correct${r.orgId ? ` · Organization ${r.orgId}` : ""}` } }));
    } catch (e) {
      setStatus((s) => ({ ...s, [c.id]: { ok: false, message: (e as Error).message } }));
    } finally {
      setChecking(null);
    }
  };

  const remove = async (c: Connection) => {
    if (!confirm(`Remove the connection "${c.name}"? You can add it again at a later time.`)) return;
    await api.removeConnection(c.id);
    await onChanged();
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Connections"
        subtitle="The Apricot organizations you work with."
        actions={!adding && <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add connection</Button>}
      />

      {adding && (
        <div className="mb-8 max-w-lg">
          <ConnectForm
            onCancel={() => setAdding(false)}
            onConnected={async (c) => {
              setAdding(false);
              onChoose(c.id);
              await onChanged();
            }}
          />
        </div>
      )}

      <div className="space-y-3">
        {connections.map((c) => (
          <Card key={c.id} className={cx("p-5 flex items-center gap-4", c.id === activeId && "ring-2 ring-brand-300")}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-stone-900">{c.name}</span>
                <EnvBadge env={c.environment} />
                {c.id === activeId && <Badge tone="apricot">In use</Badge>}
              </div>
              <div className="text-sm text-stone-500 mt-1">
                {c.orgId ? `Organization ${c.orgId}` : "Organization not known"}
                {c.userLabel && ` · User: ${c.userLabel}`} · Client ID: …{c.clientIdHint}
              </div>
              {status[c.id] && (
                <div className={cx("text-sm mt-2 flex items-center gap-1.5", status[c.id]!.ok ? "text-lime-800" : "text-red-700")}>
                  {status[c.id]!.ok && <CheckCircle2 className="size-4" />} {status[c.id]!.message}
                </div>
              )}
            </div>
            {c.id !== activeId && (
              <Button variant="secondary" size="sm" onClick={() => onChoose(c.id)}>Use this connection</Button>
            )}
            <Button variant="secondary" size="sm" loading={checking === c.id} onClick={() => check(c)}>Test</Button>
            <Button variant="ghost" size="sm" onClick={() => remove(c)} aria-label="Remove connection">
              <Trash2 className="size-4" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
