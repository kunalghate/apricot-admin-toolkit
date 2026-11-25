// Makes dummy files and customer-style mapping spreadsheets for testing the attach tool.
//
// Against the local mock API (no real records touched):
//   bun scripts/make-test-data.ts --mock --count 5000 --out "/path/to/folder"
//
// Against a real test form (creates test records on it first, using .env.local credentials):
//   bun scripts/make-test-data.ts --form 1234 --count 300 --out "/path/to/folder"
//   The form needs: a Name field, a "Date of Birth" date field, a "Client Number" text field,
//   and file fields called "Consent Form", "Intake Form" and "Photo" (an Image field).
//   Records created through the API can't be deleted through it, so use a dedicated test form.

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import writeXlsxFile from "write-excel-file/node";
import { mockPeople } from "../tests/mock-apricot";
import { ApricotClient } from "../src/server/apricot";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const count = Number(arg("count") ?? 200);
const out = arg("out");
const formId = Number(arg("form") ?? 0);
const mock = args.includes("--mock");
if (!out || (!mock && !formId)) {
  console.log('Usage: bun scripts/make-test-data.ts (--mock | --form <id>) --count <n> --out "<folder>"');
  process.exit(1);
}

interface Person {
  id: number;
  first: string;
  last: string;
  dob: string; // YYYY-MM-DD
  client: string;
}

// ── People: from the mock, or created as real records on a test form ──
let people: Person[];
let fieldIds = { consent: 20, intake: 21, photo: 22 };
if (mock) {
  people = mockPeople(count);
} else {
  const env = Object.fromEntries(
    [...readFileSync(join(import.meta.dir, "..", ".env.local"), "utf8").matchAll(/^(\w+)="?([^"\n]*)"?/gm)].map((m) => [m[1], m[2]]),
  );
  const c = new ApricotClient("test-data", env.CLIENT_ID!, env.CLIENT_SECRET!);
  const fields = await c.fields(formId);
  const find = (re: RegExp, type?: number) => fields.find((f) => re.test(f.label) && (type == null || f.typeId === type));
  const name = fields.find((f) => f.typeId === 5);
  const dob = find(/birth/i, 17);
  const client = find(/client\s*(number|no|#|id)/i);
  const consent = find(/consent/i, 29);
  const intake = find(/intake/i, 29);
  const photo = find(/photo|picture|image/i, 72);
  const missing = [!name && "a Name field", !dob && "a Date of Birth date field", !client && "a Client Number field", !consent && "a Consent Form file field", !intake && "an Intake Form file field", !photo && "a Photo image field"].filter(Boolean);
  if (missing.length) {
    console.log(`Form ${formId} is missing: ${missing.join(", ")}.`);
    process.exit(1);
  }
  fieldIds = { consent: consent!.id, intake: intake!.id, photo: photo!.id };
  const base = mockPeople(count);
  people = [];
  console.log(`Creating ${count} test records on form ${formId}…`);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < base.length) {
        const p = base[next++]!;
        const res = await c.request("POST", "/records", {
          json: {
            type: "records",
            attributes: {
              form_id: formId,
              [`field_${name!.id}_first`]: p.first,
              [`field_${name!.id}_last`]: p.last,
              [`field_${dob!.id}`]: p.dob,
              [`field_${client!.id}`]: p.client,
            },
          },
        });
        const id = Number(res?.data?.[0]?.id ?? res?.data?.id);
        if (!id) throw new Error(`Record create returned no ID: ${JSON.stringify(res).slice(0, 200)}`);
        people.push({ ...p, id });
        if (people.length % 50 === 0) console.log(`  ${people.length} created`);
      }
    }),
  );
  people.sort((a, b) => a.id - b.id);
}

// ── Files ──
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
const docs = join(out, "Customer export");
mkdirSync(docs, { recursive: true });

