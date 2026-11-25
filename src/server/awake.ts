// Keep the computer from going to sleep while a run is going. No admin rights needed.
//  - Windows: SetThreadExecutionState (the same call video players use).
//  - Mac: the built-in `caffeinate` command, tied to this process.

let holds = 0;
let mac: ReturnType<typeof Bun.spawn> | null = null;
let win: ((flags: number) => number) | null | undefined;

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;

function windowsCall() {
  if (win !== undefined) return win;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const lib = dlopen("kernel32.dll", { SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 } });
    win = (flags) => lib.symbols.SetThreadExecutionState(flags) as number;
  } catch {
    win = null;
  }
  return win;
}

function apply(on: boolean) {
  try {
    if (process.platform === "win32") {
      windowsCall()?.(on ? (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0 : ES_CONTINUOUS >>> 0);
    } else if (process.platform === "darwin") {
      if (on && !mac) mac = Bun.spawn(["caffeinate", "-i", "-w", String(process.pid)], { stdout: "ignore", stderr: "ignore" });
      if (!on && mac) {
        mac.kill();
        mac = null;
      }
    }
  } catch {
    // Not being able to stay awake is never a reason to fail a run.
  }
}

export function holdAwake() {
  if (holds++ === 0) apply(true);
}

export function releaseAwake() {
  holds = Math.max(0, holds - 1);
  if (holds === 0) apply(false);
}
