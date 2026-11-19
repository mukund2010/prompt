/** Run summaries, consistency scoring and before/after comparison. */
import type { Run, RunSummary, Severity, TestCase, TestResult } from "./types";

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

/** Jaccard similarity of token sets, 0..1. Two empty strings are identical. */
export function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Mean pairwise similarity of several outputs; null if fewer than two. */
export function consistencyScore(outputs: string[]): number | null {
  if (outputs.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < outputs.length; i++)
    for (let j = i + 1; j < outputs.length; j++) {
      sum += jaccard(outputs[i], outputs[j]);
      n++;
    }
  return n ? sum / n : null;
}

export function emptySummary(total: number): RunSummary {
  return {
    total,
    completed: 0,
    passed: 0,
    failed: 0,
    errored: 0,
    passRate: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    byCategory: {},
    byFailureType: {},
    avgLatencyMs: 0,
    avgConsistency: null,
  };
}

export function summarize(results: TestResult[], tests: TestCase[], total: number): RunSummary {
  const s = emptySummary(total);
  const byId = new Map(tests.map((t) => [t.id, t]));
  let latency = 0;
  const cons: number[] = [];
  for (const r of results) {
    s.completed++;
    if (r.verdict === "pass") s.passed++;
    else if (r.verdict === "fail") s.failed++;
    else s.errored++;
    latency += r.latencyMs;
    if (r.consistency !== null) cons.push(r.consistency);
    for (const f of r.failures) {
      s.bySeverity[f.severity]++;
      s.byFailureType[f.type] = (s.byFailureType[f.type] ?? 0) + 1;
    }
    const cat = byId.get(r.testId)?.category ?? "unknown";
    s.byCategory[cat] ??= { total: 0, passed: 0 };
    s.byCategory[cat].total++;
    if (r.verdict === "pass") s.byCategory[cat].passed++;
  }
  // Pass rate is computed over evaluated tests only; execution errors are reported separately, never counted as model failures.
  const evaluated = s.passed + s.failed;
  s.passRate = evaluated ? round1((s.passed / evaluated) * 100) : 0;
  s.avgLatencyMs = s.completed ? Math.round(latency / s.completed) : 0;
  s.avgConsistency = cons.length ? round1((cons.reduce((a, b) => a + b, 0) / cons.length) * 100) : null;
  return s;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Highest severity across failures of a result, or null. */
export function topSeverity(r: TestResult): Severity | null {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  for (const s of order) if (r.failures.some((f) => f.severity === s)) return s;
  return null;
}

export interface TestDiff {
  testId: string;
  before: TestResult | null;
  after: TestResult | null;
  change: "fixed" | "regressed" | "still-passing" | "still-failing" | "not-compared";
}

export interface Comparison {
  baseline: RunSummary;
  candidate: RunSummary;
  passRateDelta: number; // percentage points
  relativeImprovement: number | null; // % change in pass rate relative to baseline
  failureReduction: number; // count of failures removed (can be negative)
  fixed: number;
  regressed: number;
  stillFailing: number;
  stillPassing: number;
  comparable: boolean; // same tests, same mode, same evaluation criteria
  sharedTestCount: number;
  diffs: TestDiff[];
  consistencyDelta: number | null;
}

export function compareRuns(baseline: Run, candidate: Run): Comparison {
  const bMap = new Map(baseline.results.map((r) => [r.testId, r]));
  const cMap = new Map(candidate.results.map((r) => [r.testId, r]));
  const ids = Array.from(new Set([...baseline.testIds, ...candidate.testIds]));
  const diffs: TestDiff[] = ids.map((id) => {
    const before = bMap.get(id) ?? null;
    const after = cMap.get(id) ?? null;
    let change: TestDiff["change"] = "not-compared";
    if (before && after) {
      const bp = before.verdict === "pass";
      const ap = after.verdict === "pass";
      change = bp && ap ? "still-passing" : !bp && ap ? "fixed" : bp && !ap ? "regressed" : "still-failing";
    }
    return { testId: id, before, after, change };
  });
  const count = (c: TestDiff["change"]) => diffs.filter((d) => d.change === c).length;
  const shared = diffs.filter((d) => d.change !== "not-compared").length;
  const bFails = baseline.results.reduce((n, r) => n + r.failures.length, 0);
  const cFails = candidate.results.reduce((n, r) => n + r.failures.length, 0);
  const delta = round1(candidate.summary.passRate - baseline.summary.passRate);
  return {
    baseline: baseline.summary,
    candidate: candidate.summary,
    passRateDelta: delta,
    relativeImprovement: baseline.summary.passRate > 0 ? round1((delta / baseline.summary.passRate) * 100) : null,
    failureReduction: bFails - cFails,
    fixed: count("fixed"),
    regressed: count("regressed"),
    stillFailing: count("still-failing"),
    stillPassing: count("still-passing"),
    comparable: shared === ids.length && baseline.mode === candidate.mode && baseline.criteriaHash === candidate.criteriaHash,
    sharedTestCount: shared,
    diffs,
    consistencyDelta:
      baseline.summary.avgConsistency !== null && candidate.summary.avgConsistency !== null
        ? round1(candidate.summary.avgConsistency - baseline.summary.avgConsistency)
        : null,
  };
}
