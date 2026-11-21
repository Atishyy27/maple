import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

/**
 * CV -> profile.yaml, deterministically. No LLM, no API key, no network.
 *
 * Everything it cannot prove from the text is written as `TODO: ...` rather
 * than guessed. The loader treats a TODO as absent, so a half-filled profile
 * degrades into "skip that field", never into "submit a wrong answer".
 *
 * Re-running is safe: values you have edited by hand are preserved. Only
 * TODOs and missing keys are refilled. Pass --force to overwrite everything.
 */

/** Canonical display spellings. Matching is case-insensitive; output is not. */
const SKILL_VOCAB = [
  "Python","JavaScript","TypeScript","Java","C++","C#","Go","Rust","Ruby","PHP","Swift","Kotlin","Scala",
  "React","Next.js","Vue","Angular","Svelte","Node.js","Express","Django","Flask","FastAPI","Spring",
  "Rails","Laravel",".NET","Tailwind","Redux","GraphQL","REST","gRPC",
  "PostgreSQL","MySQL","MongoDB","Redis","SQLite","DynamoDB","Cassandra","Elasticsearch","ClickHouse",
  "AWS","GCP","Azure","Docker","Kubernetes","Terraform","Ansible","Jenkins","GitHub Actions","GitLab CI","CI/CD",
  "Linux","Bash","Git","Nginx","Kafka","RabbitMQ","Airflow","Spark","Hadoop",
  "PyTorch","TensorFlow","scikit-learn","pandas","NumPy","OpenCV","Hugging Face","LangChain","LLM","NLP",
  "Machine Learning","Deep Learning","Computer Vision","Prometheus","Grafana","Loki","Playwright","Selenium",
  "Cypress","Jest","pytest","HTML","CSS","Figma","Embedded C","RTOS","Zephyr","BLE","Firmware",
];

const DEGREES: [RegExp, string][] = [
  [/\bph\.?\s?d\b|doctorate/i, "PhD"],
  [/\bm\.?\s?tech\b|master of technology/i, "M.Tech"],
  [/\bm\.?\s?s\.?\b|master of science|\bmsc\b/i, "MS"],
  [/\bmba\b/i, "MBA"],
  [/\bmca\b/i, "MCA"],
  [/\bmaster'?s?\b/i, "Masters"],
  [/\bb\.?\s?tech\b|bachelor of technology/i, "B.Tech"],
  [/\bb\.?\s?e\.?\b|bachelor of engineering/i, "B.E."],
  [/\bb\.?\s?sc\b|bachelor of science/i, "B.Sc"],
  [/\bbca\b/i, "BCA"],
  [/\bbachelor'?s?\b/i, "Bachelors"],
  [/\bdiploma\b/i, "Diploma"],
];

const MAJORS = [
  "Computer Science and Engineering","Computer Science","Information Technology",
  "Electronics and Communication","Electrical Engineering","Mechanical Engineering",
  "Civil Engineering","Data Science","Artificial Intelligence","Software Engineering",
  "Information Systems","Mathematics and Computing","Electronics",
];

/** Extract raw text from a PDF using pdfjs (pure JS, no binaries). */
export async function pdfText(file: string): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // group items into lines by their y coordinate so layout survives
    const rows = new Map<number, { x: number; w: number; s: string }[]>();
    for (const it of content.items as any[]) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const key = Math.round(y / 3) * 3;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({ x: it.transform[4], w: it.width ?? 0, s: it.str });
    }
    // Join runs with a space ONLY where the glyphs are actually apart. A PDF
    // splits a single word across runs freely, and inserting a space there
    // turns "priyasharma.dev" into "priyasharma.d ev" -- which then truncates
    // at the first regex that stops on whitespace.
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => {
        const sorted = parts.sort((a, b) => a.x - b.x);
        let out = "";
        for (let i = 0; i < sorted.length; i++) {
          const cur = sorted[i]!;
          if (i > 0) {
            const prev = sorted[i - 1]!;
            const gap = cur.x - (prev.x + prev.w);
            if (gap > 0.8) out += " ";
          }
          out += cur.s;
        }
        return out.replace(/\s+/g, " ").trim();
      })
      .filter(Boolean);
    out.push(lines.join("\n"));
  }
  return out.join("\n");
}

