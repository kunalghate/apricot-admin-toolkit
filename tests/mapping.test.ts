import { expect, test } from "bun:test";
import { guessColumnFor, guessFieldForColumn, guessFileColumns, guessRecordIdColumn, indexFiles, pathStyle, resolveFile, type Sheet } from "../src/web/lib/mapping";
import type { FileItem } from "../src/web/lib/files";

const f = (path: string): FileItem => ({ id: path, path, name: path.split("/").pop()!, size: 1 });
const files = [f("2023/A/consent.pdf"), f("2023/B/consent.pdf"), f("2024/intake_1001.pdf"), f("photos/1001.jpg"), f("readme.txt")];

test("resolves relative, full and foreign paths", () => {
  const idx = indexFiles(files, "/Users/me/Downloads/export");
  const r = (v: string) => resolveFile(v, idx);
  expect(r("2024/intake_1001.pdf")).toMatchObject({ status: "found", how: "exact" });
  expect(r("intake_1001.pdf")).toMatchObject({ status: "found", file: { path: "2024/intake_1001.pdf" } });
  expect(r("2024\\intake_1001.pdf")).toMatchObject({ status: "found" });
  expect(r("/Users/me/Downloads/export/photos/1001.jpg")).toMatchObject({ status: "found", how: "exact" });
  expect(r("D:\\CustomerShare\\export\\2023\\A\\consent.pdf")).toMatchObject({ status: "found", file: { path: "2023/A/consent.pdf" } });
  expect(r("consent.pdf")).toMatchObject({ status: "ambiguous" });
  expect(r("B/consent.pdf")).toMatchObject({ status: "found", file: { path: "2023/B/consent.pdf" } });
  expect(r("Photos/1001.JPG")).toMatchObject({ status: "found" });
  expect(r("readme")).toMatchObject({ status: "found", how: "name" });
  expect(r("nothing.pdf")).toMatchObject({ status: "missing" });
  expect(r("  ")).toMatchObject({ status: "empty" });
  expect(r('"2024/intake_1001.pdf"')).toMatchObject({ status: "found" });
  expect(r("https://example.org/files/abc.pdf?x=1")).toMatchObject({ status: "found", how: "link", file: { name: "abc.pdf" } });
});

test("guesses columns", () => {
  const sheet: Sheet = {
    name: "m.xlsx",
    header: ["Client ID", "First", "Surname", "DOB", "Consent file", "Photo"],
    rows: [
      ["25698", "Jane", "Doe", "03/02/1985", "docs\\jane consent.pdf", "jane.jpg"],
      ["25697", "Sam", "Lee", "1990-01-01", "docs\\sam consent.pdf", ""],
    ],
  };
  expect(guessFileColumns(sheet)).toEqual([4, 5]);
  expect(guessRecordIdColumn(sheet, [4, 5])).toBe(0);
  const opt = (label: string) => ({ key: "k", fieldId: 1, label, kind: "text" as const });
  expect(guessColumnFor(sheet, opt("Name: first name"), [])).toBe(1);
  expect(guessColumnFor(sheet, opt("Name: last name"), [])).toBe(2);
  expect(guessColumnFor(sheet, opt("Date of Birth"), [])).toBe(3);
  expect(pathStyle(["C:\\a\\b.pdf", "\\\\srv\\x\\c.pdf"])).toBe("full");
  expect(pathStyle(["a/b.pdf", "c.pdf"])).toBe("relative");
});

test("dates and numbers are never file columns", () => {
  const sheet: Sheet = {
    name: "b.xlsx",
    header: ["Last Name", "First Name", "DOB", "Amount", "Consent file path"],
    rows: [
      ["Doe", "Jane", "01/01/1950", "12.50", "C:\\Exports\\Doe_Jane.pdf"],
      ["Lee", "Sam", "1990-02-03", "7", "C:\\Exports\\Lee_Sam.PDF"],
    ],
  };
  expect(guessFileColumns(sheet)).toEqual([4]);
  const opt = (label: string) => ({ key: "k", fieldId: 1, label, kind: "date" as const });
  expect(guessColumnFor(sheet, opt("Date of Birth"), [4])).toBe(2);
});

test("file columns go to the field their header names", () => {
  const sheet: Sheet = {
    name: "x.xlsx",
    header: ["ID", "Photo file path", "Consent document", "Other attachment"],
    rows: [["1", "a/1.jpg", "a/1.pdf", "x.docx"], ["2", "a/2.png", "a/2.pdf", "y.docx"]],
  };
  const fields = [
    { id: 20, label: "Consent Form", image: false },
    { id: 21, label: "Intake Form", image: false },
    { id: 22, label: "Photo", image: true },
  ];
  expect(guessFieldForColumn(sheet, 1, fields, new Set(), 20)).toBe(22);
  expect(guessFieldForColumn(sheet, 2, fields, new Set(), 21)).toBe(20);
  expect(guessFieldForColumn(sheet, 3, fields, new Set([20]), 21)).toBe(21);
});
