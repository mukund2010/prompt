/**
 * Shared domain model for Prompt Crash Lab.
 * Imported by both the server (Node) and the client (React) so the
 * API contract is defined in exactly one place.
 */

export type ExecutionMode = "live" | "demo";

export type ProviderId = "anthropic" | "gemini" | "openai-compatible" | "demo";

export type ProviderRole = "executor" | "analyst";

export const TEST_CATEGORIES = [
  "normal",
  "ambiguous",
  "conflicting",
  "unexpected",
  "invalid",
  "edge",
  "long",
  "instruction",
] as const;
export type TestCategory = (typeof TEST_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TestCategory, string> = {
  normal: "Normal input",
  ambiguous: "Ambiguous instruction",
  conflicting: "Conflicting requirements",
  unexpected: "Unexpected input",
  invalid: "Invalid input",
  edge: "Boundary / edge case",
  long: "Long & complex input",
  instruction: "Instruction-following challenge",
};

/** Short labels for chart axes. */
export const CATEGORY_SHORT: Record<TestCategory, string> = {
  normal: "Normal",
  ambiguous: "Ambiguous",
  conflicting: "Conflict",
  unexpected: "Unexpected",
  invalid: "Invalid",
  edge: "Edge",
  long: "Long",
  instruction: "Injection",
};

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FAILURE_TYPES = [
  "incorrect_response",
  "missing_instruction",
  "format_violation",
  "contradictory_instruction",
  "inconsistent_behavior",
  "unexpected_response",
  "execution_error",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export const FAILURE_TYPE_LABELS: Record<FailureType, string> = {
  incorrect_response: "Incorrect response",
  missing_instruction: "Missing instruction",
  format_violation: "Output format violation",
  contradictory_instruction: "Contradictory instructions",
  inconsistent_behavior: "Inconsistent behaviour",
  unexpected_response: "Unexpected response",
  execution_error: "Execution error",
};

export type OutputFormat = "free" | "json" | "markdown" | "bullets" | "single-line" | "custom";

export interface OutputConstraints {
  maxWords?: number | null;
  minWords?: number | null;
  mustInclude: string[];
  mustNotInclude: string[];
  requiredJsonKeys: string[];
}

export interface ExperimentConfig {
  prompt: string;
  taskDescription: string;
  outputFormat: OutputFormat;
  formatDetails: string;
  constraints: OutputConstraints;
  /** How many times each test is executed (1 = no consistency measurement). */
  consistencyRuns: number;
}

export interface TestCase {
  id: string; // e.g. TC-001
  input: string;
  category: TestCategory;
  expectedBehavior: string;
  rationale: string;
  source: "generated" | "rule-based" | "manual";
  edited?: boolean;
  createdAt: string;
}

export interface PromptVersion {
  id: string;
  label: string;
  prompt: string;
  origin: "original" | "optimized" | "manual";
  createdAt: string;
  /** Present on optimised versions. */
  optimization?: OptimizationResult;
  parentVersionId?: string;
}

export interface Weakness {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  /** The instruction text (or "missing") that causes the weakness. */
  instruction: string;
  fix: string;
  source: "lint" | "analyst" | "failures";
}

export interface OptimizationResult {
  improvedPrompt: string;
  weaknesses: Weakness[];
  changes: string[];
  method: "analyst" | "rule-based";
  mode: ExecutionMode;
  basedOnRunId?: string;
  providerLabel: string;
}

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  failureType?: FailureType;
  severity?: Severity;
}

export interface Failure {
  type: FailureType;
  severity: Severity;
  what: string;
  why: string;
  instruction: string;
  fix: string;
  source: "rule" | "judge";
}

export interface JudgeVerdict {
  passed: boolean;
  score: number; // 0..100
  reasoning: string;
  failures: Failure[];
  method: "analyst" | "heuristic";
}

export type Verdict = "pass" | "fail" | "error";

export interface TestResult {
  testId: string;
  /** Primary output (first execution). */
  output: string;
  /** All outputs when consistencyRuns > 1. */
  outputs: string[];
  error?: string;
  latencyMs: number;
  /** 0..1 pairwise similarity of outputs; null when executed only once. */
  consistency: number | null;
  checks: CheckResult[];
  judge?: JudgeVerdict;
  verdict: Verdict;
  failures: Failure[];
  executedAt: string;
}

export interface RunSummary {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number; // 0..100, over evaluated tests (passed + failed); errors excluded
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, { total: number; passed: number }>;
  byFailureType: Record<string, number>;
  avgLatencyMs: number;
  avgConsistency: number | null;
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Run {
  id: string;
  versionId: string;
  /** "full" = whole test suite (used for comparisons); "partial" = selected tests only. */
  scope: "full" | "partial";
  status: RunStatus;
  mode: ExecutionMode;
  executor: { provider: ProviderId; model: string };
  analyst: { provider: ProviderId; model: string };
  testIds: string[];
  /** Hash of evaluation criteria + test contents at run time. Runs are only fairly comparable when equal. */
  criteriaHash: string;
  results: TestResult[];
  summary: RunSummary;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface Experiment {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  config: ExperimentConfig;
  testCases: TestCase[];
  /** How the current test suite was produced. */
  testGeneration?: { mode: ExecutionMode; method: "analyst" | "rule-based"; providerLabel: string; at: string };
  versions: PromptVersion[];
  runs: Run[];
  /** Unsaved optimiser output awaiting review. */
  draft?: OptimizationResult & { sourceVersionId: string; createdAt: string };
}

export interface ExperimentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  testCount: number;
  versionCount: number;
  runCount: number;
  latestPassRate: number | null;
  originalPassRate: number | null;
  bestPassRate: number | null;
  mode: ExecutionMode | null;
  promptPreview: string;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  model: string;
  isDemo: boolean;
  keySource: "env" | "session" | "none";
  detail: string;
}

export interface ProviderSettings {
  executor: ProviderId;
  analyst: ProviderId;
  /**
   * When true, test generation, judging and prompt optimisation must use the
   * Gemini API key. The analyst is pinned to Gemini, and the server refuses
   * (rather than falling back to rule-based generation) if no key is active.
   */
  geminiOnlyGeneration: boolean;
}

export interface ProvidersResponse {
  providers: ProviderStatus[];
  settings: ProviderSettings;
  mode: ExecutionMode;
}

export interface DashboardStats {
  totalExperiments: number;
  totalTestCases: number;
  totalExecutions: number;
  passedExecutions: number;
  failedExecutions: number;
  averagePassRate: number | null;
  liveRuns: number;
  demoRuns: number;
  recent: Array<{
    experimentId: string;
    experimentName: string;
    runId: string;
    versionLabel: string;
    passRate: number;
    mode: ExecutionMode;
    finishedAt: string;
    total: number;
  }>;
  severityTotals: Record<Severity, number>;
  categoryTotals: Record<string, { total: number; passed: number }>;
  improvements: Array<{ experimentName: string; original: number; improved: number }>;
}
