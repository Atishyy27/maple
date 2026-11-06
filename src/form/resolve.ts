import type { Field, Option, Profile, Resolved, AnswerEntry } from "../types.js";
import { PROFILE_ALIASES, BOOLEAN_DEFAULTS } from "./aliases.js";

const STOP = new Set([
  "the","a","an","of","to","for","your","you","please","enter","provide","is","are","do","does",
  "will","this","that","in","on","at","and","or","if","any","us","we","our","my","i","with","it",
  "what","which","field","required","optional","select","choose","type","value","question",
]);

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    // drop apostrophes BEFORE splitting, so "Bachelor's Degree" tokenises as
    // [bachelors, degree] and matches a profile value of "Bachelors".
    // Splitting on them instead yields [bachelor, s, degree], which matches
    // nothing.
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toks = (s: string): string[] => norm(s).split(" ").filter((t) => t && !STOP.has(t));

/**
 * How well `alias` describes `label`, 0..1.
 *
 * The important term is `extra`: every label token the alias fails to account
 * for costs 0.15. That is what stops the alias "name" from claiming the label
 * "Last Name" -- it covers the alias fully but leaves "last" unexplained.
 */
export function score(alias: string, label: string): number {
  const a = norm(alias), l = norm(label);
  if (!a || !l) return 0;
  if (a === l) return 1;

  const at = toks(a), lt = toks(l);
  if (at.length === 0 || lt.length === 0) return 0;

  const hit = at.filter((t) => lt.includes(t)).length;
  const cover = hit / at.length;

  if (cover === 1) {
    const extra = lt.filter((t) => !at.includes(t)).length;
    return Math.max(0.5, 0.97 - Math.min(0.45, extra * 0.15));
  }
  const union = new Set([...at, ...lt]).size;
  return cover * 0.6 + (hit / union) * 0.4;
}

/**
 * A distinctive multi-word phrase appearing verbatim inside a long label is a
 * match, even though the label has a dozen tokens the phrase never explains.
 * "information provided is accurate" sits inside a 20-word consent paragraph;
 * the per-token penalty alone scores that 0.52 and drops it.
 *
 * Three tokens minimum, so short greedy aliases cannot use this path.
 */
function phraseHit(alias: string, label: string): boolean {
  const a = norm(alias);
  if (a.length < 12 || a.split(" ").length < 3) return false;
  return norm(label).includes(a);
}

const best = (aliases: string[], label: string): number =>
  aliases.reduce((m, a) => Math.max(m, phraseHit(a, label) ? 0.8 : 0, score(a, label)), 0);

/**
 * "2" against an option reading "1-3 years". Forms express experience and
 * salary as buckets; profiles hold a number. Without this the label matches
 * perfectly and the fill still fails.
 */
function rangeHit(want: string, optionText: string): boolean {
  const n = Number(norm(want));
  if (!Number.isFinite(n) || !norm(want).match(/^\d+$/)) return false;
  const r = optionText.match(/(\d+)\s*[-\u2013to]+\s*(\d+)/);
  if (r) return n >= Number(r[1]) && n <= Number(r[2]);
  const plus = optionText.match(/(\d+)\s*\+/);
  if (plus) return n >= Number(plus[1]);
  return false;
}

/** Pick the option whose text best matches `want`. */
export function matchOption(options: Option[], want: string): Option | undefined {
  if (!options.length) return undefined;
  const w = norm(want);
  let bestOpt: Option | undefined;
  let bestScore = 0;
  const PLACEHOLDER = /^(select|choose|please|--|-|none)\b/i;
  for (const o of options) {
    const t = norm(o.text);
    if (!t) continue;
    // "Select an option" is a prompt, not an answer -- unless it is literally
    // what we were asked to pick.
    if (PLACEHOLDER.test(o.text.trim()) && t !== w) continue;
    const s = Math.max(
      score(want, o.text),
      score(o.text, want),
      norm(o.value) === w ? 1 : 0,
      rangeHit(want, o.text) ? 0.9 : 0
    );
    if (s > bestScore) { bestScore = s; bestOpt = o; }
  }
  if (bestScore >= 0.5) return bestOpt;
  // A notice period of "0" has no "0" option on most boards; they offer
  // "Immediately available" or "Immediate joiner" instead.
  if (/^0( days?)?$/.test(w)) return options.find((o) => /\bimmediate/i.test(o.text));
  return undefined;
}

/** Yes/no option pickers, used for boolean answers on radios and selects. */
export function boolOption(options: Option[], yes: boolean): Option | undefined {
  const want = yes ? /^\s*(yes|y|true|i (do|am|have|agree|acknowledge)|agree|accept)\b/i
                   : /^\s*(no|n|false|i do not|i am not|decline)\b/i;
  return options.find((o) => want.test(o.text)) ?? options.find((o) => want.test(o.value));
}

const TRUTHY = /^(true|yes|y|1)$/i;

export type ResolveDeps = {
  profile: Profile;
  answers: Record<string, AnswerEntry>;
  threshold?: number;
};

