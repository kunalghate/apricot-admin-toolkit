// Makes dummy files and customer-style mapping spreadsheets for testing the attach tool.
//
// Against the local mock API (no real records touched):
//   bun scripts/make-test-data.ts --mock --count 5000 --out "/path/to/folder"
//
// Against a real test form (creates test records on it first, using .env.local credentials):
//   bun scripts/make-test-data.ts --form 117 --count 300 --out "/path/to/folder"
//   The form needs a name-like field (a Name field, or a required text field with "name" in its label),
//   a date field, and at least one Attach Document or Image field. Records created through the API
//   can't be deleted through it, so use a dedicated test form.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import writeXlsxFile from "write-excel-file/node";
import { mockPeople } from "../tests/mock-apricot";
import { ApricotClient } from "../src/server/apricot";
import type { FieldInfo } from "../src/shared/types";

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

// Only ever clear a folder this script made before.
const MARKER = ".toolkit-test-data";
if (existsSync(out) && readdirSync(out).length > 0) {
  if (!existsSync(join(out, MARKER))) {
    console.log(`"${out}" already has other things in it. Choose an empty or new folder.`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, MARKER), "Made by scripts/make-test-data.ts\n");

// ── What the form looks like ─────────────────────────────────────────────────

interface Roles {
  name: { id: number; label: string; split: boolean };
  date: { id: number; label: string };
  extras: { id: number; label: string; values: string[] }[];
  docs: { id: number; label: string }[];
  photo: { id: number; label: string } | null;
}

const BREEDS = ["Labrador", "Siamese", "Beagle", "Tabby", "Poodle", "Mixed", "Goldfish", "Parakeet", "Husky", "Persian"];
const PRACTICES = ["Riverside Animal Clinic", "Northside Vets", "Happy Paws Hospital", "Oak Street Veterinary"];
const SURNAMES = ["Garcia", "Okafor", "Nguyen", "Patel", "Silva", "Kowalski", "Mensah", "Haddad", "Larsen", "Romero", "Tanaka", "Murphy", "Cohen", "Diallo", "Fischer"];
const PET_NAMES = ["Biscuit", "Luna", "Max", "Bella", "Charlie", "Milo", "Daisy", "Rocky", "Coco", "Pepper", "Ziggy", "Nala", "Oscar", "Willow", "Scout", "Hazel", "Leo", "Ruby", "Finn", "Olive"];

function rolesFor(fields: FieldInfo[]): Roles {
  const live = fields.filter((f) => f.active && !f.hidden).sort((a, b) => a.order - b.order);
  const text = live.filter((f) => f.typeId === 1);
  const nameText = text.find((f) => f.required && /name/i.test(f.label)) ?? text.find((f) => /name/i.test(f.label) && !/vet|practice|contact/i.test(f.label));
  const nameField = live.find((f) => f.typeId === 5 && !/contact|vet/i.test(f.label));
  const name = nameText ? { id: nameText.id, label: nameText.label, split: false } : nameField ? { id: nameField.id, label: nameField.label, split: true } : null;
  const dates = live.filter((f) => f.typeId === 17);
  const date = dates.find((f) => /birth/i.test(f.label)) ?? dates.find((f) => f.required) ?? dates[0];
  const extras = text
    .filter((f) => f.id !== name?.id)
    .slice(0, 3)
    .map((f) => ({
      id: f.id,
      label: f.label,
      values: /breed/i.test(f.label) ? BREEDS : /practice|clinic|vet/i.test(f.label) ? PRACTICES : /client|number|id/i.test(f.label) ? [] : ["Test value"],
    }));
  const docs = live.filter((f) => f.typeId === 29).map((f) => ({ id: f.id, label: f.label }));
  const photoF = live.find((f) => f.typeId === 72);
  const missing = [!name && "a name field", !date && "a date field", docs.length + (photoF ? 1 : 0) === 0 && "a file or image field"].filter(Boolean);
  if (missing.length) {
    console.log(`This form is missing ${missing.join(", ")}.`);
    process.exit(1);
  }
  return { name: name!, date: { id: date!.id, label: date!.label }, extras, docs, photo: photoF ? { id: photoF.id, label: photoF.label } : null };
}

interface Entity {
  id: number;
  name: string; // display, e.g. "Biscuit" or "Jane Doe"
  first?: string;
  last?: string;
  date: string; // YYYY-MM-DD
  extras: string[];
  tag: string; // short unique token for file names
}

let roles: Roles;
let entities: Entity[];

if (mock) {
  roles = {
    name: { id: 10, label: "Name", split: true },
    date: { id: 11, label: "Date of Birth" },
    extras: [{ id: 12, label: "Client Number", values: [] }],
    docs: [{ id: 20, label: "Consent Form" }, { id: 21, label: "Intake Form" }],
    photo: { id: 22, label: "Photo" },
  };
  entities = mockPeople(count).map((p) => ({ id: p.id, name: `${p.first} ${p.last}`, first: p.first, last: p.last, date: p.dob, extras: [p.client], tag: p.client }));
} else {
  const env = Object.fromEntries(
    [...readFileSync(join(import.meta.dir, "..", ".env.local"), "utf8").matchAll(/^(\w+)="?([^"\n]*)"?/gm)].map((m) => [m[1], m[2]]),
  );
  const c = new ApricotClient("test-data", env.CLIENT_ID!, env.CLIENT_SECRET!);
  roles = rolesFor(await c.fields(formId));
  console.log(
    `Form ${formId}: name "${roles.name.label}", date "${roles.date.label}", ` +
      `extras ${roles.extras.map((e) => `"${e.label}"`).join(", ") || "none"}, ` +
      `files ${[...roles.docs, ...(roles.photo ? [roles.photo] : [])].map((d) => `"${d.label}"`).join(", ")}`,
  );

  const people = mockPeople(count);
  const plan = people.map((p, i): Omit<Entity, "id"> => {
    const isPet = !roles.name.split;
    const date = isPet ? new Date(Date.UTC(2015, 0, 1) + i * 5 * 86_400_000).toISOString().slice(0, 10) : p.dob;
    // Name fields often have a duplicate check, so every name is unique.
    const round = Math.floor(i / PET_NAMES.length);
    const surname = round === 0 ? "" : ` ${SURNAMES[(round - 1) % SURNAMES.length]}${round > SURNAMES.length ? ` ${Math.ceil(round / SURNAMES.length)}` : ""}`;
    const name = isPet ? `${PET_NAMES[i % PET_NAMES.length]}${surname}` : `${p.first} ${p.last}`;
    return {
      name,
      first: isPet ? undefined : p.first,
      last: isPet ? undefined : p.last,
      date,
      extras: roles.extras.map((e, j) => (e.values.length ? e.values[(i + j) % e.values.length]! : p.client)),
      tag: `${name.replace(/\s+/g, "")}-${String(i + 1).padStart(4, "0")}`,
    };
  });

  const attributesFor = (e: Omit<Entity, "id">) => {
    const a: Record<string, unknown> = { form_id: formId, [`field_${roles.date.id}`]: e.date };
    if (roles.name.split) {
      a[`field_${roles.name.id}_first`] = e.first;
      a[`field_${roles.name.id}_last`] = e.last;
    } else a[`field_${roles.name.id}`] = e.name;
    roles.extras.forEach((x, j) => (a[`field_${x.id}`] = e.extras[j]));
    return a;
  };
  const create = async (e: Omit<Entity, "id">): Promise<number> => {
    const res = await c.request("POST", "/records", { json: { type: "records", attributes: attributesFor(e) } });
    const id = Number(res?.data?.[0]?.id ?? res?.data?.id);
    if (!id) throw new Error(`Creating a record returned no ID: ${JSON.stringify(res).slice(0, 300)}`);
    return id;
  };

  // Reuse records already on the form (from an earlier, interrupted run) instead of duplicating them.
  const existing = new Map<string, number>();
  for (let page = 1; page <= 200; page++) {
    const body = await c.request("GET", "/records", { query: { form_id: formId, "page[size]": 100, "page[number]": page } });
    const data: any[] = body?.data ?? [];
    for (const r of data) {
      const a = r.attributes ?? {};
      const n = roles.name.split ? `${a[`field_${roles.name.id}_first`]} ${a[`field_${roles.name.id}_last`]}` : String(a[`field_${roles.name.id}`] ?? "");
      existing.set(`${n}|${String(a[`field_${roles.date.id}`] ?? "").slice(0, 10)}`, Number(r.id));
    }
    if (data.length < 100) break;
  }
  entities = [];
  const todo: Omit<Entity, "id">[] = [];
  for (const e of plan) {
    const id = existing.get(`${e.name}|${e.date}`);
    if (id) entities.push({ ...e, id });
    else todo.push(e);
  }
  if (entities.length) console.log(`Reusing ${entities.length} records already on the form.`);

  if (todo.length) {
    // One record first, read back, so a wrong field format stops everything early.
    const firstId = await create(todo[0]!);
    const back = (await c.getRecord(firstId))?.attributes ?? {};
    const nameBack = roles.name.split ? back[`field_${roles.name.id}_first`] : back[`field_${roles.name.id}`];
    if (!nameBack || String(back[`field_${roles.date.id}`] ?? "").slice(0, 10) !== todo[0]!.date) {
      console.log(`Record ${firstId} was created, but its values didn't read back as expected:`, JSON.stringify(back).slice(0, 400));
      process.exit(1);
    }
    console.log(`Created and checked record ${firstId}. Creating ${todo.length - 1} more…`);
    entities.push({ ...todo[0]!, id: firstId });
    let next = 1;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < todo.length) {
          const e = todo[next++]!;
          entities.push({ ...e, id: await create(e) });
          if (entities.length % 50 === 0) console.log(`  ${entities.length} records ready`);
        }
      }),
    );
  }
  entities.sort((a, b) => a.id - b.id);
  writeFileSync(join(out, "created-records.json"), JSON.stringify({ formId, ids: entities.map((e) => e.id) }, null, 1));
}

