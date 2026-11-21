// Every job URL already applied to, normalised so one posting matches however it was linked.
//   node scripts/seen-urls.mjs norm <url>     -> prints the normalised key
//   node scripts/seen-urls.mjs list           -> prints every key from var/submitted.txt + the ledger
// The ledger is cnc/me/apps/APPLICATIONS.csv (MAPLE_LEDGER overrides the path). Applications made by
// hand or by one-off scripts live only there, so a bulk run must read it too (22 Nov 2026: Agoda,
// Zebra, OakNorth and Wayam were missing from var/submitted.txt).
import fs from "node:fs";
import path from "node:path";

export function norm(u) {
  let s = String(u || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("#")[0].split("?")[0];
  s = s.replace(/\/+(application|apply|applymanually|apply\/applymanually)\/?$/, "").replace(/\/+$/, "");
  return s;
}

function ledgerPath() {
  if (process.env.MAPLE_LEDGER) return process.env.MAPLE_LEDGER;
  return path.resolve("..", "..", "cnc", "me", "apps", "APPLICATIONS.csv");
}

export function seen() {
  const keys = new Set();
  const add = (u) => { const k = norm(u); if (k) keys.add(k); };
  if (fs.existsSync("var/submitted.txt")) fs.readFileSync("var/submitted.txt", "utf8").split(/\r?\n/).forEach(add);
  const led = ledgerPath();
  if (fs.existsSync(led)) for (const m of fs.readFileSync(led, "utf8").matchAll(/https?:\/\/[^\s,"]+/g)) add(m[0]);
  return keys;
}

if (process.argv[1] && process.argv[1].endsWith("seen-urls.mjs")) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "norm") console.log(norm(arg));
  else if (cmd === "list") console.log([...seen()].join("\n"));
}
