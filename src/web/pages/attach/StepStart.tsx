import { useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, MonitorCheck, Upload } from "lucide-react";
import { api } from "../../api";
import { Button, Callout, Card, plural, Progress } from "../../components/ui";
import { isImageField } from "../../../shared/fields";
import type { Connection, JobItem } from "../../../shared/types";
import type { Target } from "./AttachFiles";
import { useRowStates } from "./StepReview";
import { existingFile, willUpload, type Row, type Source } from "./model";

const TRIAL = 3;

export function StepStart({
  connection,
  target,
  source,
  rows,
  replaceExisting,
  onBack,
  onStarted,
}: {
  connection: Connection;
  target: Target;
  source: Source;
  rows: Row[];
  replaceExisting: boolean;
  onBack: () => void;
  onStarted: (runId: string) => void;
}) {
  const { states } = useRowStates(target, rows, replaceExisting);
  const planned = useMemo(() => rows.filter((_, i) => willUpload(states[i]!)), [rows, states]);
  const replacing = planned.filter((r) => existingFile(r)).length;
  const fieldIds = [...new Set(planned.map((r) => r.fieldId))];
  const fields = target.fields.filter((f) => fieldIds.includes(f.id));
  const isProd = connection.environment === "production";
  const locations = source.locations ?? [{ location: source.location, label: source.locationLabel }];
  const [confirmed, setConfirmed] = useState(!isProd);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (trial: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // Dragged-in files are copied into the toolkit's own folder first, so the run
      // doesn't depend on this page staying open.
      const toStage = [
        ...new Map(
          planned.flatMap((r) => {
            const l = locations[r.loc ?? 0]!.location;
            return l.kind === "dropped" && r.file?.file ? [[`${l.stageId}|${r.file.path}`, { stageId: l.stageId, f: r.file }] as const] : [];
          }),
        ).values(),
      ];
      if (toStage.length) {
        setPreparing({ done: 0, total: toStage.length });
        let next = 0;
        let done = 0;
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            while (next < toStage.length) {
              const { stageId, f } = toStage[next++]!;
              await api.stage(stageId, f.file!, f.path);
              setPreparing({ done: ++done, total: toStage.length });
            }
          }),
        );
      }
      const items: JobItem[] = planned.map((r, n) => ({
        n,
        path: r.file!.path,
        name: r.file!.name,
        size: r.file!.size,
        recordId: r.record!.id,
        recordLabel: r.record!.label,
        fieldId: r.fieldId,
        sheetRow: r.sheetRow,
        loc: r.loc ?? 0,
      }));
      const run = await api.createRun({
        connectionId: connection.id,
        formId: target.form.id,
        formName: target.form.name,
        location: locations[0]!.location,
        locationLabel: [...new Set(locations.map((l) => l.label))].join(" + "),
        locations: locations.map((l) => l.location),
        fields: fields.map((f) => ({ id: f.id, label: f.label, imageOnly: isImageField(f) })),
        replaceExisting,
        items,
      });
      await api.startRun(run.id, trial ? TRIAL : undefined);
      onStarted(run.id);
    } catch (e) {
      setError((e as Error).message);
      setPreparing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start gap-5">
          <div className="size-12 rounded-2xl grid place-items-center shrink-0 bg-brand-50 text-brand-700">
            <Upload className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-stone-900">Attach {plural(planned.length, "file")} to records on {target.form.name}</div>
            <div className="text-sm text-stone-500 mt-1">
              Into the fields {new Intl.ListFormat("en", { type: "conjunction" }).format(fields.map((f) => `"${f.label}"`))} · from {[...new Set(locations.map((l) => l.label))].join(" and ")} · {connection.name}
              {replacing > 0 && ` · the toolkit replaces ${plural(replacing, "file")} on records`}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <Callout tone="neutral" icon={<MonitorCheck className="size-4" />} title="The upload continues when you close this page">
            The toolkit does the upload, not this page. You can close this page or do other work. Do not close the toolkit window. You can
            minimize it. During the upload, your computer does not go to sleep. If the upload stops, it continues from the last file. The
            toolkit verifies each file on the record after the upload.
          </Callout>
          {isProd && (
            <label className="flex items-start gap-3 rounded-xl bg-red-50 ring-1 ring-red-200 p-4 cursor-pointer">
              <input type="checkbox" className="accent-red-600 mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span className="text-sm text-red-900">
                I understand that this changes <strong>{plural(new Set(planned.map((r) => r.record!.id)).size, "record")} in Production</strong>
                {replacing > 0 && <> and replaces {plural(replacing, "file")} on records. I cannot undo this</>}.
              </span>
            </label>
          )}
          {preparing && (
            <div className="space-y-2">
              <div className="text-sm text-stone-600">Preparation of the files in progress: {preparing.done.toLocaleString()} of {preparing.total.toLocaleString()}</div>
              <Progress value={(preparing.done / Math.max(1, preparing.total)) * 100} />
            </div>
          )}
          {error && <Callout tone="red">{error}</Callout>}
          <div className="flex flex-wrap gap-3">
            {planned.length > TRIAL && (
              <Button variant="secondary" size="lg" icon={<FlaskConical className="size-4" />} disabled={!confirmed || busy} onClick={() => start(true)}>
                Upload {TRIAL} files as a test
              </Button>
            )}
            <Button size="lg" icon={<Upload className="size-4" />} disabled={!confirmed} loading={busy} onClick={() => start(false)}>
              {planned.length === 1 ? "Upload 1 file" : `Upload all ${planned.length.toLocaleString()} files`}
            </Button>
          </div>
        </div>
      </Card>
      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>Back</Button>
      </div>
    </div>
  );
}
