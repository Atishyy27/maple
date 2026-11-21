import assert from "node:assert/strict";
// @ts-ignore plain JS module
import { norm } from "../scripts/seen-urls.mjs";

const same = [
  ["https://job-boards.greenhouse.io/agoda/jobs/6323041?gh_src=a7bcdb511us", "https://job-boards.greenhouse.io/agoda/jobs/6323041"],
  ["https://jobs.ashbyhq.com/oaknorth/9bb335d1/application", "https://jobs.ashbyhq.com/oaknorth/9bb335d1/"],
  ["https://jobs.lever.co/paytm/0a6e7022/apply", "http://www.jobs.lever.co/paytm/0a6e7022"],
  ["https://x.wd501.myworkdayjobs.com/en-US/Zebra_careers/job/A_JR1/apply/applyManually?q=2027", "https://x.wd501.myworkdayjobs.com/en-US/Zebra_careers/job/A_JR1"],
];
for (const [a, b] of same) assert.equal(norm(a), norm(b), `${a} vs ${b}`);
assert.notEqual(norm("https://job-boards.greenhouse.io/agoda/jobs/1"), norm("https://job-boards.greenhouse.io/agoda/jobs/2"));
console.log(`seen-urls: ${same.length + 1}/${same.length + 1} pass`);