/**
 * Decide what to put in one field. Returns null when nothing is confident
 * enough -- the caller logs those so the answer bank can grow.
 */
export function resolveField(field: Field, deps: ResolveDeps): Resolved | null {
  const { profile, answers } = deps;
// Label phrases that make a field unanswerable rather than merely unmatched.
// A blank here is the correct answer; anything else is a number the person
// cannot defend. Add a phrase whenever a form invents a new way to ask.
const UNANSWERABLE: RegExp[] = [
  /\bexcluding\s+internships?\b/i,
  /\bexcl\.?\s+internships?\b/i,
  /\bnot\s+counting\s+internships?\b/i,
  /\bfull[- ]time\s+experience\s+only\b/i,
  /\bpost[- ]qualification\s+experience\b/i,
];

  const threshold = deps.threshold ?? 0.55;
  const label = field.label || field.placeholder || field.name || "";
  if (!label) return null;

  // Never fill name-variant fields we do not store. Without this, the generic
  // "name" alias (and "your name", which reduces to "name" once the stop word
  // is dropped) leaks the full name into "Middle Name", "Father's Name", etc.
  // A single "Name" / "Your Name" field still matches fullName as before.
  if (/\b(middle|maiden|father'?s?|mother'?s?|spouse'?s?|guardian'?s?|nominee'?s?)\s+name\b/i.test(label)) {
    return null;
  }

  // Never answer a question whose own wording makes it unanswerable for this
  // person. "Years of experience EXCLUDING internships" is the live example: a
  // student has zero, no form offers zero, and the stored "1-3" matched it at
  // 0.80 because two unexplained tokens only cost 0.30. The token penalty is a
  // scoring heuristic, not a semantics check, so phrases that INVERT a field's
  // meaning have to be denied outright rather than out-scored.
  // Caught by the vertex fixture, 6 Oct 2026.
  if (UNANSWERABLE.some((re) => re.test(label))) {
    return null;
  }

  type Cand = { value: string | string[] | boolean; source: Resolved["source"]; score: number };
  const cands: Cand[] = [];

  // 1. answers.yaml first -- a hand-written answer always outranks a guess.
  for (const [key, entry] of Object.entries(answers)) {
    const s = Math.max(best(entry.match ?? [], label), score(key, label));
    if (s >= threshold) cands.push({ value: entry.answer, source: "answers", score: s + 0.05 });
  }

  // 2. profile keys via the alias table
  for (const [key, aliases] of Object.entries(PROFILE_ALIASES)) {
    const raw = profile[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const s = best(aliases, label);
    if (s >= threshold) {
      const value = Array.isArray(raw) ? (raw as string[]) : typeof raw === "boolean" ? raw : String(raw);
      cands.push({ value, source: key.endsWith("Path") ? "file" : "profile", score: s });
    }
  }

  // 3. common boolean questions no profile key covers
  if (["checkbox", "radio", "select", "toggle"].includes(field.kind)) {
    for (const b of BOOLEAN_DEFAULTS) {
      const s = best(b.match, label);
      if (s >= threshold) cands.push({ value: b.value, source: "default", score: s - 0.05 });
    }
  }

  // A file input whose label is dropzone copy ("Drop your resume here or
  // click to upload") matches no alias. On a job application a file input is
  // a resume unless something says otherwise, so fall back to it rather than
  // leaving the one required attachment empty.
  if (!cands.length && field.kind === "file" && typeof profile.resumePath === "string" && profile.resumePath) {
    // Greenhouse labels BOTH upload buttons "Attach"; only the input id
    // (resume vs cover_letter) or the surrounding text says which is which.
    // Enterpret, 2 Nov 2026: the CV went into the cover-letter slot too.
    const where = `${label} ${field.id ?? ""} ${field.name ?? ""} ${field.context ?? ""}`;
    // Ashby's "Autofill from resume" box re-parses the CV and rewrites fields
    // already filled; Espa, 6 Nov 2026, the real Resume slot came back empty.
    if (/autofill/i.test(where)) return null;
    const isCover = /cover[\s_-]*letter/i.test(where);
    if (isCover) {
      // No cover letter on file means leave the slot empty, never the CV.
      if (typeof profile.coverLetterPath !== "string" || !profile.coverLetterPath) return null;
      return { field, value: profile.coverLetterPath, source: "file", score: 0.5, alts: [] };
    }
    return { field, value: profile.resumePath, source: "file", score: 0.5, alts: [] };
  }

  if (!cands.length) return null;
  cands.sort((x, y) => y.score - x.score);
  const win = cands[0]!;

  let value = win.value;
  // normalise "true"/"yes" strings into real booleans for tick-boxes
  if (["checkbox", "radio", "toggle"].includes(field.kind) && typeof value === "string") {
    if (TRUTHY.test(value)) value = true;
    else if (/^(false|no|n|0)$/i.test(value)) value = false;
  }

  const alts = cands.slice(1, 5).map((c) => c.value);
  return { field, value, source: win.source, score: Math.min(1, win.score), alts };
}
