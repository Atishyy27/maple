import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Frame } from "playwright";
import { introspect, scopes } from "./form/introspect.js";
import { resolveField } from "./form/resolve.js";
import { fillField, lastFillError } from "./form/fill.js";
import { pickAdapter } from "./ats/adapters.js";
import { appendUnanswered, ROOT } from "./profile/load.js";
import type { ApplyResult, Field, Profile, AnswerEntry } from "./types.js";

export type RunOpts = {
  submit: boolean;
  headless: boolean;
  humanDelay: number;
  maxSteps: number;
  threshold: number;
  keepOpen: boolean;
  waitMinutes: number;
};

const USER_DATA = path.resolve(ROOT, "var/browser-profile");

/**
 * One persistent browser profile for every run. This is what makes Workday
 * survivable: you sign in to a tenant once by hand, the cookies live here,
 * and every later run on that tenant is already authenticated.
 */
export async function openContext(o: RunOpts): Promise<BrowserContext> {
  fs.mkdirSync(USER_DATA, { recursive: true });
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    headless: o.headless,
    // Headless: a tall synthetic viewport is fine and renders more of a long form
    // per pass. Headed: it is actively harmful. A 2400px viewport on a ~900px
    // window means the page lays out against a screen that does not exist, so
    // scrolling desyncs, everything looks zoomed out, and popovers (Google's
    // Drive file picker, native selects) position themselves off in space.
    // viewport: null makes the page match the real window, which is the only
    // correct answer for a browser a human is about to drive.
    // Diagnosed 25 Sep 2026 on a Google Form; the same symptom was present on the
    // Noise application and was misread as a site quirk both times.
    viewport: o.headless ? { width: 1440, height: 2400 } : null,
    args: [
      "--disable-blink-features=AutomationControlled",
      // Expose CDP on a fixed port when headed. Without this the browser is
      // launched over --remote-debugging-pipe and is reachable ONLY by the
      // process that spawned it, so a second process (or an assistant watching
      // the run) cannot attach to fix a bad fill without killing the browser --
      // which costs the human their login. With the port open, attach via
      // chromium.connectOverCDP("http://127.0.0.1:9222") and drive the live
      // session. Learned 25 Sep 2026 mid-application on GE Vernova.
      ...(o.headless ? [] : ["--window-size=1512,944", "--remote-debugging-port=9222"]),
    ],
  });
  // Playwright's 30s default is far too patient for a form-filler: one stale
  // locator would otherwise stall a whole run. Nothing here should ever take
  // more than a few seconds, and a miss is cheap -- it just gets logged.
  ctx.setDefaultTimeout(8000);
  return ctx;
}


/**
 * Re-assert every row of a repeating section, then verify the write survived.
 *
 * Workday (and any ATS using repeating panels) persists only the rows touched in
 * the current pass: type into rows 3 and 4, leave 1 and 2 alone, and the save
 * writes 3 and 4 while silently dropping 1 and 2. No error, and the DOM keeps
 * rendering all four, so the loss only surfaces on a Review page several steps
 * later. Diagnosed on GE Vernova 2026-09-25 after two rounds of silent data loss.
 *
 * reassertRows() reads every row's current value and writes it straight back, so
 * every row is dirty and the save is whole. It is idempotent by construction.
 */
export async function reassertRows(scope: Page | Frame, labelRe: RegExp): Promise<number> {
  const boxes = scope.getByRole("textbox", { name: labelRe });
  const n = await boxes.count().catch(() => 0);
  let touched = 0;
  for (let i = 0; i < n; i++) {
    const v = await boxes.nth(i).inputValue().catch(() => "");
    if (!v) continue;
    await boxes.nth(i).fill(v).catch(() => {});
    touched++;
  }
  return touched;
}

/**
 * Snapshot every filled field so a post-save diff can prove the write survived.
 * "It submitted without an error" is not evidence; only reading it back is.
 */
const refSel = (ref: string) => `[data-atsz-ref="${ref}"]`;

export async function snapshotFields(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const scope of scopes(page)) {
    let fields: Field[] = [];
    try { fields = await introspect(scope); } catch { continue; }
    for (const f of fields) {
      const v = await scope.locator(refSel(f.ref)).first().inputValue().catch(() => "");
      if (v) out[`${f.label}#${Object.keys(out).filter(k => k.startsWith(f.label + "#")).length}`] = v;
    }
  }
  return out;
}