// ── Files ────────────────────────────────────────────────────────────────────

const docsDir = join(out, "Customer export");
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
  const full = join(docsDir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, data);
  return full;
};
const FILLER = new Set(["past", "pet", "pets", "my", "the", "a", "an", "of", "related", "files", "file", "form", "upload"]);
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").find((w) => !FILLER.has(w.toLowerCase())) ?? "File";
const usDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const win = (p: string) => p.replace(/\//g, "\\");

type Cell = string | number | null;
const docCols = roles.docs.map((d) => `${d.label} file`);
const photoCol = roles.photo ? [`${roles.photo.label} file`] : [];
const nameCols = roles.name.split ? ["Last Name", "First Name"] : [roles.name.label];
const sheetA: Cell[][] = [["Record ID", roles.name.split ? "Name" : roles.name.label, ...docCols, ...photoCol]];
const sheetB: Cell[][] = [[...nameCols, roles.date.label, ...docCols, ...photoCol]];
const named: string[] = [];

entities.forEach((e, i) => {
  const docPaths = roles.docs.map((d, j) => {
    const rel = j === 0 ? `${slug(d.label)}/${e.date.slice(0, 4)}/${e.tag}_${e.date}_${slug(d.label).toLowerCase()}.pdf` : `${slug(d.label)}/${e.tag}.pdf`;
    const missing = j === 0 && i % 97 === 5; // ~1%: listed in the spreadsheet, not on disk
    if (!missing) write(rel, pdf(`${d.label} for ${e.name} (${e.tag})`, (i * (j + 3)) % 500));
    return rel;
  });
  const hasPhoto = !!roles.photo && i % 3 === 0;
  const photo = hasPhoto ? `Photos/${e.tag}.jpg` : "";
  if (hasPhoto) write(photo, JPEG);

  const unknownRecord = i % 211 === 7; // ~0.5%: a record ID that doesn't exist
  sheetA.push([unknownRecord ? 9_000_000 + i : e.id, e.name, ...docPaths.map(win), ...(roles.photo ? [photo ? win(photo) : ""] : [])]);
  const names = roles.name.split ? [e.last ?? "", e.first ?? ""] : [e.name];
  sheetB.push([...names, usDate(e.date), ...docPaths.map((p) => join(docsDir, p)), ...(roles.photo ? [photo ? join(docsDir, photo) : ""] : [])]);

  if (roles.docs.length && i < Math.min(entities.length, 1000)) {
    write(`../Named by record ID/${e.id}_${slug(roles.docs[0]!.label).toLowerCase()}.pdf`, pdf(`${roles.docs[0]!.label} for record ${e.id}`, i % 300));
    named.push(String(e.id));
  }
});

// Deliberate trouble, to see the toolkit catch it.
if (roles.docs.length && entities.length >= 3) {
  const blank = (n: number) => Array.from({ length: n }, () => "");
  const rest = roles.docs.length - 1 + (roles.photo ? 1 : 0);
  write("Extras/duplicate-copy.pdf", pdf("A second file for the same record", 10));
  sheetA.push([entities[0]!.id, `${entities[0]!.name} (again)`, "Extras\\duplicate-copy.pdf", ...blank(rest)]);
  write("Extras/setup.exe", "MZ not really a program");
  sheetA.push([entities[1]!.id, "Unsafe file", "Extras\\setup.exe", ...blank(rest)]);
  write("Extras/huge-scan.pdf", Buffer.alloc(11 * 1024 * 1024, 32)); // over the 10 MB limit
  sheetA.push([entities[2]!.id, "Too big", "Extras\\huge-scan.pdf", ...blank(rest)]);
}

const toRows = (rows: Cell[][]) => rows.map((r, i) => r.map((value) => (i === 0 ? { value: String(value), fontWeight: "bold" as const } : { value })));
await writeXlsxFile(toRows(sheetA) as never, { columns: sheetA[0]!.map(() => ({ width: 30 })) }).toFile(join(out, "A - mapping by record ID.xlsx"));
await writeXlsxFile(toRows(sheetB) as never, { columns: sheetB[0]!.map(() => ({ width: 30 })) }).toFile(join(out, `B - mapping by ${roles.name.split ? "name" : roles.name.label.toLowerCase()} and ${roles.date.label.toLowerCase()}.xlsx`));
writeFileSync(
  join(out, "A - mapping by record ID.csv"),
  sheetA.map((r) => r.map((v) => (v == null ? "" : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n"),
);

const fileList = [...roles.docs.map((d) => d.label), ...(roles.photo ? [`${roles.photo.label} (every third row)`] : [])].join(", ");
writeFileSync(
  join(out, "README.txt"),
  `Test data for the Apricot Admin Toolkit (${mock ? "mock API" : `form ${formId}`}), ${entities.length} records.

Customer export/        The files, in subfolders, as a customer might send them.
Named by record ID/     ${named.length} files named <record ID>_….pdf, for the "file names say" option.

A - mapping by record ID.xlsx (and .csv)
  Record ID + relative Windows-style paths. File columns: ${fileList}.
  Choose the "Customer export" folder as the location. Planted problems:
   - about 1% of ${roles.docs[0]?.label ?? "document"} files are missing from the folder
   - about 0.5% of record IDs don't exist
   - one record gets two files in the same field (duplicate)
   - one unsafe .exe and one file over 10 MB

B - mapping by ${roles.name.split ? "name" : roles.name.label} and ${roles.date.label}
  ${nameCols.join(" + ")} + ${roles.date.label} (MM/DD/YYYY) and full paths on this computer, so no folder is needed.
  Match by fields: ${roles.name.split ? "Name (last), Name (first)" : roles.name.label}, ${roles.date.label}.${roles.name.split ? "" : `\n  Pet names repeat, so ${roles.name.label} alone matches several records; with ${roles.date.label} it's unique.`}
`,
);
console.log(`Done: ${entities.length} records, files in ${out}`);
