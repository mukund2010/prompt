/**
 * End-to-end API test of the full lifecycle in demo mode:
 * SUBMIT → GENERATE TESTS → EXECUTE → DETECT FAILURES → OPTIMISE → RETEST → COMPARE → REPORT.
 * Uses a temporary data directory and a real HTTP server on an ephemeral port.
 */
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { compareRuns } from "../shared/metrics";
import type { Experiment, Run } from "../shared/types";

let server: Server;
let base = "";
let dir = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcl-test-"));
  process.env.DEFAULT_EXECUTOR = "demo";
  process.env.DEFAULT_ANALYST = "demo";
  const { app } = createApp({ dataFile: path.join(dir, "experiments.json"), settingsFile: path.join(dir, "settings.json") });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(base + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: (text ? (res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) : undefined) as T };
}

async function waitForRun(expId: string, runId: string): Promise<Run> {
  for (let i = 0; i < 200; i++) {
    const { data } = await call<Run>("GET", `/experiments/${expId}/runs/${runId}`);
    if (data.status !== "running" && data.status !== "queued") return data;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Run did not finish in time");
}

describe("Prompt Crash Lab API workflow (demo mode)", () => {
  let exp: Experiment;
  let baseline: Run;
  let candidate: Run;

  it("reports health and demo mode", async () => {
    const { data } = await call<{ ok: boolean; mode: string }>("GET", "/health");
    expect(data).toMatchObject({ ok: true, mode: "demo" });
  });

  it("validates input", async () => {
    const r = await call<{ error: string }>("POST", "/experiments", { config: { prompt: "short" } });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/at least 10/);
    expect((await call("GET", "/experiments/nope")).status).toBe(404);
    expect((await call("GET", "/nope")).status).toBe(404);
  });

  it("creates an experiment (SUBMIT)", async () => {
    const r = await call<Experiment>("POST", "/experiments", {
      name: "Triage test",
      config: {
        prompt: "Read the customer message and summarise it. Be detailed but keep it short. Use JSON.",
        taskDescription: "Triage support messages",
        outputFormat: "json",
        constraints: { maxWords: 80, requiredJsonKeys: ["summary", "urgency"], mustInclude: [], mustNotInclude: [] },
      },
    });
    expect(r.status).toBe(201);
    exp = r.data;
    expect(exp.versions).toHaveLength(1);
    expect(exp.versions[0].origin).toBe("original");
  });

  it("refuses to run without tests", async () => {
    const r = await call<{ error: string }>("POST", `/experiments/${exp.id}/runs`, { versionId: exp.versions[0].id });
    expect(r.status).toBe(400);
  });

  it("generates categorised test cases (GENERATE TESTS)", async () => {
    const r = await call<{ experiment: Experiment; generated: number }>("POST", `/experiments/${exp.id}/tests/generate`, { count: 16 });
    expect(r.status).toBe(200);
    expect(r.data.generated).toBe(16);
    exp = r.data.experiment;
    expect(new Set(exp.testCases.map((t) => t.category)).size).toBe(8);
    for (const t of exp.testCases) {
      expect(t.id).toMatch(/^TC-\d{3}$/);
      expect(t.expectedBehavior.length).toBeGreaterThan(5);
      expect(t.rationale.length).toBeGreaterThan(5);
    }
    expect(exp.testGeneration?.mode).toBe("demo");
  });

  it("supports manual test CRUD", async () => {
    const add = await call<Experiment>("POST", `/experiments/${exp.id}/tests`, { input: "Where is my refund?", category: "normal", expectedBehavior: "Summarises the refund query", rationale: "manual" });
    expect(add.status).toBe(201);
    const added = add.data.testCases.at(-1)!;
    expect(added.id).toBe("TC-017");
    const upd = await call<Experiment>("PUT", `/experiments/${exp.id}/tests/${added.id}`, { input: "Where is my refund??", category: "edge", expectedBehavior: "Still summarises", rationale: "" });
    expect(upd.data.testCases.at(-1)).toMatchObject({ category: "edge", edited: true });
    const del = await call<Experiment>("DELETE", `/experiments/${exp.id}/tests/${added.id}`);
    expect(del.data.testCases).toHaveLength(16);
    expect((await call("POST", `/experiments/${exp.id}/tests`, { input: "x", category: "bogus", expectedBehavior: "abc" })).status).toBe(400);
  });

  it("executes and evaluates every test (EXECUTE + DETECT FAILURES)", async () => {
    const start = await call<Run>("POST", `/experiments/${exp.id}/runs`, { versionId: exp.versions[0].id });
    expect(start.status).toBe(202);
    expect((await call("POST", `/experiments/${exp.id}/runs`, { versionId: exp.versions[0].id })).status).toBe(400); // already running
    baseline = await waitForRun(exp.id, start.data.id);
    expect(baseline.status).toBe("completed");
    expect(baseline.mode).toBe("demo");
    expect(baseline.scope).toBe("full");
    expect(baseline.results).toHaveLength(16);
    expect(baseline.summary.failed).toBeGreaterThan(0);
    for (const r of baseline.results) {
      expect(r.checks.length).toBeGreaterThan(0);
      expect(r.judge?.method).toBe("heuristic");
      if (r.verdict === "fail") {
        expect(r.failures.length).toBeGreaterThan(0);
        for (const f of r.failures) expect(Boolean(f.what && f.why && f.instruction && f.fix)).toBe(true);
      } else expect(r.failures).toHaveLength(0);
    }
  });

  it("runs a single test as a partial run", async () => {
    const start = await call<Run>("POST", `/experiments/${exp.id}/runs`, { versionId: exp.versions[0].id, testIds: ["TC-001"] });
    const run = await waitForRun(exp.id, start.data.id);
    expect(run.scope).toBe("partial");
    expect(run.results).toHaveLength(1);
  });

  it("optimises the prompt and saves a new version (OPTIMISE)", async () => {
    const opt = await call<Experiment>("POST", `/experiments/${exp.id}/optimize`, { versionId: exp.versions[0].id, runId: baseline.id });
    expect(opt.status).toBe(200);
    const draft = opt.data.draft!;
    expect(draft.method).toBe("rule-based");
    expect(draft.mode).toBe("demo");
    expect(draft.improvedPrompt).toContain("Read the customer message"); // original intent preserved
    expect(draft.improvedPrompt).toContain('"urgency"');
    expect(draft.weaknesses.length).toBeGreaterThan(0);
    const saved = await call<{ experiment: Experiment; version: { id: string; origin: string; label: string } }>("POST", `/experiments/${exp.id}/versions`, { prompt: draft.improvedPrompt, fromDraft: true });
    expect(saved.status).toBe(201);
    expect(saved.data.version.origin).toBe("optimized");
    expect(saved.data.experiment.draft).toBeUndefined();
    exp = saved.data.experiment;
  });

  it("retests on the identical suite and improves (RETEST + COMPARE)", async () => {
    const v2 = exp.versions[1];
    const start = await call<Run>("POST", `/experiments/${exp.id}/runs`, { versionId: v2.id });
    candidate = await waitForRun(exp.id, start.data.id);
    expect(candidate.testIds).toEqual(baseline.testIds);
    expect(candidate.criteriaHash).toBe(baseline.criteriaHash);
    const cmp = compareRuns(baseline, candidate);
    expect(cmp.comparable).toBe(true);
    expect(candidate.summary.passRate).toBeGreaterThan(baseline.summary.passRate);
    expect(cmp.fixed).toBeGreaterThan(0);
  });

  it("keeps edited prompts as new versions once tested", async () => {
    const r = await call<{ experiment: Experiment; notice?: string }>("PATCH", `/experiments/${exp.id}`, { config: { prompt: "A manually edited prompt that is long enough." } });
    expect(r.data.notice).toMatch(/saved as v3/);
    expect(r.data.experiment.versions[0].prompt).toContain("Read the customer message");
    exp = r.data.experiment;
  });

  it("generates downloadable reports (REPORT)", async () => {
    const md = await fetch(`${base}/experiments/${exp.id}/report?format=md`);
    expect(md.headers.get("content-disposition")).toMatch(/attachment; filename="prompt-crash-lab-triage-test-/);
    const mdText = await md.text();
    for (const s of ["## Original prompt", "## Improved prompt", "## Test cases", "Actual output", "What went wrong", "## Improvement recommendations", "Demonstration data"]) expect(mdText).toContain(s);
    const html = await (await fetch(`${base}/experiments/${exp.id}/report?format=html`)).text();
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/<script/i);
    const json = await (await fetch(`${base}/experiments/${exp.id}/report?format=json`)).json();
    expect(json.demonstrationData).toBe(true);
    expect(json.comparison.fixed).toBeGreaterThan(0);
    expect((await call("GET", `/experiments/${exp.id}/report?format=pdf`)).status).toBe(400);
  });

  it("aggregates dashboard stats and history", async () => {
    const stats = await call<{ totalExperiments: number; totalTestCases: number; demoRuns: number; improvements: unknown[] }>("GET", "/stats");
    expect(stats.data.totalExperiments).toBe(1);
    expect(stats.data.totalTestCases).toBe(16);
    expect(stats.data.demoRuns).toBe(3);
    expect(stats.data.improvements).toHaveLength(1);
    const list = await call<Array<{ id: string; originalPassRate: number; bestPassRate: number }>>("GET", "/experiments");
    expect(list.data[0].bestPassRate).toBeGreaterThan(list.data[0].originalPassRate);
  });

  it("refuses to configure an unconfigured provider", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await call<{ error: string }>("PUT", "/providers", { executor: "anthropic" });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/not configured/);
    const p = await call<{ settings: { executor: string } }>("GET", "/providers");
    expect(p.data.settings.executor).toBe("demo");
  });

  it("persists experiments to disk and deletes them", async () => {
    await new Promise((r) => setTimeout(r, 300));
    const disk = JSON.parse(fs.readFileSync(path.join(dir, "experiments.json"), "utf8"));
    expect(disk.experiments[0].runs.length).toBe(3);
    expect(JSON.stringify(disk)).not.toMatch(/sk-ant-/);
    const dup = await call<Experiment>("POST", `/experiments/${exp.id}/duplicate`);
    expect(dup.data.runs).toHaveLength(0);
    expect(dup.data.testCases).toHaveLength(16);
    expect((await call("DELETE", `/experiments/${dup.data.id}`)).status).toBe(204);
    expect((await call("GET", `/experiments/${dup.data.id}`)).status).toBe(404);
  });
});