export function parseCv(rawText: string): Record<string, unknown> {
  // A long URL that wrapped in the PDF arrives as two lines
  // ("https://priyasharma.d" / "ev"). Stitch the continuation back on before
  // anything tries to read a URL out of it, or every link silently truncates.
  const text = rawText.replace(
    /(https?:\/\/[^\s]*[^\s.,;:)])\n([a-z0-9/._-]{1,12})(?=\s|$)/gi,
    "$1$2"
  );
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const flat = text.replace(/\s+/g, " ");
  const low = text.toLowerCase();
  const p: Record<string, unknown> = {};

  const email = flat.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0];
  if (email) p.email = email;

  const phone = flat.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g)
    ?.map((s) => s.trim())
    .find((s) => s.replace(/\D/g, "").length >= 10 && s.replace(/\D/g, "").length <= 13);
  if (phone) p.phone = phone;

  const li = flat.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i)?.[0];
  if (li) p.linkedIn = li.startsWith("http") ? li : `https://${li}`;

  const gh = flat.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i)?.[0];
  if (gh) p.github = gh.startsWith("http") ? gh : `https://${gh}`;

  const other = (flat.match(/https?:\/\/[^\s)]+/gi) ?? []).find(
    (u) => !/linkedin|github|mailto|x\.com|twitter/i.test(u)
  );
  if (other) p.portfolio = other.replace(/[.,)]+$/, "");

  // Name: the first line that reads like a person, not a heading.
  // A two-column header puts the name and the email on one row ("Atishay Jain  a@b.com | +91 ..."),
  // so also try each line cut at the first email, phone or separator.
  const nameLine = lines.slice(0, 6)
    .flatMap((l) => [l, l.split(/\s{2,}|\s[|·•]\s|\s\S+@\S+|\s\+?\d[\d\s-]{7,}/)[0]!.trim()])
    .find((l) => /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(l) && !/resume|curriculum|vitae|cv/i.test(l));
  if (nameLine) {
    const parts = nameLine.split(/\s+/);
    p.fullName = nameLine;
    p.firstName = parts[0];
    p.lastName = parts[parts.length - 1];
  }

  const school = lines.find((l) => /(university|college|institute of technology|\bIIT\b|\bNIT\b|\bBITS\b|\bIIIT\b|\bVIT\b|\bSRM\b|academy)/i.test(l));
  if (school) p.school = school.replace(/\s*[|·•,]\s*\d{4}.*$/, "").trim();

  for (const [re, name] of DEGREES) if (re.test(text)) { p.degree = name; break; }
  // Look for the branch on the degree line first. A whole-text scan matched
  // "Electronics" inside an employer's name ("MP State Electronics Development
  // Corporation") on a Mechanical CV, 17 Nov 2026.
  // Case-sensitive B.E. (the English word "be" matched before), and a degree word, not prose.
  const degreeLine = lines.find((l) => /\b(B\.?\s?Tech|B\.E\.?|BE\b|Bachelor|M\.?\s?Tech|Master'?s?\b|B\.?Sc|M\.?Sc)/.test(l) || /\b(b\.?\s?tech|bachelor of|master of)\b/i.test(l)) ?? "";
  const SHORT: [RegExp, string][] = [
    [/\bmechanical\b/i, "Mechanical Engineering"], [/\bcivil\b/i, "Civil Engineering"],
    [/\belectrical\b/i, "Electrical Engineering"], [/\b(ece|electronics)\b/i, "Electronics and Communication"],
    [/\b(cse|computer science)\b/i, "Computer Science"], [/\bIT\b|\b[Ii]nformation [Tt]echnology\b/, "Information Technology"],
  ];
  const major = MAJORS.find((m) => degreeLine.toLowerCase().includes(m.toLowerCase()))
    ?? SHORT.find(([re]) => re.test(degreeLine))?.[1]
    ?? MAJORS.find((m) => low.includes(m.toLowerCase()));
  if (major) p.major = major;

  const years = (flat.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number).filter((y) => y >= 2015 && y <= 2035);
  if (years.length) p.gradYear = String(Math.max(...years));

  // Scan the de-wrapped text as well: a PDF can break a word across lines
  // ("Grafan" / "a."), which hides the skill from a line-wise scan. Detection
  // only -- a rare false positive adds one skill you can delete, whereas a
  // miss silently drops it from every application.
  const joined = low.replace(/\n/g, "");
  const skills = SKILL_VOCAB.filter((k) => {
    const re = new RegExp(`(?<![a-z0-9])${k.replace(/[.+*#()\\-]/g, "\\$&")}(?![a-z0-9])`, "i");
    return re.test(low) || (k.length >= 4 && re.test(joined));
  });
  if (skills.length) p.skills = skills;

  // Per LINE, not over the flattened text: on a one-line contact header
  // ("Priya Sharma Bengaluru, India | ...") a flat scan happily reads the
  // surname as part of the city.
  for (const line of lines.slice(0, 12)) {
    const seg = line.split(/[|·•]/).find((x) => /,\s*(India|USA|United States|UK|Canada|[A-Z]{2})\b/.test(x));
    if (!seg) continue;
    // Link labels sit on the same header line ("CodeChef  Bengaluru, India") and
    // would be read as the first word of the city.
    const clean = seg.replace(/\b(GitHub|LinkedIn|LeetCode|Codeforces|CodeChef|AtCoder|Portfolio|Email|Mobile|Phone)\b:?/g, " ");
    const m = clean.trim().match(/([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?),\s*(India|USA|United States|UK|Canada|[A-Z]{2})\b/);
    if (m) { p.location = m[0]; p.city = m[1]; p.country = m[2]; break; }
  }

  return p;
}

const TODOS: Record<string, string> = {
  location: "TODO: City, Country",
  earliestStartDate: "TODO: YYYY-MM-DD",
  salaryExpectation: "TODO: number only, no currency symbol",
  currentCompany: "TODO",
  currentTitle: "TODO",
  yearsExperience: "TODO",
  noticePeriod: "TODO",
  referralSource: "TODO: LinkedIn / Company Website / Referral",
  resumePath: "TODO: cv/<your-cv>.pdf",
};

export async function writeProfileFromCv(cvPath: string, out = "profile.yaml", force = false) {
  const text = await pdfText(path.resolve(cvPath));
  const parsed = parseCv(text);

  const existing: Record<string, unknown> = fs.existsSync(out)
    ? YAML.parse(fs.readFileSync(out, "utf8")) ?? {}
    : {};

  const merged: Record<string, unknown> = { ...existing };
  const isPlaceholder = (v: unknown) => v === undefined || v === null || v === "" || (typeof v === "string" && /^TODO\b/.test(v));

  for (const [k, v] of Object.entries(parsed)) {
    if (force || isPlaceholder(merged[k])) merged[k] = v;
  }
  for (const [k, v] of Object.entries(TODOS)) {
    if (isPlaceholder(merged[k])) merged[k] = v;
  }
  if (isPlaceholder(merged.resumePath)) merged.resumePath = cvPath;
  if (merged.workAuthorized === undefined) merged.workAuthorized = "TODO: true/false";
  if (merged.needsSponsorship === undefined) merged.needsSponsorship = "TODO: true/false";

  fs.writeFileSync(out, YAML.stringify(merged, { lineWidth: 100 }));

  const todos = Object.entries(merged).filter(([, v]) => typeof v === "string" && /^TODO/.test(v)).map(([k]) => k);
  return { found: Object.keys(parsed), todos, chars: text.length, out };
}
