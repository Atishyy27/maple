/**
 * Upload slots: the CV goes only where a CV belongs.
 *
 * Greenhouse renders the resume and cover-letter uploads with the same visible
 * label, "Attach". On Enterpret (2 Nov 2026) the CV was attached to both. A wrong
 * file in a cover-letter slot is a confident wrong value, so it must stay empty.
 *
 * Run:  npx tsx test/upload-slots.ts
 */
import { resolveField } from "../src/form/resolve.js";
import type { Field, Profile } from "../src/types.js";

const cv = "C:/cv/resume.pdf";
const cover = "C:/cv/cover.pdf";
const base = { firstName: "A", lastName: "J", resumePath: cv } as unknown as Profile;
const file = (label: string, id: string, context = ""): Field =>
  ({ kind: "file", label, id, name: "", required: false, context } as unknown as Field);

const cases: { name: string; field: Field; profile: Profile; want: string | null }[] = [
  { name: "greenhouse resume slot", field: file("Attach", "resume"), profile: base, want: cv },
  { name: "greenhouse cover slot, no cover letter on file", field: file("Attach", "cover_letter"), profile: base, want: null },
  { name: "greenhouse cover slot, cover letter on file", field: file("Attach", "cover_letter"), profile: { ...base, coverLetterPath: cover } as Profile, want: cover },
  { name: "cover named only in the surrounding text", field: file("Upload", "f2", "Cover Letter Attach Dropbox"), profile: base, want: null },
  { name: "dropzone copy for the resume", field: file("Drop your resume here or click to upload", "u1"), profile: base, want: cv },
];

let fail = 0;
for (const c of cases) {
  const got = resolveField(c.field, { profile: c.profile, answers: {}, threshold: 0.55 });
  const value = got ? String(got.value) : null;
  const ok = value === c.want;
  if (!ok) fail++;
  console.log(`${ok ? "pass" : "FAIL"}  ${c.name}  ->  ${value ?? "blank"}`);
}
console.log(`upload-slots: ${cases.length - fail}/${cases.length} pass`);
if (fail) process.exit(1);
