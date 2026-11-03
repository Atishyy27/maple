/**
 * Sign-in walls get nothing typed into them; real application forms still fill.
 *
 * Run:  npx tsx test/gate.ts
 */
import { isAuthGate } from "../src/form/gate.js";

const cases: { name: string; labels: string[]; url: string; want: boolean }[] = [
  { name: "fynd candidate login", labels: ["Email or phone number"], url: "https://hiring.fynd.com/candidate/login?redirect=%2Fjobs", want: true },
  { name: "workday create account", labels: ["Email Address", "Password", "Verify New Password"], url: "https://x.wd3.myworkdayjobs.com/en-US/careers/apply", want: true },
  { name: "otp step", labels: ["Enter OTP"], url: "https://jobs.example.com/apply/verify", want: true },
  { name: "greenhouse application", labels: ["First Name", "Last Name", "Email", "Phone", "Resume/CV"], url: "https://job-boards.greenhouse.io/enterpret/jobs/7723230003", want: false },
  { name: "lever application", labels: ["Full name", "Email", "Phone", "Current company"], url: "https://jobs.lever.co/Sprinto/6dfd5f41/apply", want: false },
  { name: "short form with email only", labels: ["Email", "Resume"], url: "https://forms.example.com/apply", want: false },
  { name: "auth word inside a longer path is not a gate", labels: ["Name", "Email"], url: "https://jobs.example.com/authors-team/apply", want: false },
];

let fail = 0;
for (const c of cases) {
  const got = isAuthGate(c.labels, c.url);
  const ok = got === c.want;
  if (!ok) fail++;
  console.log(`${ok ? "pass" : "FAIL"}  ${c.name}  ->  ${got ? "gate" : "form"}`);
}
console.log(`gate: ${cases.length - fail}/${cases.length} pass`);
if (fail) process.exit(1);
