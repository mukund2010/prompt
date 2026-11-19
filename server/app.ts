import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { RunManager } from "./core/runner";
import { ProviderRegistry } from "./providers/registry";
import { apiRouter, HttpError } from "./routes/api";
import { ExperimentStore } from "./store/experimentStore";

export interface AppOptions {
  dataFile: string;
  settingsFile: string;
  /** Directory of the built client to serve (production). */
  staticDir?: string;
}

export function createApp(opts: AppOptions) {
  const store = new ExperimentStore(opts.dataFile);
  const registry = new ProviderRegistry(opts.settingsFile);
  const runs = new RunManager(store, registry);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", apiRouter(store, registry, runs));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API endpoint." });
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  // Central error handler: never leaks stack traces or secrets.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError && "body" in (err as object)) return res.status(400).json({ error: "Request body is not valid JSON." });
    console.error("[api] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error." });
  });

  return { app, store, registry, runs };
}
