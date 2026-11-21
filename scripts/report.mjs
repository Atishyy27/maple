// `npm run report`: what happened across every run, and what to fix next.
// Reads var/runs.jsonl (one line per job) and var/unanswered.log (one line per skipped field).
import fs from "node:fs";

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
const runs = read("var/runs.jsonl").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const since = process.argv[2]; // optional ISO date, e.g. 2026-11-17
const rows = since ? runs.filter((r) => r.at >= since) : runs;

console.log(`\n${rows.length} job runs${since ? ` since ${since}` : ""}\n`);
const by = {};
for (const r of rows) (by[r.reason || "unknown"] ??= []).push(r);
for (const [reason, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(list.length).padStart(4)}  ${reason}`);
}

const mails = [...new Set((by["apply by email"] || []).map((r) => r.note).filter(Boolean))];
if (mails.length) console.log(`\nApply by email (send these a cold mail):\n  ${mails.join("\n  ")}`);

const asked = {};
for (const l of read("var/unanswered.log")) {
  let label = l;
  try { label = JSON.parse(l).label ?? l; } catch {}
  label = String(label).replace(/[\s​]+/g, " ").trim().slice(0, 90);
  // Option text and widget chrome ("Yes", "Loading...", "Search for option") are not questions.
  if (label.length < 15 || /^(loading|search for option|select|attach|upload file)/i.test(label)) continue;
  asked[label] = (asked[label] || 0) + 1;
}
const top = Object.entries(asked).sort((a, b) => b[1] - a[1]).slice(0, 15);
if (top.length) {
  console.log("\nMost-asked questions with no answer yet (add them to answers.yaml):");
  for (const [q, n] of top) console.log(`${String(n).padStart(4)}  ${q}`);
}
console.log("");
