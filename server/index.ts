import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.resolve(root, process.env.DATA_FILE || "data/experiments.json");
const port = Number(process.env.PORT || 8787);

const { app, store, registry } = createApp({
  dataFile,
  settingsFile: path.join(path.dirname(dataFile), "settings.json"),
  staticDir: process.env.NODE_ENV === "production" ? path.join(root, "dist") : undefined,
});

const server = app.listen(port, () => {
  const d = registry.describe();
  console.log(`\n  Prompt Crash Lab API  →  http://localhost:${port}/api`);
  if (process.env.NODE_ENV === "production") console.log(`  App                   →  http://localhost:${port}`);
  console.log(`  Executor: ${d.settings.executor} · Analyst: ${d.settings.analyst} · Mode: ${d.mode.toUpperCase()}`);
  for (const p of d.providers) console.log(`    - ${p.label}: ${p.configured ? "configured" : "not configured"}`);
  console.log("");
});

function shutdown() {
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
