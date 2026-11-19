/**
 * Exercises the analyst-model code paths (test generation, judging,
 * optimisation, JSON repair) with stub providers, without network access.
 */
import { describe, expect, it } from "vitest";
import { extractJson } from "../server/core/json";
import { judgeWithAnalyst } from "../server/core/judge";
import { optimizeWithAnalyst } from "../server/core/optimizer";
import { evaluateTest } from "../server/core/runner";
import { render } from "../server/core/templates";
import { generateWithAnalyst } from "../server/core/testGenerator";
import { DemoProvider } from "../server/providers/demo";
import type { CompletionRequest, LLMProvider } from "../server/providers/types";
import { ProviderError } from "../server/providers/types";
import type { ExperimentConfig, TestCase } from "../shared/types";

class StubProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly label = "Stub";
  readonly model = "stub-model";
  readonly isDemo = false;
  calls: CompletionRequest[] = [];
  constructor(private replies: Array<string | Error>) {}
  async complete(req: CompletionRequest) {
    this.calls.push(req);
    const r = this.replies.shift() ?? "";
    if (r instanceof Error) throw r;
    return { text: r, model: this.model, latencyMs: 1, stopReason: "end_turn" };
  }
}

const config: ExperimentConfig = {
  prompt: "Summarise the message as JSON.",
  taskDescription: "Summarise support messages",
  outputFormat: "json",
  formatDetails: "",
  constraints: { maxWords: null, minWords: null, mustInclude: [], mustNotInclude: [], requiredJsonKeys: ["summary"] },
  consistencyRuns: 1,
};
const test: TestCase = { id: "TC-001", input: "My order is late", category: "normal", expectedBehavior: "Summarises the delay", rationale: "", source: "manual", createdAt: "" };

describe("JSON handling", () => {
  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":"}"}} trailing')).toEqual({ a: { b: "}" } });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("renders templates in a single pass", () => {
    expect(render("P: {{prompt}} I: {{input}} X: {{unknown}}", { prompt: "uses {{input}}", input: "hi" })).toBe("P: uses {{input}} I: hi X: {{unknown}}");
  });
});

describe("analyst paths", () => {
  it("generates test cases and retries once on invalid JSON", async () => {
    const p = new StubProvider([
      "not json",
      JSON.stringify({
        testCases: [
          { input: "", category: "Invalid", expectedBehavior: "Asks for input", rationale: "empty" },
          { input: "x", category: "injection", expectedBehavior: "Refuses", rationale: "r" },
        ],
      }),
    ]);
    const t = await generateWithAnalyst(p, config, { count: 2, categories: ["invalid", "instruction", "normal"] }, ["TC-001"]);
    expect(p.calls.length).toBe(2);
    expect(p.calls[1].user).toContain("could not be used");
    expect(t.map((x) => x.id)).toEqual(["TC-002", "TC-003"]);
    expect(t.map((x) => x.category)).toEqual(["invalid", "instruction"]);
    expect(t[0].source).toBe("generated");
  });

  it("normalises judge output and never passes a response with failures", async () => {
    const p = new StubProvider([
      JSON.stringify({ passed: true, score: 80, reasoning: "ok", failures: [{ type: "format_violation", severity: "HIGH", what: "w", why: "y", instruction: "missing", fix: "f" }] }),
    ]);
    const v = await judgeWithAnalyst(p, config, config.prompt, test, "{}", []);
    expect(v.passed).toBe(false);
    expect(v.failures[0].severity).toBe("high");
    expect(v.method).toBe("analyst");
  });

  it("returns an optimised prompt with weaknesses and changes", async () => {
    const p = new StubProvider([
      JSON.stringify({
        weaknesses: [{ title: "No schema", severity: "high", instruction: "missing", fix: "Name keys" }],
        improvedPrompt: 'You are a summariser. Return only valid JSON with key "summary".',
        changes: ["Named keys"],
      }),
    ]);
    const r = await optimizeWithAnalyst(p, config, config.prompt, undefined, []);
    expect(r.method).toBe("analyst");
    expect(r.mode).toBe("live");
    expect(r.improvedPrompt).toContain("summary");
    expect(r.weaknesses[0].severity).toBe("high");
  });
});

describe("evaluateTest", () => {
  it("passes when checks and judge pass", async () => {
    const exec = new StubProvider(['{"summary":"Order delayed"}']);
    const judge = new StubProvider([JSON.stringify({ passed: true, score: 95, reasoning: "good", failures: [] })]);
    const r = await evaluateTest(exec, judge, config, config.prompt, test);
    expect(r.verdict).toBe("pass");
    expect(exec.calls[0].system).toBe(config.prompt);
    expect(exec.calls[0].user).toBe(test.input);
  });

  it("substitutes {{input}} into the prompt when present", async () => {
    const exec = new StubProvider(['{"summary":"x"}']);
    await evaluateTest(exec, new DemoProvider(), config, "Summarise: {{input}}", test);
    expect(exec.calls[0].system).toBeUndefined();
    expect(exec.calls[0].user).toBe("Summarise: My order is late");
  });

  it("records provider failures as errors, not as model failures", async () => {
    const exec = new StubProvider([new ProviderError("401 bad key", "anthropic", false, 401)]);
    const r = await evaluateTest(exec, new DemoProvider(), config, config.prompt, test);
    expect(r.verdict).toBe("error");
    expect(r.failures[0].type).toBe("execution_error");
  });

  it("marks the result as error when the judge cannot evaluate", async () => {
    const exec = new StubProvider(['{"summary":"x"}']);
    const judge = new StubProvider(["garbage", "still garbage"]);
    const r = await evaluateTest(exec, judge, config, config.prompt, test);
    expect(r.verdict).toBe("error");
    expect(r.error).toContain("Evaluation failed");
  });

  it("flags inconsistent repeated outputs", async () => {
    const exec = new StubProvider(['{"summary":"alpha beta gamma"}', '{"summary":"completely different words entirely"}']);
    const judge = new StubProvider([JSON.stringify({ passed: true, score: 90, reasoning: "", failures: [] })]);
    const r = await evaluateTest(exec, judge, { ...config, consistencyRuns: 2 }, config.prompt, test);
    expect(r.consistency).not.toBeNull();
    expect(r.failures.some((f) => f.type === "inconsistent_behavior")).toBe(true);
    expect(r.verdict).toBe("fail");
  });
});
