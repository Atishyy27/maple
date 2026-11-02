import { loadProfile, loadAnswers, loadJobs } from "./profile/load.js";
import { applyToJob, inspectOnly, openContext, type RunOpts } from "./run.js";
import { writeProfileFromCv } from "./profile/fromCv.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f: string) => argv.includes(f);
const val = (f: string, d?: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const positional = argv.slice(1).filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);

const opts: RunOpts = {
  // submitting is opt-in. Default is fill-and-stop so a bad mapping cannot
  // send a wrong answer to a real employer.
  submit: has("--submit"),
  headless: has("--headless"),
  humanDelay: Number(val("--human", "0")),
  maxSteps: Number(val("--steps", "8")),
  threshold: Number(val("--threshold", "0.55")),
  // set below once we know how many jobs there are -- keeping 20 tabs open
  // after a batch dry run is not review, it is a memory leak.
  keepOpen: false,
  waitMinutes: Number(val("--wait", "0")),
};

function usage() {
  console.log(`
maple -- local job application autofill

  npm run profile -- cv/my-cv.pdf [--force]     build profile.yaml from a CV
  npm run fields  -- <job-url>                  show every field the mapper sees
  npm run dry                                   fill every job in jobs.txt, submit nothing
  npm run apply   -- --submit                   fill AND submit
  npm run apply   -- --url <job-url> --submit   one job

flags
  --url <u>        one job instead of jobs.txt
  --jobs <file>    job list (default jobs.txt)
  --limit <n>      stop after n jobs
  --submit         actually submit (default: off)
  --headless       no visible browser (not advised for Workday)
  --wait <min>     park until a fillable form appears; sign in by hand meanwhile
  --human <ms>     per-keystroke delay, e.g. 40. 0 = instant
  --threshold <f>  label-match confidence, 0..1 (default 0.55). Raise to be safer.
  --profile <f>    profile file (default profile.yaml)
  --answers <f>    answer bank (default answers.yaml)
`);
}

async function main() {
  if (!cmd || has("--help") || has("-h")) return usage();

  if (cmd === "profile") {
    const cv = positional[0] ?? val("--cv");
    if (!cv) return console.error("usage: npm run profile -- cv/my-cv.pdf");
    const r = await writeProfileFromCv(cv, val("--out", "profile.yaml")!, has("--force"));
    console.log(`\nread ${r.chars} chars from ${cv}`);
    console.log(`filled from CV : ${r.found.join(", ")}`);
    console.log(`still TODO     : ${r.todos.join(", ") || "none"}`);
    console.log(`\n-> edit ${r.out} and fill the TODOs. A TODO is treated as "no answer", never guessed.`);
    return;
  }

  if (cmd === "fields") {
    const url = positional[0] ?? val("--url");
    if (!url) return console.error("usage: npm run fields -- <job-url>");
    await inspectOnly(url, opts);
    return;
  }

  if (cmd !== "apply") { usage(); return; }

  const profile = loadProfile(val("--profile", "profile.yaml")!);
  const answers = loadAnswers(val("--answers", "answers.yaml")!);
  const one = val("--url");
  let jobs = one ? [one] : loadJobs(val("--jobs", "jobs.txt")!);
  const limit = Number(val("--limit", "0"));
  if (limit > 0) jobs = jobs.slice(0, limit);

  if (!jobs.length) return console.error("no jobs. Put URLs in jobs.txt or pass --url");
  // leave the window up for review only when there is exactly one thing to review
  opts.keepOpen = (has("--keep-open") || !opts.submit) && jobs.length === 1 && !opts.headless;
  console.log(`${jobs.length} job(s) | submit=${opts.submit} | threshold=${opts.threshold}\n`);

  const ctx = await openContext(opts);
  const results = [];
  for (const url of jobs) {
    console.log(`\n──────── ${url}`);
    results.push(await applyToJob(url, ctx, { profile, answers }, opts));
  }

  console.log("\n──────── SUMMARY");
  console.table(
    results.map((r) => ({
      platform: r.platform,
      filled: r.filled,
      skipped: r.skipped,
      submitted: r.submitted ? "yes" : "-",
      id: r.confirmationId ?? "",
      ms: r.durationMs,
      error: r.error?.slice(0, 40) ?? "",
    }))
  );
  const skipped = results.reduce((a, r) => a + r.skipped, 0);
  if (skipped) console.log(`\n${skipped} field(s) had no confident answer -> var/unanswered.log. Add them to answers.yaml.`);

  if (opts.keepOpen && !opts.headless) {
    console.log("\nbrowser left open for review. Ctrl-C to quit.");
    await new Promise(() => {});
  }
  await ctx.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
