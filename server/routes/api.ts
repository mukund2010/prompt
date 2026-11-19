import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { CATEGORY_LABELS, TEST_CATEGORIES, type DashboardStats, type Experiment, type PromptVersion, type Severity, type TestCase } from "../../shared/types";
import { defaultComparison } from "../../shared/selectors";
import { newId, nextTestId, now } from "../core/ids";
import { optimizeRuleBased, optimizeWithAnalyst } from "../core/optimizer";
import { reportHtml, reportJson, reportMarkdown } from "../core/report";
import type { RunManager } from "../core/runner";
import { generateRuleBased, generateWithAnalyst } from "../core/testGenerator";
import type { ProviderRegistry } from "../providers/registry";
import { summarizeExperiment, type ExperimentStore } from "../store/experimentStore";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ----------------------------- validation ----------------------------------

const termList = z.array(z.string().trim().min(1).max(200)).max(30).default([]);
const ConstraintsSchema = z.object({
  maxWords: z.coerce.number().int().min(1).max(20000).nullable().optional(),
  minWords: z.coerce.number().int().min(1).max(20000).nullable().optional(),
  mustInclude: termList,
  mustNotInclude: termList,
  requiredJsonKeys: termList,
});
const ConfigSchema = z.object({
  prompt: z.string().trim().min(10, "The prompt must be at least 10 characters.").max(50000, "The prompt is too long (max 50,000 characters)."),
  taskDescription: z.string().trim().max(5000).default(""),
  outputFormat: z.enum(["free", "json", "markdown", "bullets", "single-line", "custom"]).default("free"),
  formatDetails: z.string().max(5000).default(""),
  constraints: ConstraintsSchema.default({ mustInclude: [], mustNotInclude: [], requiredJsonKeys: [] }),
  consistencyRuns: z.coerce.number().int().min(1).max(5).default(1),
});
const CreateSchema = z.object({ name: z.string().trim().max(120).optional(), config: ConfigSchema });
const PatchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), config: ConfigSchema.partial().optional() });
const TestSchema = z.object({
  input: z.string().max(60000),
  category: z.enum(TEST_CATEGORIES),
  expectedBehavior: z.string().trim().min(3, "Describe the expected behaviour.").max(4000),
  rationale: z.string().max(2000).default(""),
});
const GenerateSchema = z.object({
  count: z.coerce.number().int().min(1).max(40).default(12),
  categories: z.array(z.enum(TEST_CATEGORIES)).min(1).default([...TEST_CATEGORIES]),
  replace: z.boolean().default(false),
});
const RunSchema = z.object({ versionId: z.string(), testIds: z.array(z.string()).optional() });
const OptimizeSchema = z.object({ versionId: z.string(), runId: z.string().optional() });
const VersionSchema = z.object({ prompt: z.string().trim().min(10).max(50000), label: z.string().trim().max(80).optional(), fromDraft: z.boolean().default(false) });
const ProviderUpdateSchema = z.object({
  executor: z.enum(["anthropic", "gemini", "openai-compatible", "demo"]).optional(),
  analyst: z.enum(["anthropic", "gemini", "openai-compatible", "demo"]).optional(),
  anthropicKey: z.string().max(400).optional(),
  anthropicModel: z.string().max(100).optional(),
  geminiKey: z.string().max(400).optional(),
  geminiOnlyGeneration: z.boolean().optional(),
  geminiModel: z.string().max(100).optional(),
  openaiBaseUrl: z.string().max(400).optional(),
  openaiKey: z.string().max(400).optional(),
  openaiModel: z.string().max(100).optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, `${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}`);
  }
  return r.data;
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

// ------------------------------- routes ------------------------------------

