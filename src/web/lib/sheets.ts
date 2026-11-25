// Reading and writing spreadsheets (Excel and CSV), all inside the browser.
import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import Papa from "papaparse";

export type Cell = string | number | boolean | Date | null;

/** Read the first sheet of an .xlsx or .csv file as rows of text. */
export async function readTable(file: File): Promise<string[][]> {
  const toText = (v: unknown) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).trim();
  };
  let rows: unknown[][];
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const text = await file.text();
    rows = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  } else {
    rows = (await readSheet(file)) as unknown[][];
  }
  return rows.map((r) => r.map(toText)).filter((r) => r.some((c) => c !== ""));
}

const header = (value: string) => ({ value, fontWeight: "bold" as const, backgroundColor: "#FDECD9" });

/** Build and download an .xlsx with a bold header row. */
export async function downloadSheet(filename: string, headers: string[], rows: Cell[][], widths?: number[]) {
  const data = [headers.map(header), ...rows.map((r) => r.map((value) => ({ value })))];
  await writeXlsxFile(data as never, {
    columns: headers.map((_, i) => ({ width: widths?.[i] ?? 28 })),
  }).toFile(filename);
}
