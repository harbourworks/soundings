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
      "/*! Soundings (c) 2026 Dynamo Maritime Ltd. Licensed under FSL-1.1-ALv2, except the paid features listed in LICENSE-COMMERCIAL.md,",
      " *  which are under the Soundings Commercial Licence. See LICENSE. */",
    ].join("\n"),
  },
});
