import { randomUUID } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
export const now = () => new Date().toISOString();

export function nextTestId(existing: string[]): string {
  const max = existing.reduce((m, id) => {
    const n = Number(id.replace(/^TC-/, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `TC-${String(max + 1).padStart(3, "0")}`;
}
