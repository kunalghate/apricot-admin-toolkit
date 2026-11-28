import { useState } from "react";
import { PageHeader, Steps } from "../../components/ui";
import { StepForm } from "./StepForm";
import { StepFiles } from "./StepFiles";
import { StepMatch } from "./StepMatch";
import { StepReview } from "./StepReview";
import { StepStart } from "./StepStart";
import type { Row, Source } from "./model";
import type { Connection, FieldInfo, FormSummary } from "../../../shared/types";

export interface Target {
  form: FormSummary;
  fields: FieldInfo[];
  fileField: FieldInfo;
}

const STEPS = ["Form and field", "Files", "Records", "Examine", "Upload"];

export function AttachFilesPage({ connection, onStarted }: { connection: Connection; onStarted: (runId: string) => void }) {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);

  return (
    <div className="animate-fade-up">
      <PageHeader title="Attach files to records" subtitle="Attach files to many records at the same time. The toolkit verifies each file after the upload." />
      <Steps steps={STEPS} current={step} />

      {step === 0 && (
        <StepForm
          connection={connection}
          initial={target}
          onNext={(t) => {
            if (t.form.id !== target?.form.id) setSource(null);
            setTarget(t);
            setStep(1);
          }}
        />
      )}
      {step === 1 && target && (
        <StepFiles
          target={target}
          initial={source}
          onBack={() => setStep(0)}
          onNext={(s) => {
            setSource(s);
            setStep(2);
          }}
        />
      )}
      {step === 2 && target && source && (
        <StepMatch
          connection={connection}
          target={target}
          source={source}
          onBack={() => setStep(1)}
          onMatched={(r) => {
            setRows(r);
            setStep(3);
          }}
        />
      )}
      {step === 3 && target && source && (
        <StepReview
          connection={connection}
          target={target}
          source={source}
          rows={rows}
          setRows={setRows}
          replaceExisting={replaceExisting}
          setReplaceExisting={setReplaceExisting}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}
      {step === 4 && target && source && (
        <StepStart
          connection={connection}
          target={target}
          source={source}
          rows={rows}
          replaceExisting={replaceExisting}
          onBack={() => setStep(3)}
          onStarted={onStarted}
        />
      )}
    </div>
  );
}
