import { run } from "./main.js";

const code = await run(process.argv.slice(2), {
  out: (s) => console.log(s),
  err: (s) => console.error(s),
  env: process.env,
  cwd: process.cwd(),
  now: () => new Date(),
});
process.exitCode = code;
