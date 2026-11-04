/**
 * Closed postings are named as closed; live job pages are not.
 *
 * Run:  npx tsx test/closed.ts
 */
import { isClosedPosting } from "../src/form/closed.js";

const cases: { name: string; text: string; want: boolean }[] = [
  { name: "lever 404", text: "Sorry, we couldn't find anything here The job posting you're looking for might have closed, or it has been removed. (404 error).", want: true },
  { name: "workday no longer accepting", text: "This job posting is no longer accepting applications.", want: true },
  { name: "position filled", text: "Thanks for your interest. This position has been filled.", want: true },
  { name: "greenhouse live posting", text: "Machine Learning Intern Bengaluru Apply First Name Last Name Email Resume/CV", want: false },
  { name: "job text mentioning closing a ticket", text: "You will close support tickets and own the closed-loop feedback pipeline.", want: false },
];

let fail = 0;
for (const c of cases) {
  const got = isClosedPosting(c.text);
  if (got !== c.want) fail++;
  console.log(`${got === c.want ? "pass" : "FAIL"}  ${c.name}  ->  ${got ? "closed" : "open"}`);
}
console.log(`closed: ${cases.length - fail}/${cases.length} pass`);
if (fail) process.exit(1);
