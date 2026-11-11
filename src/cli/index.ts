import { VERSION } from "../version.js";

// Phase 0 placeholder: the scan command arrives in Phase 1.
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
} else {
  console.log(`Soundings ${VERSION} (pre-release). Scanning is not built yet.`);
}
