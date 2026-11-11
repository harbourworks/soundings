import type { Detector } from "../types.js";
import { aiDetectors } from "./ai.js";
import { authDetectors } from "./auth.js";
import { exposureDetectors } from "./exposure.js";
import { loggingDetectors } from "./logging.js";
import { secretDetectors } from "./secrets.js";
import { serviceDetectors } from "./services.js";
import { storeDetectors } from "./stores.js";

export const DETECTORS: Detector[] = [
  ...aiDetectors,
  ...serviceDetectors,
  ...authDetectors,
  ...storeDetectors,
  ...secretDetectors,
  ...loggingDetectors,
  ...exposureDetectors,
];
