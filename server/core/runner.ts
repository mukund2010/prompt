/**
 * Run engine: executes a prompt version against test cases, evaluates every
 * output (deterministic checks + judge), and records progress as it goes so
 * the client can poll for live status.
 */
import { failuresFromChecks, runDeterministicChecks } from "../../shared/checks";
import { consistencyScore, emptySummary, summarize } from "../../shared/metrics";
import type { CheckResult, Experiment, ExperimentConfig, Failure, JudgeVerdict, Run, TestCase, TestResult } from "../../shared/types";
import type { ProviderRegistry } from "../providers/registry";
import type { LLMProvider } from "../providers/types";
import { ProviderError } from "../providers/types";
import type { ExperimentStore } from "../store/experimentStore";
import { buildExecutionMessages } from "./describe";
import { createHash } from "node:crypto";
import { newId, now } from "./ids";
import { judgeHeuristically, judgeWithAnalyst } from "./judge";

/** Below this mean pairwise token similarity, repeated outputs count as inconsistent. */
export const CONSISTENCY_THRESHOLD = 0.4;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProviderError && e.retryable) {
      await new Promise((r) => setTimeout(r, 2000));
      return fn();
    }
    throw e;
  }
}

export async function evaluateTest(
  executor: LLMProvider,
  analyst: LLMProvider,
  config: ExperimentConfig,
  prompt: string,
  test: TestCase,
): Promise<TestResult> {
  const started = Date.now();
  const outputs: string[] = [];
  const msgs = buildExecutionMessages(prompt, test.input);
  const repeats = Math.min(Math.max(config.consistencyRuns || 1, 1), 5);
  try {
    for (let i = 0; i < repeats; i++) {
      const res = await withRetry(() => executor.complete({ ...msgs, purpose: "execute" }));
      outputs.push(res.stopReason === "refusal" ? `[The model declined to respond] ${res.text}`.trim() : res.text);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      testId: test.id,
      output: outputs[0] ?? "",
      outputs,
      error: message,
      latencyMs: Date.now() - started,
      consistency: null,
      checks: [],
      verdict: "error",
      failures: [{ type: "execution_error", severity: "high", what: `Execution failed: ${message}`, why: "The provider call did not complete, so this test could not be evaluated.", instruction: "n/a", fix: "Check provider configuration and connectivity, then re-run this test.", source: "rule" }],
      executedAt: now(),
    };
  }
  const execLatency = Math.round((Date.now() - started) / repeats);
  const output = outputs[0];
  const checks: CheckResult[] = runDeterministicChecks(output, config);
  const consistency = consistencyScore(outputs);

  let judge: JudgeVerdict;
  try {
    judge = analyst.isDemo ? judgeHeuristically(test, output, checks) : await withRetry(() => judgeWithAnalyst(analyst, config, prompt, test, output, checks));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      testId: test.id,
      output,
      outputs,
      error: `Evaluation failed: ${message}`,
      latencyMs: execLatency,
      consistency,
      checks,
      verdict: "error",
      failures: [{ type: "execution_error", severity: "medium", what: `The judge could not evaluate this output: ${message}`, why: "The analyst model call failed, so no pass/fail verdict was recorded.", instruction: "n/a", fix: "Re-run the test once the analyst provider is available.", source: "rule" }],
      executedAt: now(),
    };
  }

  const failures: Failure[] = [...failuresFromChecks(checks, config), ...judge.failures];
  if (consistency !== null && consistency < CONSISTENCY_THRESHOLD)
    failures.push({
      type: "inconsistent_behavior",
      severity: "medium",
      what: `Repeated executions disagreed (similarity ${(consistency * 100).toFixed(0)}% across ${repeats} runs).`,
      why: "Loose or underspecified instructions let the model choose a different approach on each run.",
      instruction: "Output format / task definition",
      fix: "Specify structure, length and decision rules precisely so there is one obviously correct way to answer.",
      source: "rule",
    });

  return {
    testId: test.id,
    output,
    outputs,
    latencyMs: execLatency,
    consistency,
    checks,
    judge,
    verdict: failures.length === 0 && judge.passed ? "pass" : "fail",
    failures,
    executedAt: now(),
  };
}

