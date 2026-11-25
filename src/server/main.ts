// Apricot Admin Toolkit: starts the local server and opens the browser.

import index from "../web/index.html";
import { APP_NAME, PORT, VERSION, dataDir } from "./config";
import { routes } from "./routes";

const URL_TO_OPEN = `http://localhost:${PORT}`;
const noOpen = process.argv.includes("--no-open");
const isDev = process.env.NODE_ENV !== "production";

function openBrowser(url: string) {
  if (noOpen) return;
  try {
    if (process.platform === "win32") Bun.spawn(["rundll32", "url.dll,FileProtocolHandler", url]);
    else if (process.platform === "darwin") Bun.spawn(["open", url]);
    else Bun.spawn(["xdg-open", url]);
  } catch {
    // The banner tells people the address anyway.
  }
}

function waitAndExit(code: number): never {
  // Keep the window open on Windows so people can read the message.
  try {
    prompt("\nPress Enter to close this window.");
  } catch {}
  process.exit(code);
}

async function alreadyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/app`, {
      headers: { "x-toolkit": "1", host: `127.0.0.1:${PORT}` },
      signal: AbortSignal.timeout(1500),
    });
    const j = (await res.json()) as { name?: string };
    return j.name === APP_NAME;
  } catch {
    return false;
  }
}

function start(hostname: string) {
  return Bun.serve({
    hostname,
    port: PORT,
    // Uploads and record lookups can take a while; don't drop slow requests (max 255s).
    idleTimeout: 255,
    routes: { "/": index, ...routes },
    fetch: () => new Response("Not found", { status: 404 }),
    development: isDev ? { hmr: true, console: true } : false,
  });
}

try {
  start("127.0.0.1");
} catch (err: any) {
  if (await alreadyRunning()) {
    console.log(`\n  ${APP_NAME} is already running.\n  Opening ${URL_TO_OPEN} in your browser…\n`);
    openBrowser(URL_TO_OPEN);
    await Bun.sleep(1500);
    process.exit(0);
  }
  console.error(`\n  ${APP_NAME} couldn't start: another program is using port ${PORT}.`);
  console.error(`  Close that program, or restart your computer, then try again.`);
  waitAndExit(1);
}

// Also listen on IPv6 loopback, since some Windows setups resolve "localhost" to ::1 first.
try {
  start("::1");
} catch {
  // Fine: IPv6 not available.
}

const line = "─".repeat(58);
console.log(`
  ${line}
   🍑  ${APP_NAME}  v${VERSION}
  ${line}

   The toolkit is running. It should open in your browser.
   If it doesn't, go to:   ${URL_TO_OPEN}

   Keep this window open while you work.
   Close it when you're done.
  ${line}
`);
if (isDev) console.log(`   (dev mode, data folder: ${dataDir()})\n`);

openBrowser(URL_TO_OPEN);