const pdf = (text: string, pad: number) => {
  const body = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%${"x".repeat(pad)}\n%%EOF\n`;
};
// A valid 1x1 JPEG.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const write = (rel: string, data: string | Buffer) => {
  const full = join(docs, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, data);
  return full;
};

const usDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
type Cell = string | number | null;
const sheetA: Cell[][] = [["Record ID", "Client Name", "Consent document", "Intake document", "Photo"]];
const sheetB: Cell[][] = [["Last Name", "First Name", "DOB", "Client Number", "Consent file path", "Photo file path"]];
const named: string[] = [];

people.forEach((p, i) => {
  const year = p.dob.slice(0, 4);
  const consent = `Documents/${year}/${p.last}_${p.first}_${p.dob}_consent.pdf`;
  const intake = `Intake forms/${p.client}.pdf`;
  const photo = `Photos/${p.client}.jpg`;
  const missingFile = i % 97 === 5; // ~1%: listed in the spreadsheet but not on disk
  if (!missingFile) write(consent, pdf(`Consent form for ${p.first} ${p.last}`, i % 500));
  write(intake, pdf(`Intake form for ${p.first} ${p.last} (${p.client})`, (i * 7) % 500));
  if (i % 3 === 0) write(photo, JPEG);

  // A: record IDs + relative Windows-style paths, as exported from another system.
  const unknownRecord = i % 211 === 7; // ~0.5%: a record ID that doesn't exist
  sheetA.push([unknownRecord ? 9_000_000 + i : p.id, `${p.first} ${p.last}`, consent.replace(/\//g, "\\"), intake.replace(/\//g, "\\"), i % 3 === 0 ? photo.replace(/\//g, "\\") : ""]);

  // B: name + date of birth (US format) + full paths on this computer.
  sheetB.push([p.last, p.first, usDate(p.dob), p.client, join(docs, consent), i % 3 === 0 ? join(docs, photo) : ""]);

  // C: file names that carry the record ID.
  if (i < Math.min(count, 1000)) {
    write(`../Named by record ID/${p.id}_intake.pdf`, pdf(`Intake for record ${p.id}`, i % 300));
    named.push(`${p.id}_intake.pdf`);
  }
});

// Deliberate trouble, to see the toolkit catch it.
const p0 = people[0]!;
sheetA.push([p0.id, `${p0.first} ${p0.last} (again)`, "Documents\\duplicate-copy.pdf", "", ""]); // a second consent for the same record
write("Documents/duplicate-copy.pdf", pdf("Duplicate consent", 10));
write("Documents/setup.exe", "MZ not really a program");
sheetA.push([people[1]!.id, "Unsafe file", "Documents\\setup.exe", "", ""]);
write("Documents/huge-scan.pdf", Buffer.alloc(11 * 1024 * 1024, 32)); // over the 10 MB limit
sheetA.push([people[2]!.id, "Too big", "Documents\\huge-scan.pdf", "", ""]);

const toRows = (rows: Cell[][]) => rows.map((r, i) => r.map((value) => (i === 0 ? { value: String(value), fontWeight: "bold" as const } : { value })));
await writeXlsxFile(toRows(sheetA) as never, { columns: sheetA[0]!.map(() => ({ width: 28 })) }).toFile(join(out, "A - mapping by record ID.xlsx"));
await writeXlsxFile(toRows(sheetB) as never, { columns: sheetB[0]!.map(() => ({ width: 28 })) }).toFile(join(out, "B - mapping by name and date of birth.xlsx"));
writeFileSync(join(out, "A - mapping by record ID.csv"), sheetA.map((r) => r.map((v) => (v == null ? "" : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n"));

writeFileSync(
  join(out, "README.txt"),
  `Test data for the Apricot Admin Toolkit (${mock ? "mock API" : `form ${formId}`}), ${people.length} records.

Customer export/        The files, in subfolders, as a customer might send them.
Named by record ID/     ${named.length} files named <record ID>_intake.pdf, for the "file names say" option.

A - mapping by record ID.xlsx (and .csv)
  Record ID + relative Windows-style paths (Documents\\2023\\...). Three file columns:
  Consent document -> Consent Form, Intake document -> Intake Form, Photo -> Photo (every third row).
  Choose the "Customer export" folder as the location. Planted problems:
   - about 1% of consent files are missing from the folder
   - about 0.5% of record IDs don't exist
   - one record gets two consent files (duplicate)
   - one unsafe .exe and one file over 10 MB

B - mapping by name and date of birth.xlsx
  Last name + first name + DOB (MM/DD/YYYY) and full paths on this computer, so no folder is needed.
  Match by fields: Name (last), Name (first), Date of Birth.
`,
);
console.log(`Done: ${people.length} records, files in ${out}`);
