import type { Experiment, PromptVersion, Run } from "./types";

export function latestFullRun(exp: Experiment, versionId: string | undefined): Run | undefined {
  if (!versionId) return undefined;
  return exp.runs.filter((r) => r.versionId === versionId && r.scope === "full" && r.status === "completed").at(-1);
}

export function originalVersion(exp: Experiment): PromptVersion | undefined {
  return exp.versions.find((v) => v.origin === "original") ?? exp.versions[0];
}

/** Most recent non-original version, if any. */
export function latestImprovedVersion(exp: Experiment): PromptVersion | undefined {
  return exp.versions.filter((v) => v.origin !== "original").at(-1);
}

/** Default before/after pair: original vs latest improved version that has a full run. */
export function defaultComparison(exp: Experiment): { baseline?: Run; candidate?: Run; baselineVersion?: PromptVersion; candidateVersion?: PromptVersion } {
  const baselineVersion = originalVersion(exp);
  const baseline = latestFullRun(exp, baselineVersion?.id);
  const improved = exp.versions
    .filter((v) => v.origin !== "original")
    .reverse()
    .find((v) => latestFullRun(exp, v.id));
  return { baseline, baselineVersion, candidate: latestFullRun(exp, improved?.id), candidateVersion: improved };
}

export function versionLabel(exp: Experiment, versionId: string): string {
  return exp.versions.find((v) => v.id === versionId)?.label ?? "Unknown version";
}
