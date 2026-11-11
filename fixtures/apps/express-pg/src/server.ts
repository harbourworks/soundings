import express from "express";
import pino from "pino";
import { requireAuth } from "./auth";
import { triage } from "./ai";

const logger = pino();
const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  logger.info({ body: req.body }, "incoming request");
  next();
});

app.post("/tickets/triage", requireAuth, async (req, res) => {
  res.json({ label: await triage(req.body.text) });
});

app.listen(3000);
