// Builds the single-file programs users download.
//   bun run build            → all platforms
//   bun run build --current  → only this computer's platform (quick local test)

import tailwind from "bun-plugin-tailwind";
import { rmSync, mkdirSync } from "node:fs";
import pkg from "../package.json";

const ALL = [
  { target: "bun-windows-x64", file: "apricot-toolkit-windows-x64.exe" },
  { target: "bun-darwin-arm64", file: "apricot-toolkit-macos-arm64" },
  { target: "bun-darwin-x64", file: "apricot-toolkit-macos-x64" },
] as const;

const current = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const targets = process.argv.includes("--current") ? ALL.filter((t) => t.target === current) : ALL;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

for (const t of targets) {
  const started = Date.now();
  const result = await Bun.build({
    entrypoints: ["src/server/main.ts"],
    plugins: [tailwind],
    minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    compile: {
      target: t.target as Bun.Build.CompileTarget,
      outfile: `dist/${t.file}`,
      // Trust the operating system's certificates, so the app works behind
      // company networks that inspect HTTPS traffic.
      execArgv: ["--use-system-ca"],
      autoloadDotenv: false,
      autoloadBunfig: false,
      windows: {
        title: "Apricot Admin Toolkit",
        description: "Apricot Admin Toolkit",
        version: pkg.version,
      },
    },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  const size = (Bun.file(`dist/${t.file}`).size / 1024 / 1024).toFixed(0);
  console.log(`✓ dist/${t.file}  (${size} MB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
