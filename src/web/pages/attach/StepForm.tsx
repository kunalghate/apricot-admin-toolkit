import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CornerDownRight, FileText, ImageIcon, Info, Paperclip, Search } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, Input, Spinner } from "../../components/ui";
import { isAttachmentField, isImageField, isMultiAttachmentField } from "../../../shared/fields";
import type { Connection, FieldInfo, FormSummary } from "../../../shared/types";
import type { Target } from "./AttachFiles";

export function StepForm({ connection, initial, onNext }: { connection: Connection; initial: Target | null; onNext: (t: Target) => void }) {
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormSummary | null>(initial?.form ?? null);
  const [fields, setFields] = useState<FieldInfo[] | null>(initial?.fields ?? null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [fileFieldId, setFileFieldId] = useState<number | null>(initial?.fileField.id ?? null);

  useEffect(() => {
    api.forms(connection.id).then(setForms).catch((e) => setError(e.message));
  }, [connection.id]);

  const pick = async (f: FormSummary) => {
    setForm(f);
    setFields(null);
    setFieldsError(null);
    setFileFieldId(null);
    try {
      const list = await api.fields(connection.id, f.id);
      setFields(list);
      const attach = list.filter((x) => x.active && isAttachmentField(x));
      if (attach.length === 1) setFileFieldId(attach[0]!.id);
    } catch (e) {
      setFieldsError((e as Error).message);
    }
  };

  const formNames = useMemo(() => new Map(forms?.map((f) => [f.id, f.name])), [forms]);
  // Tier 1 forms with their Tier 2 forms nested underneath. When searching, a Tier 1 form
  // stays visible if any of its Tier 2 forms match, so the hierarchy is never lost.
  const tree = useMemo(() => {
    const all = forms ?? [];
    const ids = new Set(all.map((f) => f.id));
    const q = query.trim().toLowerCase();
    const hit = (f: FormSummary) => !q || f.name.toLowerCase().includes(q) || String(f.id) === q;
    const roots = all.filter((f) => !f.parentFormId || !ids.has(f.parentFormId));
    return roots
      .map((root) => {
        const kids = root.parentFormId ? [] : all.filter((f) => f.parentFormId === root.id);
        const rootHit = hit(root);
        const shownKids = rootHit ? kids : kids.filter(hit);
        return { root, kids: shownKids, visible: rootHit || shownKids.length > 0, dim: !rootHit };
      })
      .filter((g) => g.visible);
  }, [forms, query]);

  const attachFields = (fields ?? []).filter((f) => f.active && isAttachmentField(f));
  const multiFields = (fields ?? []).filter((f) => f.active && isMultiAttachmentField(f));
  const chosen = attachFields.find((f) => f.id === fileFieldId);

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
      <Card className="p-4 flex flex-col max-h-[560px]">
        <div className="text-sm font-medium text-stone-800 px-1 mb-2">1. Choose a form</div>
        <div className="relative mb-3">
          <Search className="size-4 absolute left-3 top-3 text-stone-400" />
          <Input className="pl-9" placeholder="Search forms…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        {error && <Callout tone="red">{error}</Callout>}
        {!forms && !error && <div className="p-3"><Spinner label="Loading forms…" /></div>}
        <div className="overflow-y-auto -mx-1 px-1 space-y-0.5">
          {tree.map(({ root, kids, dim }) => (
            <div key={root.id}>
              <FormRow form={root} selected={form?.id === root.id} dim={dim} onPick={pick} orphanParent={root.parentFormId ? root.parentFormId : 0} />
              {kids.length > 0 && (
                <div className="ml-5 pl-3 border-l border-stone-200 space-y-0.5 mb-1">
                  {kids.map((k) => (
                    <FormRow key={k.id} form={k} selected={form?.id === k.id} onPick={pick} child />
                  ))}
                </div>
              )}
            </div>
          ))}
          {forms && tree.length === 0 && <div className="text-sm text-stone-500 p-3">No forms match "{query}".</div>}
        </div>
      </Card>

      <Card className="p-6">
        <div className="text-sm font-medium text-stone-800 mb-4">
          2. Choose the file or image field
          {form && (
            <span className="text-stone-500 font-normal">
              {" "}on {form.name} <span className="font-mono text-xs text-stone-400">· form ID {form.id}</span>
            </span>
          )}
        </div>
        {!form && (
          <div className="text-sm text-stone-500 py-10 text-center">
            <Paperclip className="size-8 mx-auto mb-3 text-stone-300" />
            Pick a form on the left to see its file and image fields.
          </div>
        )}
        {form && !fields && !fieldsError && <Spinner label={`Looking at "${form.name}"…`} />}
        {fieldsError && <Callout tone="red">{fieldsError}</Callout>}
        {form && fields && (
          <div className="space-y-4">
            {form.parentFormId > 0 && (
              <Callout tone="blue" icon={<Info className="size-4" />}>
                This is a Tier 2 form under <strong>{formNames.get(form.parentFormId) ?? "another form"}</strong>. Files go on
                this form's own records (not on the {formNames.get(form.parentFormId) ?? "parent"} record), so each file is matched
                to one of those records.
              </Callout>
            )}
            {attachFields.length === 0 ? (
              <Callout tone="amber" title="This form has no file or image fields">
                {multiFields.length > 0
                  ? "It only has multi-file fields, and the Apricot API doesn't support uploading to those yet."
                  : "Choose a different form, or add a file field to this one in Apricot's form designer."}
              </Callout>
            ) : (
              <div className="space-y-2">
                {attachFields.map((f) => (
                  <label
                    key={f.id}
                    className={cx(
                      "flex items-center gap-3 rounded-xl p-4 ring-1 cursor-pointer transition",
                      fileFieldId === f.id ? "ring-2 ring-brand-700 bg-brand-50" : "ring-stone-200 hover:ring-stone-300",
                    )}
                  >
                    <input type="radio" className="accent-brand-800 size-4" checked={fileFieldId === f.id} onChange={() => setFileFieldId(f.id)} />
                    {isImageField(f) ? <ImageIcon className="size-4 text-stone-400" /> : <Paperclip className="size-4 text-stone-400" />}
                    <span className="flex-1 font-medium text-sm">
                      {f.label} <span className="ml-1 font-normal font-mono text-xs text-stone-400">ID {f.id}</span>
                    </span>
                    {isImageField(f) && <Badge tone="blue">Pictures only</Badge>}
                    {f.required && <Badge tone="amber">Required</Badge>}
                    {f.hidden && <Badge>Hidden</Badge>}
                  </label>
                ))}
                {multiFields.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 rounded-xl p-4 ring-1 ring-stone-100 text-stone-400" title="The Apricot API can't upload to multi-file fields yet.">
                    <span className="size-4" />
                    <Paperclip className="size-4" />
                    <span className="flex-1 text-sm">{f.label}</span>
                    <Badge>Multi-file: not supported by the API</Badge>
                  </div>
                ))}
                <p className="text-xs text-stone-500 pt-1">
                  Each record holds one file per field. To fill a second field, run this again afterwards.
                </p>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end mt-6">
          <Button disabled={!chosen} onClick={() => chosen && form && fields && onNext({ form, fields, fileField: chosen })} icon={<ArrowRight className="size-4" />}>
            Continue
          </Button>
        </div>
      </Card>
    </div>
  );
}

function FormRow({
  form,
  selected,
  onPick,
  child,
  dim,
  orphanParent,
}: {
  form: FormSummary;
  selected: boolean;
  onPick: (f: FormSummary) => void;
  child?: boolean;
  dim?: boolean;
  orphanParent?: number;
}) {
  const Icon = child ? CornerDownRight : FileText;
  return (
    <button
      onClick={() => onPick(form)}
      className={cx(
        "w-full text-left rounded-lg px-3 py-2 text-sm flex items-center gap-2.5 cursor-pointer transition-colors",
        selected ? "bg-brand-50 text-brand-900 ring-1 ring-brand-200" : "hover:bg-stone-50",
        dim && !selected && "text-stone-500",
      )}
    >
      <Icon className={cx("size-4 shrink-0", child ? "text-stone-300" : "text-stone-400")} />
      <span className={cx("flex-1 min-w-0 truncate", !child && "font-medium")}>{form.name}</span>
      {orphanParent ? (
        <span title="A Tier 2 form whose Tier 1 form isn't available to this Apricot user (it may be inactive or restricted).">
          <Badge>Tier 2</Badge>
        </span>
      ) : null}
      <span className="font-mono text-[11px] text-stone-400 tabular-nums">{form.id}</span>
    </button>
  );
}
