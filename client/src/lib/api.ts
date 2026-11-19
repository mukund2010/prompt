import type {
  DashboardStats,
  Experiment,
  ExperimentConfig,
  ExperimentSummary,
  PromptVersion,
  ProvidersResponse,
  Run,
  TestCase,
  TestCategory,
} from "../../../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the Prompt Crash Lab server. Is it running (npm run dev)?", 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export type TestInput = Pick<TestCase, "input" | "category" | "expectedBehavior" | "rationale">;

export const api = {
  health: () => request<{ ok: boolean; mode: string }>("GET", "/health"),
  providers: () => request<ProvidersResponse>("GET", "/providers"),
  updateProviders: (body: Record<string, string | boolean>) => request<ProvidersResponse>("PUT", "/providers", body),
  geminiModels: () =>
    request<{ models: Array<{ id: string; displayName: string; inputTokenLimit?: number }>; suggestedPro?: string; current: string }>("GET", "/providers/gemini/models"),
  testProvider: (role: "executor" | "analyst") =>
    request<{ ok: boolean; provider: string; model?: string; latencyMs?: number; reply?: string; error?: string; demo?: boolean }>("POST", "/providers/test", { role }),
  stats: () => request<DashboardStats>("GET", "/stats"),
  list: () => request<ExperimentSummary[]>("GET", "/experiments"),
  get: (id: string) => request<Experiment>("GET", `/experiments/${id}`),
  create: (name: string | undefined, config: ExperimentConfig) => request<Experiment>("POST", "/experiments", { name, config }),
  update: (id: string, body: { name?: string; config?: Partial<ExperimentConfig> }) =>
    request<{ experiment: Experiment; notice?: string }>("PATCH", `/experiments/${id}`, body),
  remove: (id: string) => request<void>("DELETE", `/experiments/${id}`),
  duplicate: (id: string) => request<Experiment>("POST", `/experiments/${id}/duplicate`),
  generateTests: (id: string, body: { count: number; categories: TestCategory[]; replace: boolean }) =>
    request<{ experiment: Experiment; generated: number }>("POST", `/experiments/${id}/tests/generate`, body),
  addTest: (id: string, t: TestInput) => request<Experiment>("POST", `/experiments/${id}/tests`, t),
  updateTest: (id: string, testId: string, t: TestInput) => request<Experiment>("PUT", `/experiments/${id}/tests/${testId}`, t),
  deleteTest: (id: string, testId: string) => request<Experiment>("DELETE", `/experiments/${id}/tests/${testId}`),
  startRun: (id: string, versionId: string, testIds?: string[]) => request<Run>("POST", `/experiments/${id}/runs`, { versionId, testIds }),
  getRun: (id: string, runId: string) => request<Run>("GET", `/experiments/${id}/runs/${runId}`),
  cancelRun: (id: string, runId: string) => request<{ ok: boolean }>("POST", `/experiments/${id}/runs/${runId}/cancel`),
  deleteRun: (id: string, runId: string) => request<Experiment>("DELETE", `/experiments/${id}/runs/${runId}`),
  optimize: (id: string, versionId: string, runId?: string) => request<Experiment>("POST", `/experiments/${id}/optimize`, { versionId, runId }),
  discardDraft: (id: string) => request<Experiment>("DELETE", `/experiments/${id}/draft`),
  saveVersion: (id: string, body: { prompt: string; label?: string; fromDraft?: boolean }) =>
    request<{ experiment: Experiment; version: PromptVersion }>("POST", `/experiments/${id}/versions`, body),
  deleteVersion: (id: string, versionId: string) => request<Experiment>("DELETE", `/experiments/${id}/versions/${versionId}`),
  reportUrl: (id: string, format: "md" | "html" | "json", inline = false) => `/api/experiments/${id}/report?format=${format}${inline ? "&inline=1" : ""}`,
};