export function apiRouter(store: ExperimentStore, registry: ProviderRegistry, runs: RunManager): Router {
  const r = Router();

  const getExp = (req: Request): Experiment => {
    const e = store.get(String(req.params.id));
    if (!e) throw new HttpError(404, "Experiment not found.");
    return e;
  };
  const busy = (e: Experiment) => e.runs.some((x) => x.status === "running" || x.status === "queued");
  const nextLabel = (e: Experiment, kind: string) => `v${e.versions.length + 1} · ${kind}`;
  /** Provider for generating tests and prompts; a missing key is a clear 409, never a silent fallback. */
  const generationProvider = () => {
    try {
      return registry.generationProvider();
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
  };

  r.get("/health", (_req, res) => {
    res.json({ ok: true, time: now(), mode: registry.describe().mode });
  });

  // Providers ---------------------------------------------------------------
  r.get("/providers", (_req, res) => {
    res.json(registry.describe());
  });
  r.get(
    "/providers/gemini/models",
    wrap(async (_req, res) => {
      try {
        res.json(await registry.geminiModels());
      } catch (err) {
        throw new HttpError(/first/.test((err as Error).message) ? 409 : 502, (err as Error).message);
      }
    }),
  );
  r.put(
    "/providers",
    wrap((req, res) => {
      const body = parse(ProviderUpdateSchema, req.body);
      try {
        res.json(registry.update(body));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }),
  );
  r.post(
    "/providers/test",
    wrap(async (req, res) => {
      const role = req.body?.role === "analyst" ? "analyst" : "executor";
      let provider;
      try {
        provider = registry.forRole(role);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      try {
        const out = await provider.complete({ user: "Reply with the single word: pong", purpose: "ping", maxTokens: 50 });
        res.json({ ok: true, provider: provider.id, model: out.model, latencyMs: out.latencyMs, reply: out.text.slice(0, 200), demo: provider.isDemo });
      } catch (e) {
        res.json({ ok: false, provider: provider.id, error: (e as Error).message });
      }
    }),
  );

  // Dashboard ---------------------------------------------------------------
  r.get("/stats", (_req, res) => {
    const exps = store.list();
    const stats: DashboardStats = {
      totalExperiments: exps.length,
      totalTestCases: 0,
      totalExecutions: 0,
      passedExecutions: 0,
      failedExecutions: 0,
      averagePassRate: null,
      liveRuns: 0,
      demoRuns: 0,
      recent: [],
      severityTotals: { critical: 0, high: 0, medium: 0, low: 0 },
      categoryTotals: {},
      improvements: [],
    };
    const rates: number[] = [];
    for (const e of exps) {
      stats.totalTestCases += e.testCases.length;
      for (const run of e.runs) {
        if (run.status !== "completed") continue;
        run.mode === "live" ? stats.liveRuns++ : stats.demoRuns++;
        stats.totalExecutions += run.summary.completed;
        stats.passedExecutions += run.summary.passed;
        stats.failedExecutions += run.summary.failed;
        if (run.scope === "full") rates.push(run.summary.passRate);
        for (const s of Object.keys(stats.severityTotals) as Severity[]) stats.severityTotals[s] += run.summary.bySeverity[s];
        for (const [cat, v] of Object.entries(run.summary.byCategory)) {
          const label = CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat;
          stats.categoryTotals[label] ??= { total: 0, passed: 0 };
          stats.categoryTotals[label].total += v.total;
          stats.categoryTotals[label].passed += v.passed;
        }
        stats.recent.push({
          experimentId: e.id,
          experimentName: e.name,
          runId: run.id,
          versionLabel: e.versions.find((v) => v.id === run.versionId)?.label ?? "?",
          passRate: run.summary.passRate,
          mode: run.mode,
          finishedAt: run.finishedAt ?? run.startedAt,
          total: run.summary.completed,
        });
      }
      const { baseline, candidate } = defaultComparison(e);
      if (baseline && candidate) stats.improvements.push({ experimentName: e.name, original: baseline.summary.passRate, improved: candidate.summary.passRate });
    }
    stats.averagePassRate = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null;
    stats.recent.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
    stats.recent = stats.recent.slice(0, 12);
    res.json(stats);
  });

  // Experiments -------------------------------------------------------------
  r.get("/experiments", (_req, res) => {
    res.json(store.list().map(summarizeExperiment));
  });

  r.post(
    "/experiments",
    wrap((req, res) => {
      const { name, config } = parse(CreateSchema, req.body);
      const t = now();
      const original: PromptVersion = { id: newId("ver"), label: "v1 · original", prompt: config.prompt, origin: "original", createdAt: t };
      const fallbackName = (config.taskDescription || config.prompt).replace(/\s+/g, " ").slice(0, 60).trim();
      const exp: Experiment = {
        id: newId("exp"),
        name: name || fallbackName || "Untitled experiment",
        createdAt: t,
        updatedAt: t,
        config: { ...config, constraints: { maxWords: config.constraints.maxWords ?? null, minWords: config.constraints.minWords ?? null, mustInclude: config.constraints.mustInclude, mustNotInclude: config.constraints.mustNotInclude, requiredJsonKeys: config.constraints.requiredJsonKeys } },
        testCases: [],
        versions: [original],
        runs: [],
      };
      store.put(exp);
      res.status(201).json(exp);
    }),
  );

  r.get(
    "/experiments/:id",
    wrap((req, res) => {
      res.json(getExp(req));
    }),
  );

  r.patch(
    "/experiments/:id",
    wrap((req, res) => {
      const e = getExp(req);
      if (busy(e)) throw new HttpError(409, "Wait for the current run to finish before editing.");
      const body = parse(PatchSchema, req.body);
      let notice: string | undefined;
      if (body.name) e.name = body.name;
      if (body.config) {
        const { prompt, constraints, ...rest } = body.config;
        Object.assign(e.config, rest);
        if (constraints) e.config.constraints = { ...e.config.constraints, ...constraints, maxWords: constraints.maxWords ?? null, minWords: constraints.minWords ?? null };
        if (prompt && prompt !== e.config.prompt) {
          const original = e.versions.find((v) => v.origin === "original")!;
          const hasRuns = e.runs.some((x) => x.versionId === original.id);
          if (hasRuns) {
            // Preserve tested history: the edited prompt becomes a new version.
            const v: PromptVersion = { id: newId("ver"), label: nextLabel(e, "manual edit"), prompt, origin: "manual", createdAt: now(), parentVersionId: original.id };
            e.versions.push(v);
            notice = `The original prompt already has test results, so your edit was saved as ${v.label}.`;
          } else {
            original.prompt = prompt;
            e.config.prompt = prompt;
          }
        }
      }
      store.touch(e);
      res.json({ experiment: e, notice });
    }),
  );

  r.delete(
    "/experiments/:id",
    wrap((req, res) => {
      const e = getExp(req);
      for (const run of e.runs) if (run.status === "running") runs.cancel(run.id);
      store.delete(e.id);
      res.status(204).end();
    }),
  );

  r.post(
    "/experiments/:id/duplicate",
    wrap((req, res) => {
      const e = getExp(req);
      const t = now();
      const original = e.versions.find((v) => v.origin === "original")!;
      const copy: Experiment = {
        ...structuredClone(e),
        id: newId("exp"),
        name: `${e.name} (copy)`,
        createdAt: t,
        updatedAt: t,
        versions: [{ ...original, id: newId("ver"), createdAt: t }],
        runs: [],
        draft: undefined,
      };
      store.put(copy);
      res.status(201).json(copy);
    }),
  );

  // Test cases --------------------------------------------------------------
  r.post(
    "/experiments/:id/tests/generate",
    wrap(async (req, res) => {
      const e = getExp(req);
      if (busy(e)) throw new HttpError(409, "Wait for the current run to finish before changing tests.");
      const opts = parse(GenerateSchema, req.body);
      const analyst = generationProvider();
      const existing = opts.replace ? [] : e.testCases.map((t) => t.id);
      let tests: TestCase[];
      try {
        tests = analyst.isDemo ? generateRuleBased(e.config, opts, existing) : await generateWithAnalyst(analyst, e.config, opts, existing);
      } catch (err) {
        throw new HttpError(502, `Test generation failed: ${(err as Error).message}`);
      }
      e.testCases = opts.replace ? tests : [...e.testCases, ...tests];
      e.testGeneration = { mode: analyst.isDemo ? "demo" : "live", method: analyst.isDemo ? "rule-based" : "analyst", providerLabel: analyst.isDemo ? "Rule-based generator" : `${analyst.label} · ${analyst.model}`, at: now() };
      store.touch(e);
      res.json({ experiment: e, generated: tests.length });
    }),
  );

  r.post(
    "/experiments/:id/tests",
    wrap((req, res) => {
      const e = getExp(req);
      if (busy(e)) throw new HttpError(409, "Wait for the current run to finish before changing tests.");
      const body = parse(TestSchema, req.body);
      const test: TestCase = { id: nextTestId(e.testCases.map((t) => t.id)), ...body, source: "manual", createdAt: now() };
      e.testCases.push(test);
      store.touch(e);
      res.status(201).json(e);
    }),
  );

  r.put(
    "/experiments/:id/tests/:testId",
    wrap((req, res) => {
      const e = getExp(req);
      if (busy(e)) throw new HttpError(409, "Wait for the current run to finish before changing tests.");
      const t = e.testCases.find((x) => x.id === req.params.testId);
      if (!t) throw new HttpError(404, "Test case not found.");
      Object.assign(t, parse(TestSchema, req.body), { edited: true });
      store.touch(e);
      res.json(e);
    }),
  );

  r.delete(
    "/experiments/:id/tests/:testId",
    wrap((req, res) => {
      const e = getExp(req);
      if (busy(e)) throw new HttpError(409, "Wait for the current run to finish before changing tests.");
      const before = e.testCases.length;
      e.testCases = e.testCases.filter((x) => x.id !== req.params.testId);
      if (e.testCases.length === before) throw new HttpError(404, "Test case not found.");
      store.touch(e);
      res.json(e);
    }),
  );

  // Runs --------------------------------------------------------------------
  r.post(
    "/experiments/:id/runs",
    wrap((req, res) => {
      const e = getExp(req);
      const { versionId, testIds } = parse(RunSchema, req.body);
      try {
        const run = runs.start(e, versionId, testIds);
        res.status(202).json(run);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }),
  );

  r.get(
    "/experiments/:id/runs/:runId",
    wrap((req, res) => {
      const run = getExp(req).runs.find((x) => x.id === req.params.runId);
      if (!run) throw new HttpError(404, "Run not found.");
      res.json(run);
    }),
  );

  r.post(
    "/experiments/:id/runs/:runId/cancel",
    wrap((req, res) => {
      const run = getExp(req).runs.find((x) => x.id === req.params.runId);
      if (!run) throw new HttpError(404, "Run not found.");
      runs.cancel(run.id);
      res.json({ ok: true });
    }),
  );

  r.delete(
    "/experiments/:id/runs/:runId",
    wrap((req, res) => {
      const e = getExp(req);
      const run = e.runs.find((x) => x.id === req.params.runId);
      if (!run) throw new HttpError(404, "Run not found.");
      if (run.status === "running") throw new HttpError(409, "Cancel the run before deleting it.");
      e.runs = e.runs.filter((x) => x.id !== run.id);
      store.touch(e);
      res.json(e);
    }),
  );

  // Optimisation & versions --------------------------------------------------
  r.post(
    "/experiments/:id/optimize",
    wrap(async (req, res) => {
      const e = getExp(req);
      const { versionId, runId } = parse(OptimizeSchema, req.body);
      const version = e.versions.find((v) => v.id === versionId);
      if (!version) throw new HttpError(404, "Prompt version not found.");
      const run = runId ? e.runs.find((x) => x.id === runId) : e.runs.filter((x) => x.versionId === versionId && x.status === "completed").at(-1);
      const analyst = generationProvider();
      let result;
      try {
        result = analyst.isDemo ? optimizeRuleBased(e.config, version.prompt, run, e.testCases) : await optimizeWithAnalyst(analyst, e.config, version.prompt, run, e.testCases);
      } catch (err) {
        throw new HttpError(502, `Optimisation failed: ${(err as Error).message}`);
      }
      e.draft = { ...result, sourceVersionId: version.id, createdAt: now() };
      store.touch(e);
      res.json(e);
    }),
  );

  r.delete(
    "/experiments/:id/draft",
    wrap((req, res) => {
      const e = getExp(req);
      e.draft = undefined;
      store.touch(e);
      res.json(e);
    }),
  );

  r.post(
    "/experiments/:id/versions",
    wrap((req, res) => {
      const e = getExp(req);
      const body = parse(VersionSchema, req.body);
      const draft = body.fromDraft ? e.draft : undefined;
      const v: PromptVersion = {
        id: newId("ver"),
        label: body.label || nextLabel(e, draft ? "optimised" : "manual edit"),
        prompt: body.prompt,
        origin: draft ? "optimized" : "manual",
        createdAt: now(),
        parentVersionId: draft?.sourceVersionId,
        ...(draft ? { optimization: { improvedPrompt: draft.improvedPrompt, weaknesses: draft.weaknesses, changes: draft.changes, method: draft.method, mode: draft.mode, basedOnRunId: draft.basedOnRunId, providerLabel: draft.providerLabel } } : {}),
      };
      e.versions.push(v);
      if (draft) e.draft = undefined;
      store.touch(e);
      res.status(201).json({ experiment: e, version: v });
    }),
  );

  r.delete(
    "/experiments/:id/versions/:versionId",
    wrap((req, res) => {
      const e = getExp(req);
      const v = e.versions.find((x) => x.id === req.params.versionId);
      if (!v) throw new HttpError(404, "Version not found.");
      if (v.origin === "original") throw new HttpError(400, "The original version cannot be deleted.");
      if (e.runs.some((x) => x.versionId === v.id && x.status === "running")) throw new HttpError(409, "This version has a run in progress.");
      e.versions = e.versions.filter((x) => x.id !== v.id);
      e.runs = e.runs.filter((x) => x.versionId !== v.id);
      store.touch(e);
      res.json(e);
    }),
  );

  // Reports -----------------------------------------------------------------
  r.get(
    "/experiments/:id/report",
    wrap((req, res) => {
      const e = getExp(req);
      const format = String(req.query.format ?? "md");
      const slug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "experiment";
      const date = new Date().toISOString().slice(0, 10);
      const send = (body: string, type: string, ext: string) => {
        res.setHeader("Content-Type", `${type}; charset=utf-8`);
        if (req.query.inline !== "1") res.setHeader("Content-Disposition", `attachment; filename="prompt-crash-lab-${slug}-${date}.${ext}"`);
        res.send(body);
      };
      if (format === "html") return send(reportHtml(e), "text/html", "html");
      if (format === "json") return send(reportJson(e), "application/json", "json");
      if (format === "md") return send(reportMarkdown(e), "text/markdown", "md");
      throw new HttpError(400, "Unknown report format. Use md, html or json.");
    }),
  );

  return r;
}
