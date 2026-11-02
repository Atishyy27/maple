import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Profile, AnswerEntry } from "../types.js";

export const ROOT = process.cwd();

function readYaml<T>(file: string, fallback: T): T {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return fallback;
  const parsed = YAML.parse(fs.readFileSync(p, "utf8"));
  return (parsed ?? fallback) as T;
}

export function loadProfile(file = "profile.yaml"): Profile {
  const p = readYaml<Profile>(file, {} as Profile);
  if (!p.firstName || !p.email) {
    throw new Error(`${file} is missing firstName/email. Run: npm run profile -- cv/<your-cv>.pdf`);
  }
  if (!p.fullName) p.fullName = `${p.firstName} ${p.lastName ?? ""}`.trim();
  // Forms split location into City / State as often as they take it whole.
  // Deriving the parts costs nothing and removes a whole class of misses.
  if (p.location && !p.city) {
    const [city, rest] = p.location.split(",").map((x) => x.trim());
    if (city) p.city = city;
    if (rest && !p.state && !p.country) p.state = rest;
  }
  // any TODO left by the CV importer is treated as absent, not as an answer
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string" && /^TODO\b/.test(v)) delete (p as any)[k];
  }
  return p;
}

export function loadAnswers(file = "answers.yaml"): Record<string, AnswerEntry> {
  const raw = readYaml<Record<string, any>>(file, {});
  const out: Record<string, AnswerEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    const answer = typeof v === "string" ? v : String(v.answer ?? "");
    // Same rule as profile.yaml: an unfilled placeholder is NOT an answer.
    // Without this the literal text "TODO: 3-4 sentences..." goes into a real
    // employer's cover-letter box.
    if (!answer.trim() || /^TODO\b/i.test(answer.trim())) continue;
    const match = typeof v === "string" ? [k.replace(/[_-]+/g, " ")] : v.match ?? [k.replace(/[_-]+/g, " ")];
    out[k] = { match, answer };
  }
  return out;
}

export function loadJobs(file = "jobs.txt"): string[] {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function appendUnanswered(lines: string[]) {
  if (!lines.length) return;
  const p = path.resolve(ROOT, "var/unanswered.log");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, lines.join("\n") + "\n");
}
