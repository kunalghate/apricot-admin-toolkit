import { ArrowRight, FilePlus2, Paperclip, Sparkles } from "lucide-react";
import { Badge, Card, PageHeader } from "../components/ui";
import { RunCard } from "./Runs";
import type { Connection, JobSummary } from "../../shared/types";

export function HomePage({ go, connection, runs }: { go: (r: string) => void; connection: Connection; runs: JobSummary[] }) {
  const needsYou = runs.filter((r) => r.state === "running" || r.state === "interrupted" || r.state === "paused");
  return (
    <div className="animate-fade-up">
      <PageHeader title="What would you like to do?" subtitle={`Connected to ${connection.name}`} />
      {needsYou.length > 0 && (
        <div className="mb-8 space-y-3">
          <div className="text-sm font-medium text-stone-700">{needsYou.some((r) => r.state === "running") ? "In progress" : "Waiting for you"}</div>
          {needsYou.slice(0, 3).map((r) => <RunCard key={r.id} run={r} onOpen={() => go(`runs/${r.id}`)} />)}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <button onClick={() => go("attach")} className="text-left group cursor-pointer">
          <Card className="p-6 h-full transition group-hover:ring-brand-300 group-hover:shadow-md">
            <div className="size-11 rounded-xl bg-brand-100 text-brand-700 grid place-items-center mb-4">
              <Paperclip className="size-5" />
            </div>
            <div className="font-semibold text-stone-900 flex items-center gap-2">
              Attach files to records
              <ArrowRight className="size-4 opacity-0 -translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0" />
            </div>
            <p className="text-sm text-stone-500 mt-1.5 leading-relaxed">
              Attach many files to the correct records at the same time. The files can come from a folder, a file server, or a spreadsheet.
            </p>
          </Card>
        </button>
        <Card className="p-6 h-full opacity-70">
          <div className="size-11 rounded-xl bg-stone-100 text-stone-500 grid place-items-center mb-4">
            <FilePlus2 className="size-5" />
          </div>
          <div className="font-semibold text-stone-900 flex items-center gap-2">
            Create records with files <Badge>Coming soon</Badge>
          </div>
          <p className="text-sm text-stone-500 mt-1.5 leading-relaxed">
            Make new records from a spreadsheet, and attach their files.
          </p>
        </Card>
      </div>
      <p className="mt-10 text-sm text-stone-400 flex items-center gap-2">
        <Sparkles className="size-4" /> More tools will be available at a later time.
      </p>
    </div>
  );
}
