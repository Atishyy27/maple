// `npm run source`: pull live openings straight from company job boards, so every link is a
// real application form (the bulk run of 17 Nov 2026 found that 207 of 282 sheet links were
// listing pages with no form).
//
// Uses the public job-board APIs that Greenhouse, Lever and Ashby publish for every company.
// No login, no scraping of LinkedIn. Companies come from sources/companies.txt (one
// "ats:slug" per line) plus any greenhouse/lever/ashby link found in var/seed-links.txt.
//
//   node scripts/source.mjs            -> var/sourced.tsv (row<TAB>company<TAB>apply link)
import fs from "node:fs";

const KEEP_TITLE = /\b(intern|internship|new grad|graduate|trainee|fresher|entry level|early career|sde ?i\b|software engineer i\b|associate software|junior)\b/i;
const DROP_TITLE = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp)\b/i;
const ROLE = /\b(engineer|engineering|developer|sde|software|ml|ai|machine learning|data|research|backend|frontend|full ?stack|platform|devops|sre|infra|security|applied)\b/i;
// "Remote" alone is often US-only (Notion: "New York, remote"), so the place must name India.
const KEEP_PLACE = /\b(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|indore|apac)\b/i;
const MAX_AGE_DAYS = 45;

const seeds = new Set();
const add = (ats, slug) => slug && seeds.add(`${ats}:${slug.toLowerCase()}`);
for (const f of ["sources/companies.txt", "var/seed-links.txt"]) {
  if (!fs.existsSync(f)) continue;
  for (const raw of fs.readFileSync(f, "utf8").split(/\s+/)) {
    const l = raw.trim();
    let m;
    if ((m = l.match(/^(greenhouse|lever|ashby):([\w.-]+)$/))) add(m[1], m[2]);
    else if ((m = l.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)/))) add("greenhouse", m[1]);
    else if ((m = l.match(/jobs\.lever\.co\/([\w-]+)/))) add("lever", m[1]);
    else if ((m = l.match(/jobs\.ashbyhq\.com\/([\w.-]+)/))) add("ashby", m[1]);
  }
}

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": "maple-job-source" } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const fresh = (d) => !d || (Date.now() - new Date(d).getTime()) / 86400000 <= MAX_AGE_DAYS;

async function fetchBoard(ats, slug) {
  if (ats === "greenhouse") {
    const j = await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    return j.jobs.map((x) => ({ title: x.title, place: x.location?.name ?? "", url: x.absolute_url, at: x.updated_at }));
  }
  if (ats === "lever") {
    const j = await get(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return j.map((x) => ({ title: x.text, place: `${x.categories?.location ?? ""} ${x.workplaceType ?? ""}`, url: `${x.hostedUrl}/apply`, at: x.createdAt }));
  }
  const j = await get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  return (j.jobs ?? []).map((x) => ({ title: x.title, place: `${x.location ?? ""} ${x.isRemote ? "remote" : ""}`, url: `${x.jobUrl}/application`, at: x.publishedAt }));
}

const out = [], stats = { boards: 0, boardsFailed: 0, postings: 0 };
for (const s of seeds) {
  const [ats, slug] = s.split(":");
  try {
    const jobs = await fetchBoard(ats, slug);
    stats.boards++; stats.postings += jobs.length;
    for (const j of jobs) {
      if (!KEEP_TITLE.test(j.title) || DROP_TITLE.test(j.title) || !ROLE.test(j.title)) continue;
      if (!KEEP_PLACE.test(j.place) || !fresh(j.at)) continue;
      out.push([`${ats}:${slug}`, `${slug} - ${j.title} (${j.place.trim()})`.replace(/\t/g, " "), j.url]);
    }
  } catch (e) { stats.boardsFailed++; if (process.env.DEBUG) console.error(s, e.message); }
}
fs.writeFileSync("var/sourced.tsv", out.map((r) => r.join("\t")).join("\n") + (out.length ? "\n" : ""));
console.log(`${seeds.size} companies | ${stats.boards} boards read, ${stats.boardsFailed} failed | ${stats.postings} postings | ${out.length} kept (intern/new-grad, India or remote, last ${MAX_AGE_DAYS} days) -> var/sourced.tsv`);
