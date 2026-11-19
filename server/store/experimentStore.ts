/**
 * JSON-file persistence for experiments. Keeps an in-memory copy, writes
 * atomically (temp file + rename) and coalesces bursts of writes.
 * The storage interface is small on purpose so it can be swapped for SQLite
 * or a hosted database later without touching the routes.
 */
import fs from "node:fs";
import path from "node:path";
import type { Experiment, ExperimentSummary } from "../../shared/types";

interface FileShape {
  version: 1;
  experiments: Experiment[];
}

export class ExperimentStore {
  private experiments = new Map<string, Experiment>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    this.load();
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as FileShape;
      for (const e of data.experiments ?? []) {
        // Runs that were in flight when the server stopped cannot resume.
        for (const r of e.runs)
          if (r.status === "running" || r.status === "queued") {
            r.status = "failed";
            r.error = "Interrupted: the server stopped before this run finished.";
            r.finishedAt = r.finishedAt ?? new Date().toISOString();
          }
        this.experiments.set(e.id, e);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try {
          fs.copyFileSync(this.file, backup);
        } catch {
          /* ignore */
        }
        console.error(`[store] Could not read ${this.file}; a backup was written to ${backup}.`, e);
      }
    }
  }

  list(): Experiment[] {
    return [...this.experiments.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  put(e: Experiment) {
    this.experiments.set(e.id, e);
    this.scheduleSave();
  }

  /** Marks an experiment as changed (after in-place mutation) and schedules a save. */
  touch(e: Experiment, updateTimestamp = true) {
    if (updateTimestamp) e.updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  delete(id: string): boolean {
    const ok = this.experiments.delete(id);
    if (ok) this.scheduleSave();
    return ok;
  }

  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 150);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const data: FileShape = { version: 1, experiments: [...this.experiments.values()] };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

export function summarizeExperiment(e: Experiment): ExperimentSummary {
  const full = e.runs.filter((r) => r.scope === "full" && r.status === "completed");
  const original = e.versions.find((v) => v.origin === "original");
  const origRuns = full.filter((r) => r.versionId === original?.id);
  const latest = full.at(-1);
  return {
    id: e.id,
    name: e.name,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    testCount: e.testCases.length,
    versionCount: e.versions.length,
    runCount: e.runs.length,
    latestPassRate: latest?.summary.passRate ?? null,
    originalPassRate: origRuns.at(-1)?.summary.passRate ?? null,
    bestPassRate: full.length ? Math.max(...full.map((r) => r.summary.passRate)) : null,
    mode: latest?.mode ?? null,
    promptPreview: e.config.prompt.slice(0, 160),
  };
}
