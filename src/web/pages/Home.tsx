import { ArrowRight, FilePlus2, Paperclip, Sparkles } from "lucide-react";
import { Badge, Card, PageHeader } from "../components/ui";
import type { Route } from "../App";
import type { Connection } from "../../shared/types";

export function HomePage({ go, connection }: { go: (r: Route) => void; connection: Connection }) {
  return (
    <div className="animate-fade-up">
      <PageHeader title="What would you like to do?" subtitle={`Working in ${connection.name}.`} />
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
              Drop in a folder of documents and attach each one to the right record, all at once.
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
            Import new records from a spreadsheet, with their documents attached.
          </p>
        </Card>
      </div>
      <p className="mt-10 text-sm text-stone-400 flex items-center gap-2">
        <Sparkles className="size-4" /> More admin tools are on the way.
      </p>
    </div>
  );
}