/** Loudly report anything that was filled before a save and is gone after it. */
export function diffSnapshots(before: Record<string, string>, after: Record<string, string>): string[] {
  const lost: string[] = [];
  for (const [k, v] of Object.entries(before)) {
    if (!(k in after)) lost.push(`LOST ${k} = "${v.slice(0, 40)}"`);
    else if (after[k] !== v) lost.push(`CHANGED ${k}: "${v.slice(0, 30)}" -> "${(after[k] ?? "").slice(0, 30)}"`);
  }
  return lost;
}

const ts = () => new Date().toLocaleTimeString();
const log = (tag: string, msg: string) => console.log(`[${ts()}] [${tag}] ${msg}`);

export async function applyToJob(
  url: string,
  ctx: BrowserContext,
  deps: { profile: Profile; answers: Record<string, AnswerEntry> },
  o: RunOpts
): Promise<ApplyResult> {
  const start = Date.now();
  const adapter = pickAdapter(url);
  const page: Page = await ctx.newPage();
  let filled = 0, skipped = 0;
  const unanswered: string[] = [];

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    if (adapter.requiresAccount) {
      log(adapter.name, "tenant requires a signed-in account. If a login wall appears, sign in once in this window -- the session persists.");
    }

    /**
     * --wait <minutes>: hold until the page actually has fillable fields.
     *
     * Why this exists: on a gated tenant the sign-in and the fill MUST happen in
     * the same browser session. Killing the browser between them loses the login,
     * because a hard kill (SIGTERM/pkill) never lets Chromium flush its cookie
     * jar, and a fresh Workday login is a session cookie to begin with. So rather
     * than "sign in, quit, re-run", the tool parks here while the human signs in
     * and clicks through to the first real form page, then fills.
     * Learned 25 Sep 2026 on GE Vernova's tenant after repeated relaunches kept
     * landing back on step 1 of 7, "Create Account/Sign In".
     */
    if (o.waitMinutes > 0) {
      const deadline = Date.now() + o.waitMinutes * 60_000;
      log(adapter.name, `waiting up to ${o.waitMinutes} min for a fillable form. Sign in and click through in this window; filling starts by itself.`);
      let announced = false;
      while (Date.now() < deadline) {
        await adapter.prepare(page).catch(() => {});
        let labels: string[] = [];
        for (const scope of scopes(page)) {
          try { labels.push(...(await introspect(scope)).map((f) => f.label)); } catch { /* frame died mid-nav */ }
        }
        // An auth gate IS a form, so "any fields" is the wrong signal -- the first
        // version of this broke out on GE's Create Account page, filled the email
        // and quit. Treat a page carrying a password box as still-gated, and
        // require more than a couple of fields so a one-box interstitial does not
        // count either.
        const gated = labels.some((l) => /password/i.test(l));
        const n = labels.length;
        if (n > 2 && !gated) { log(adapter.name, `form detected: ${n} field(s) at ${page.url()}`); break; }
        if (gated) { if (!announced) { announced = true; log(adapter.name, "auth gate on screen (password field present) -- waiting for you to get past it."); } }
        else if (!announced) { announced = true; log(adapter.name, "no fields yet -- still on a gate or a non-form step."); }
        await page.waitForTimeout(3000);
      }
    }

    let lastSignature = "";
    for (let step = 0; step < o.maxSteps; step++) {
      await adapter.prepare(page);

      let stepFilled = 0;
      const seenLabels: string[] = [];
      for (const scope of scopes(page)) {
        let fields: Field[] = [];
        try { fields = await introspect(scope); } catch { continue; }
        if (!fields.length) continue;

        for (const f of fields) {
          seenLabels.push(f.label);
          const r = resolveField(f, { ...deps, threshold: o.threshold });
          if (!r) {
            skipped++;
            unanswered.push(
              JSON.stringify({ url, platform: adapter.name, label: f.label, kind: f.kind, required: f.required, options: f.options?.map((x) => x.text).slice(0, 12) })
            );
            continue;
          }
          const ok = await fillField(scope, r, { humanDelay: o.humanDelay });
          if (ok) {
            filled++; stepFilled++;
            log(adapter.name, `✓ ${f.label.slice(0, 60)} <- ${String(Array.isArray(r.value) ? r.value.join(", ") : r.value).slice(0, 48)} (${r.source} ${r.score.toFixed(2)})`);
          } else {
            skipped++;
            unanswered.push(JSON.stringify({ url, platform: adapter.name, label: f.label, kind: f.kind, reason: "fill-failed", why: lastFillError }));
          }
        }
      }

      log(adapter.name, `step ${step + 1}: filled ${stepFilled}`);

      // A "Next" that fires but does not change the form means validation
      // rejected the page. Retrying it seven more times fills nothing and
      // hides the real failure, so stop and let the report show it.
      const signature = seenLabels.join("|");
      if (signature && signature === lastSignature) {
        log(adapter.name, `stuck on the same fields after Next -- stopping. Check ${"var/unanswered.log"}.`);
        break;
      }
      lastSignature = signature;

      /**
       * Repeating panels (Work Experience, Education, Websites) only persist the
       * rows touched in THIS pass. Re-assert every row so the save is whole, then
       * snapshot, advance, and diff -- because "no error on submit" is not
       * evidence that anything was written. See README, "Multi-entry sections".
       */
      for (const re of [/^Job Title/i, /^Company/i, /^Location/i, /Role Description/i,
                        /^School or University/i, /^URL/i]) {
        const n = await reassertRows(page, re).catch(() => 0);
        if (n > 1) log(adapter.name, `re-asserted ${n} rows matching ${re} so the save keeps all of them`);
      }
      const before = await snapshotFields(page).catch(() => ({}));

      const advanced = await adapter.next(page);
      if (!advanced) break;

      await page.waitForTimeout(2500);
      const after = await snapshotFields(page).catch(() => ({}));
      // Only meaningful when the page did NOT change: a real step transition
      // legitimately shows different fields.
      if (Object.keys(after).length && signature === (await (async () => {
        const ls: string[] = [];
        for (const sc of scopes(page)) { try { ls.push(...(await introspect(sc)).map(f => f.label)); } catch {} }
        return ls.join("|");
      })())) {
        const lost = diffSnapshots(before, after);
        if (lost.length) {
          log(adapter.name, `WRITE DID NOT SURVIVE THE SAVE (${lost.length}):`);
          for (const l of lost.slice(0, 10)) log(adapter.name, "  " + l);
        }
      }
    }

    let submitted = false;
    let confirmationId: string | undefined;

    if (o.submit) {
      submitted = await adapter.submit(page);
      confirmationId = await adapter.confirmation(page);
      log(adapter.name, submitted ? `submitted -> ${confirmationId ?? "no confirmation text found"}` : "submit button not found");
    } else {
      // un-clip: force overflow visible / drop max-heights so a short viewport
      // or a fixed-height container cannot clip the captcha + submit off-screen.
      await page.evaluate(() => {
        for (const el of [document.documentElement, document.body]) {
          el.style.overflow = "visible"; el.style.height = "auto"; el.style.maxHeight = "none";
        }
        document.querySelectorAll('form, main, [class*="application" i], [class*="form" i], [class*="container" i]').forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.overflow === "hidden" || cs.overflowY === "hidden") (el as HTMLElement).style.overflow = "visible";
          if (cs.maxHeight !== "none") (el as HTMLElement).style.maxHeight = "none";
        });
      }).catch(() => {});
      log(adapter.name, "DRY RUN -- form filled, nothing submitted. Review the window.");
    }

    const shot = path.resolve(ROOT, `var/screenshots/${adapter.name}-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    appendUnanswered(unanswered);
    if (!o.keepOpen) await page.close();

    return { url, platform: adapter.name, filled, skipped, submitted, confirmationId, screenshot: shot, durationMs: Date.now() - start };
  } catch (e: any) {
    const shot = path.resolve(ROOT, `var/screenshots/error-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    appendUnanswered(unanswered);
    if (!o.keepOpen) await page.close().catch(() => {});
    return { url, platform: adapter.name, filled, skipped, submitted: false, error: e?.message ?? String(e), screenshot: shot, durationMs: Date.now() - start };
  }
}

/** Read-only: dump what the mapper sees on a page. The falsifier for the whole design. */
export async function inspectOnly(url: string, o: RunOpts) {
  const ctx = await openContext({ ...o, headless: false });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const adapter = pickAdapter(url);
  await adapter.prepare(page);

  const rows: any[] = [];
  for (const scope of scopes(page)) {
    let fields: Field[] = [];
    try { fields = await introspect(scope); } catch { continue; }
    for (const f of fields) {
      rows.push({ kind: f.kind, req: f.required ? "*" : "", label: f.label.slice(0, 70), options: f.options?.length ?? "" });
    }
  }
  console.log(`\n${adapter.name} :: ${rows.length} fields discovered on ${url}\n`);
  console.table(rows);
  await ctx.close();
  return rows;
}
