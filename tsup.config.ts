import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  banner: {
    js: [
      "#!/usr/bin/env node",
      "/*! Soundings (c) 2026 Dynamo Maritime Ltd. Licensed under FSL-1.1-ALv2, except code from src/pro/,",
      " *  which is under the Soundings Commercial Licence. See LICENSE and LICENSE-COMMERCIAL.md. */",
    ].join("\n"),
  },
});
