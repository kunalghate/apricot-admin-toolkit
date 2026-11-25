import { useState } from "react";
import { PageHeader, Steps } from "../../components/ui";
import { StepForm } from "./StepForm";
import { StepFiles } from "./StepFiles";
import { StepMatch } from "./StepMatch";
import { StepReview } from "./StepReview";
import { StepUpload } from "./StepUpload";
import type { FileItem } from "../../lib/files";
import type { Row } from "./model";
import type { Connection, FieldInfo, FormSummary } from "../../../shared/types";

export interface Target {
  form: FormSummary;
  fields: FieldInfo[];
  fileField: FieldInfo;
}

const STEPS = ["Form & field", "Files", "Match", "Review", "Upload"];

export function AttachFilesPage({ connection }: { connection: Connection }) {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const reset = () => {
    setStep(0);
    setTarget(null);
    setFiles([]);
    setRows([]);
    setReplaceExisting(false);
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title="Attach files to records" subtitle="Add documents to many existing records at once. Every upload is checked afterwards." />
      <Steps steps={STEPS} current={step} />

      {step === 0 && (
        <StepForm
          connection={connection}
          initial={target}
          onNext={(t) => {
            setTarget(t);
            setStep(1);
          }}
        />
      )}
      {step === 1 && target && (
        <StepFiles files={files} setFiles={setFiles} target={target} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      )}
      {step === 2 && target && (
        <StepMatch
          connection={connection}
          target={target}
          files={files}
          onBack={() => setStep(1)}
          onMatched={(r) => {
            setRows(r);
            setStep(3);
          }}
        />
      )}
      {step === 3 && target && (
        <StepReview
          connection={connection}
          target={target}
          rows={rows}
          setRows={setRows}
          replaceExisting={replaceExisting}
          setReplaceExisting={setReplaceExisting}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}
      {step === 4 && target && (
        <StepUpload
          connection={connection}
          target={target}
          rows={rows}
          setRows={setRows}
          replaceExisting={replaceExisting}
          onBack={() => setStep(3)}
          onStartOver={reset}
        />
      )}
    </div>
  );
}
