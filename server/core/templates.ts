import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = fileURLToPath(new URL("../../prompts/final/", import.meta.url));
const cache = new Map<string, string>();

/** Loads prompts/final/<name>.md (front matter stripped). Cached after first read. */
export function loadTemplate(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const raw = fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
  const body = raw.replace(/^---[\s\S]*?\n---\s*\n/, "").trim();
  cache.set(name, body);
  return body;
}

/**
 * Single-pass {{placeholder}} substitution. Values are inserted verbatim and
 * never re-scanned, so user text containing "{{input}}" is safe. Unknown
 * placeholders are left untouched.
 */
export function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}
