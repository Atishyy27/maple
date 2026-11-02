/**
 * Fuzz harness for the field matcher (src/form/resolve.ts).
 *
 * Generates thousands of randomized, adversarial form-field labels with a KNOWN
 * expected outcome, then asserts resolveField gets each right. This is the "hit
 * it 810 times" test: property-based, not happy-path. It specifically hammers
 * the name-leak class (Middle/Father's/Spouse Name must resolve to NOTHING) and
 * the standard fields under label mutations (casing, "*", "(required)", "Enter
 * your ...", trailing colon) that must not change the answer.
 *
 * Run:  npx tsx test/fuzz-resolve.ts [iterations]
 */
import { resolveField } from "../src/form/resolve.js";
import type { Field, Profile, AnswerEntry } from "../src/types.js";

const profile = {
  firstName: "Atishay", lastName: "Jain", fullName: "Atishay Jain",
  email: "atishay@example.com", phone: "+91 90000 00000",
  location: "Indore, Madhya Pradesh, India", city: "Indore",
  linkedIn: "https://linkedin.com/in/atishyy27", github: "https://github.com/Atishyy27",
  school: "Shri G. S. Institute of Technology & Science", degree: "B.Tech", gradYear: "2027",
} as unknown as Profile;
const answers: Record<string, AnswerEntry> = {};

type Expect = { key: string; values: string[] } | { key: "NULL" };
const MAPPED: { labels: string[]; expect: Expect }[] = [
  { labels: ["First Name", "Given Name", "Legal First Name", "Forename"], expect: { key: "firstName", values: ["Atishay"] } },
  { labels: ["Last Name", "Surname", "Family Name"], expect: { key: "lastName", values: ["Jain"] } },
  { labels: ["Email", "Email Address", "E-mail", "Work Email"], expect: { key: "email", values: ["atishay@example.com"] } },
  { labels: ["Phone", "Mobile", "Phone Number", "Mobile Number", "Contact Number"], expect: { key: "phone", values: ["+91 90000 00000"] } },
  { labels: ["LinkedIn", "LinkedIn URL", "LinkedIn Profile"], expect: { key: "linkedIn", values: ["https://linkedin.com/in/atishyy27"] } },
  { labels: ["GitHub", "GitHub Profile", "GitHub URL"], expect: { key: "github", values: ["https://github.com/Atishyy27"] } },
  { labels: ["Current Location", "Location", "City"], expect: { key: "loc", values: ["Indore, Madhya Pradesh, India", "Indore"] } },
];
// These must resolve to NOTHING: we do not store them, and the greedy "name"
// alias must not leak the full name into them.
const TRAPS = ["Middle Name", "Maiden Name", "Father's Name", "Mother's Name",
  "Spouse Name", "Guardian Name", "Nominee Name", "Father Name", "Mother's name"];

function mutate(label: string, r: () => number): string {
  let s = label;
  if (r() < 0.3) s = s.toUpperCase();
  else if (r() < 0.3) s = s.toLowerCase();
  if (r() < 0.35) s = "Enter your " + s;
  if (r() < 0.3) s = "Your " + s;
  if (r() < 0.4) s = s + " *";
  if (r() < 0.3) s = s + " (required)";
  if (r() < 0.3) s = s + ":";
  if (r() < 0.2) s = "  " + s + "  ";
  return s;
}

function mkField(label: string, r: () => number): Field {
  const kinds = ["text", "email", "tel", "url"];
  return { ref: "f", kind: kinds[Math.floor(r() * kinds.length)] as any, label, required: r() < 0.5 };
}

// deterministic PRNG so a failure reproduces
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const N = Number(process.argv[2] || 5000);
const r = rng(20260907);
let pass = 0, fail = 0;
const failures: string[] = [];

for (let i = 0; i < N; i++) {
  const trap = r() < 0.4;
  if (trap) {
    const base = TRAPS[Math.floor(r() * TRAPS.length)];
    const label = mutate(base, r);
    const got = resolveField(mkField(label, r), { profile, answers, threshold: 0.55 });
    if (got === null) pass++;
    else { fail++; if (failures.length < 25) failures.push(`LEAK  "${label}" -> ${JSON.stringify(got.value)} (expected null)`); }
  } else {
    const grp = MAPPED[Math.floor(r() * MAPPED.length)];
    const base = grp.labels[Math.floor(r() * grp.labels.length)];
    const label = mutate(base, r);
    const got = resolveField(mkField(label, r), { profile, answers, threshold: 0.55 });
    const want = grp.expect as any;
    const ok = got !== null && typeof got.value === "string" && want.values.includes(got.value);
    if (ok) pass++;
    else { fail++; if (failures.length < 25) failures.push(`MISS  "${label}" -> ${got ? JSON.stringify(got.value) : "null"} (expected one of ${JSON.stringify(want.values)})`); }
  }
}

console.log(`\nfuzz-resolve: ${N} cases  |  pass ${pass}  fail ${fail}  (${((pass / N) * 100).toFixed(2)}%)`);
if (failures.length) {
  console.log(`\nfirst ${failures.length} failures:`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("ALL PASS");
