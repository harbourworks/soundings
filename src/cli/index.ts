import { createInterface } from "node:readline/promises";
import { run, type CliDeps } from "./main.js";

/** Asks at a terminal, one question at a time. Empty skips; end of input (Ctrl+D) stops. */
function terminalAsker(): { ask: NonNullable<CliDeps["ask"]>; close: () => void } | null {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => (closed = true));
  return {
    close: () => rl.close(),
    ask: async (pending, index, total) => {
      if (closed) return null;
      try {
        return await rl.question(`\n  (${index + 1}/${total}) ${pending.prompt}\n  Press Enter to skip. > `);
      } catch {
        return null;
      }
    },
  };
}

const asker = terminalAsker();
try {
  process.exitCode = await run(process.argv.slice(2), {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    env: process.env,
    cwd: process.cwd(),
    now: () => new Date(),
    ...(asker ? { ask: asker.ask } : {}),
  });
} finally {
  asker?.close();
}
