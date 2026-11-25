import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, Info, Paperclip, Search } from "lucide-react";
import { api } from "../../api";
import { Badge, Button, Callout, Card, cx, Input, Spinner } from "../../components/ui";
import { isAttachmentField, isMultiAttachmentField } from "../../../shared/fields";
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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (forms ?? []).filter((f) => !q || f.name.toLowerCase().includes(q) || String(f.id) === q);
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
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => pick(f)}
              className={cx(
                "w-full text-left rounded-lg px-3 py-2.5 text-sm flex items-center gap-2.5 cursor-pointer transition-colors",
                form?.id === f.id ? "bg-apricot-50 text-apricot-900 ring-1 ring-apricot-200" : "hover:bg-stone-50",
              )}
            >
              <FileText className="size-4 shrink-0 text-stone-400" />
              <span className="flex-1 min-w-0 truncate">{f.name}</span>
              {f.parentFormId ? <Badge>Tier 2</Badge> : null}
            </button>
          ))}
          {forms && filtered.length === 0 && <div className="text-sm text-stone-500 p-3">No forms match "{query}".</div>}
        </div>
      </Card>

      <Card className="p-6">
        <div className="text-sm font-medium text-stone-800 mb-4">2. Choose the file field{form && <span className="text-stone-500 font-normal"> on {form.name}</span>}</div>
        {!form && (
          <div className="text-sm text-stone-500 py-10 text-center">
            <Paperclip className="size-8 mx-auto mb-3 text-stone-300" />
            Pick a form on the left to see its file fields.
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
              <Callout tone="amber" title="This form has no file fields">
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
                      fileFieldId === f.id ? "ring-2 ring-apricot-400 bg-apricot-50/60" : "ring-stone-200 hover:ring-stone-300",
                    )}
                  >
                    <input type="radio" className="accent-apricot-500 size-4" checked={fileFieldId === f.id} onChange={() => setFileFieldId(f.id)} />
                    <Paperclip className="size-4 text-stone-400" />
                    <span className="flex-1 font-medium text-sm">{f.label}</span>
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
