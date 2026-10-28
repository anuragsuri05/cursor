import { spawn } from "node:child_process";
import os from "node:os";
import { createRequire } from "node:module";
import { getRoot } from "./workspace.js";

const require = createRequire(import.meta.url);
let pty: any = null;
try { pty = require("node-pty"); } catch { /* fall back to pipes */ }

export interface Term {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export function createTerminal(cols: number, rows: number, onData: (d: string) => void, onExit: (code: number) => void): Term {
  const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");
  const cwd = getRoot() || os.homedir();
  const env = { ...process.env, PWD: cwd, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "spacebar" } as Record<string, string>;
  if (pty) {
    try {
      const p = pty.spawn(shell, ["-l"], { name: "xterm-256color", cols, rows, cwd, env });
      p.onData(onData);
      p.onExit(({ exitCode }: any) => onExit(exitCode));
      return { write: (d) => p.write(d), resize: (c, r) => { try { p.resize(c, r); } catch { /* exited */ } }, kill: () => p.kill() };
    } catch { /* fall through */ }
  }
  // Pipe fallback: no TTY features, but basic commands work.
  const child = spawn(shell, ["-i"], { cwd, env });
  child.stdout.on("data", (d) => onData(d.toString()));
  child.stderr.on("data", (d) => onData(d.toString()));
  child.on("close", (c) => onExit(c ?? 0));
  return { write: (d) => child.stdin.write(d.replace(/\r/g, "\n")), resize: () => {}, kill: () => child.kill() };
}
