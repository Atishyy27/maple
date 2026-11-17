// `node scripts/probe-companies.mjs names.txt`: for each company name, try the likely board slug
// on Greenhouse, Lever and Ashby and keep the ones that answer. Appends verified "ats:slug" lines
// to sources/companies.txt. A guessed slug is never kept unless the board API returns jobs.
import fs from "node:fs";

const names = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const have = new Set(fs.existsSync("sources/companies.txt") ? fs.readFileSync("sources/companies.txt", "utf8").split(/\s+/).filter(Boolean) : []);
const variants = (n) => {
  const base = n.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 .-]/g, "");
  return [...new Set([base.replace(/[\s.]+/g, ""), base.replace(/\s+/g, "-"), base.replace(/[\s.]+/g, "") + "hq", base.replace(/\s+/g, "") + "india", base.split(" ")[0]])];
};
const urls = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
};
// A 404 means "no board under this slug". A timeout means nothing: on a slow link (17 Nov 2026,
// 5-10 s per request) every slug timed out and the first version recorded all 230 as "no board".
// Retry network errors, and count them separately so a bad connection cannot pass as a result.
let netErrors = 0;
async function ok(ats, slug) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(urls[ats](slug), { headers: { "user-agent": "maple-job-source" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) return false;
      const j = await r.json();
      return ats === "lever" ? Array.isArray(j) : Array.isArray(j.jobs);
    } catch { await new Promise((res) => setTimeout(res, 2000 * (attempt + 1))); }
  }
  netErrors++;
  return false;
}
const found = [];
for (const n of names) {
  let hit = "";
  for (const slug of variants(n)) {
    for (const ats of ["ashby", "greenhouse", "lever"]) {
      if (have.has(`${ats}:${slug}`)) { hit = "known"; break; }
      if (await ok(ats, slug)) { hit = `${ats}:${slug}`; break; }
    }
    if (hit) break;
  }
  if (hit && hit !== "known") { found.push(hit); have.add(hit); }
  process.stdout.write(`${n}: ${hit || "-"}\n`);
}
if (found.length) fs.appendFileSync("sources/companies.txt", found.join("\n") + "\n");
console.log(`\n${found.length} new boards added to sources/companies.txt (of ${names.length} names)`);