export function criteriaHash(exp: Experiment, testIds: string[]): string {
  const c = exp.config;
  const tests = testIds.map((id) => exp.testCases.find((t) => t.id === id)).map((t) => t && [t.id, t.input, t.expectedBehavior, t.category]);
  return createHash("sha256").update(JSON.stringify([c.outputFormat, c.formatDetails, c.constraints, c.consistencyRuns, tests])).digest("hex").slice(0, 16);
}

export class RunManager {
  private cancelled = new Set<string>();

  constructor(
    private store: ExperimentStore,
    private registry: ProviderRegistry,
  ) {}

  /** Creates the run record and starts execution in the background. */
  start(exp: Experiment, versionId: string, testIds?: string[]): Run {
    const version = exp.versions.find((v) => v.id === versionId);
    if (!version) throw new Error("Prompt version not found.");
    if (!exp.testCases.length) throw new Error("This experiment has no test cases yet. Generate or add tests first.");
    if (exp.runs.some((r) => r.status === "running" || r.status === "queued")) throw new Error("A run is already in progress for this experiment. Wait for it to finish or cancel it.");
    const ids = testIds?.length ? testIds.filter((id) => exp.testCases.some((t) => t.id === id)) : exp.testCases.map((t) => t.id);
    if (!ids.length) throw new Error("None of the requested tests exist.");

    const executor = this.registry.forRole("executor");
    const analyst = this.registry.forRole("analyst");
    const run: Run = {
      id: newId("run"),
      versionId,
      scope: ids.length === exp.testCases.length ? "full" : "partial",
      status: "running",
      mode: executor.isDemo ? "demo" : "live",
      executor: { provider: executor.id, model: executor.model },
      analyst: { provider: analyst.id, model: analyst.model },
      testIds: ids,
      criteriaHash: criteriaHash(exp, ids),
      results: [],
      summary: emptySummary(ids.length),
      startedAt: now(),
    };
    exp.runs.push(run);
    this.store.touch(exp);
    void this.execute(exp, run, version.prompt, executor, analyst);
    return run;
  }

  cancel(runId: string) {
    this.cancelled.add(runId);
  }

  private async execute(exp: Experiment, run: Run, prompt: string, executor: LLMProvider, analyst: LLMProvider) {
    const queue = run.testIds.map((id) => exp.testCases.find((t) => t.id === id)).filter((t): t is TestCase => Boolean(t));
    const tests = [...queue];
    const concurrency = executor.isDemo ? 4 : 3;
    // Snapshot the config so edits made during a run do not change its evaluation criteria.
    const config: ExperimentConfig = structuredClone(exp.config);
    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          while (queue.length) {
            if (this.cancelled.has(run.id)) return;
            const test = queue.shift()!;
            const result = await evaluateTest(executor, analyst, config, prompt, test);
            run.results.push(result);
            run.summary = summarize(run.results, tests, run.testIds.length);
            this.store.touch(exp, false);
          }
        }),
      );
      // Keep results in test order for stable display.
      const order = new Map(run.testIds.map((id, i) => [id, i]));
      run.results.sort((a, b) => (order.get(a.testId) ?? 0) - (order.get(b.testId) ?? 0));
      run.status = this.cancelled.has(run.id) ? "cancelled" : "completed";
      if (run.status === "cancelled") run.scope = "partial";
      if (run.results.length && run.results.every((x) => x.verdict === "error")) {
        run.status = "failed";
        run.error = `Every test failed to execute or evaluate. First error: ${run.results[0].error ?? "unknown"}`;
      }
    } catch (e) {
      run.status = "failed";
      run.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.cancelled.delete(run.id);
      run.finishedAt = now();
      run.summary = summarize(run.results, tests, run.testIds.length);
      this.store.touch(exp);
    }
  }
}
