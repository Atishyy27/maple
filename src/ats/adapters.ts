import type { Page, Locator } from "playwright";
import { ensureShim } from "../form/introspect.js";

/**
 * An adapter carries ONLY what is different about a platform's *navigation*:
 * how it pages forward, how it submits, where it prints a confirmation.
 *
 * It deliberately holds no field selectors. Field discovery is generic
 * (see src/form/introspect.ts) so a markup change on any board does not
 * reach this file.
 */
export type Adapter = {
  name: string;
  /** true when this adapter owns the page */
  matches(url: string): boolean;
  /** the tenant makes you create an account before you can apply */
  requiresAccount?: boolean;
  prepare(page: Page): Promise<void>;
  /** advance one step; false when there is nothing left to advance to */
  next(page: Page): Promise<boolean>;
  submit(page: Page): Promise<boolean>;
  confirmation(page: Page): Promise<string | undefined>;
};

const settle = async (page: Page, ms = 1200) => {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(ms);
};

/** First visible+enabled control whose text matches, across main frame + iframes. */
/**
 * Indices of elements in `loc` whose visible text (or value) matches `re`, read in ONE
 * round trip. The old loops read the first 40 or 80 elements one by one and stopped
 * there, so on a long page the Apply or Submit button past that point was never seen
 * (thejobcompany, hellointern, workatastartup; bulk run 17 Nov 2026).
 */
async function matching(loc: Locator, re: RegExp): Promise<number[]> {
  const texts = await loc.evaluateAll((els) =>
    els.map((e) => ((e as HTMLElement).innerText || (e as HTMLInputElement).value || "").trim().replace(/\s+/g, " "))
  ).catch(() => [] as string[]);
  return texts.flatMap((t, i) => (t && re.test(t) ? [i] : []));
}

async function clickByText(page: Page, re: RegExp, timeout = 3000): Promise<boolean> {
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    const loc = frame.locator('button, [role="button"], input[type="submit"], a[class*="button" i], a[class*="btn" i]');
    for (const i of await matching(loc, re)) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if (await el.isDisabled().catch(() => false)) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout }).catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * Count controls that are actually visible right now, across the main frame
 * and every iframe. Used only to decide whether a form is already open, so it
 * short-circuits at the first hit rather than counting them all.
 */
async function hasVisibleForm(page: Page): Promise<boolean> {
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    const loc = frame.locator(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea"
    );
    // One visible box is usually a site search or a newsletter field, not the
    // application. Bulk run, 17 Nov 2026: 207 of 282 careers pages filled 0 because
    // a lone search box made the page look like it already had its form.
    const c = Math.min(await loc.count().catch(() => 0), 40);
    let seen = 0;
    for (let i = 0; i < c; i++) {
      if (await loc.nth(i).isVisible().catch(() => false)) seen++;
      if (seen >= 3) return true;
    }
  }
  return false;
}

const REVEAL_RE = /^(apply now|apply for this (job|position|role|opening)|apply to this (job|role)|apply online|apply here|start (your )?application|i'?m interested|apply)\b/i;

/**
 * Reveal a gated application form.
 *
 * Some boards (Freshteam, some Workday tenants, Lever "apply" landing pages)
 * ship the real form in the DOM but keep it display:none until an "Apply"
 * button is clicked, so introspect correctly sees zero fillable fields on
 * first load. Click Apply ONLY when nothing is fillable yet: that way this
 * never fires once the form is open, and never collides with the final submit
 * (which runs on o.submit at the very end, not here). Discovered 2026-09-06
 * against Noise's Freshteam board, which held 30 fields behind "Apply Now".
 */
/**
 * Broader click than clickByText: the reveal trigger is often a plain anchor
 * or an onclick handler, not a button. Freshteam's is
 * `<a href="#applicant-form" class="btn" onclick="showApplicantForm(...)">`,
 * whose class is "btn" (not "button"), so the navigation-grade clickByText
 * misses it. This one scans anchors and onclick elements too.
 */
async function clickReveal(page: Page, re: RegExp): Promise<boolean> {
  const SEL = 'a, button, [role="button"], input[type="submit"], input[type="button"], [onclick]';
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    const loc = frame.locator(SEL);
    for (const i of await matching(loc, re)) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if (await el.isDisabled().catch(() => false)) continue;
      // A real link is followed in this tab. Clicking it often opens a new tab
      // (target=_blank) that the run never sees, so the form is filled nowhere.
      const href = await el.evaluate((e) => (e as HTMLAnchorElement).href || "").catch(() => "");
      if (href && /^https?:/.test(href) && !/#/.test(href.replace(page.url().split("#")[0] ?? "", ""))) {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        return true;
      }
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function revealGatedForm(page: Page): Promise<void> {
  // Up to three hops: aggregator listing -> its "apply" page -> the company's own job page
  // -> the form. Aggregators often hold the real link behind a short countdown
  // (thejobcompany: "You can apply in 3"), so wait it out before reading the page.
  for (let hop = 0; hop < 3; hop++) {
    if (await hasVisibleForm(page)) return;
    let clicked = await clickReveal(page, REVEAL_RE);
    if (!clicked) {
      if (!/apply in \d|redirecting|please wait/i.test(await page.innerText("body").catch(() => ""))) return;
      await page.waitForTimeout(6000);
      clicked = await clickReveal(page, REVEAL_RE);
      if (!clicked) return;
    }
    await settle(page, 2500);
  }
}

const NEXT_RE = /^(next|continue|save and continue|save & continue|proceed|next step)\b/i;
const SUBMIT_RE = /^(submit application|submit|send application|send|apply now|apply for this (job|role|position)|apply|finish|complete application)\b/i;
const CONFIRM_RE = /(thank you|application (was )?(received|submitted|complete)|we(?:'| ha)ve received|successfully submitted|confirmation)/i;

export const generic: Adapter = {
  name: "generic",
  matches: () => true,

  async prepare(page) {
    // cookie / consent walls first -- they eat clicks
    await clickByText(page, /^(accept all|accept|agree|i agree|got it|allow all|ok)\b/i, 1500).catch(() => {});
    // reveal a form that is gated behind an "Apply" button (Freshteam, some
    // Workday). No-op once the form is already visible.
    await revealGatedForm(page).catch(() => {});
    // open anything collapsed so introspection can see it
    await ensureShim(page);
    await page.evaluate(() => {
      document.querySelectorAll("details:not([open])").forEach((d) => d.setAttribute("open", ""));
      document.querySelectorAll('[aria-expanded="false"]').forEach((el) => {
        const t = (el.textContent || "").toLowerCase();
        if (/(more|section|detail|expand|show)/.test(t) || el.getAttribute("role") === "button") {
          (el as HTMLElement).click();
        }
      });

      /**
       * Accordions that collapse with `max-height: 0; overflow: hidden`
       * instead of `display: none`. Their fields still have a real bounding
       * box, so they look visible -- but they sit outside a clipping ancestor
       * that cannot scroll, so every click on them times out.
       *
       * Un-clip rather than click the header: no site JS is fired, and
       * nothing that was display:none (a genuinely inapplicable branch of the
       * form) is revealed.
       */
      document.querySelectorAll("form *, [role=form] *").forEach((el) => {
        const e = el as HTMLElement;
        if (e.querySelectorAll("input,select,textarea").length < 1) return;
        const cs = getComputedStyle(e);
        if (cs.overflow === "hidden" && cs.maxHeight !== "none" && parseFloat(cs.maxHeight) < 1) {
          e.style.maxHeight = "none";
          e.style.overflow = "visible";
        }
      });
    }).catch(() => {});
    await settle(page, 600);
  },

  async next(page) {
    const ok = await clickByText(page, NEXT_RE);
    if (ok) await settle(page);
    return ok;
  },

  async submit(page) {
    let ok = await clickByText(page, SUBMIT_RE);
    // Some forms label their button with an icon or an odd word. A form with exactly one
    // visible submit-type button has no ambiguity about which button sends it.
    if (!ok) {
      for (const frame of [page.mainFrame(), ...page.frames()]) {
        const btn = frame.locator('form button[type="submit"]:visible, form input[type="submit"]:visible');
        if ((await btn.count().catch(() => 0)) === 1) {
          await btn.first().click({ timeout: 3000 }).catch(() => {});
          ok = true;
          break;
        }
      }
    }
    if (ok) await settle(page, 3000);
    return ok;
  },

  async confirmation(page) {
    // Prefer a node the page itself labelled as the confirmation.
    const el = page.locator(
      '[id*="confirmation" i],[id*="reference" i],[id*="-ref" i],[id$="ref" i],' +
        '[class*="confirmation" i],[data-testid*="confirmation" i]'
    );
    const n = Math.min(await el.count().catch(() => 0), 6);
    for (let i = 0; i < n; i++) {
      if (!(await el.nth(i).isVisible().catch(() => false))) continue;
      const t = ((await el.nth(i).innerText().catch(() => "")) || "").trim().split("\n")[0]!.trim();
      // A tick glyph is not a reference number.
      if (t.length >= 4 && /[a-z0-9]/i.test(t)) return t.slice(0, 80);
    }

    const body = await page.innerText("body").catch(() => "");
    if (!CONFIRM_RE.test(body)) return undefined;
    // An id has to contain a digit -- otherwise "Application Submitted"
    // reports itself as the confirmation number.
    const id = body.match(/\b(?:confirmation|reference|application)\s*(?:id|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
    return id && /\d/.test(id[1]!) ? id[1] : "submitted (no id shown)";
  },
};

export const greenhouse: Adapter = {
  ...generic,
  name: "greenhouse",
  matches: (u) => /greenhouse\.io|grnh\.se/i.test(u),
  async prepare(page) {
    await generic.prepare(page);
    // classic boards embed the form in an iframe; give it time to mount
    await page.waitForSelector("#grnhse_iframe, form", { timeout: 8000 }).catch(() => {});
  },
};

export const lever: Adapter = {
  ...generic,
  name: "lever",
  matches: (u) => /jobs\.lever\.co|jobs\.eu\.lever\.co/i.test(u),
  async prepare(page) {
    await generic.prepare(page);
    // job page -> application page
    if (!/\/apply\b/.test(page.url())) {
      await clickByText(page, /^apply( for this job)?$/i, 2000).catch(() => {});
      await settle(page);
    }
  },
};

export const ashby: Adapter = {
  ...generic,
  name: "ashby",
  matches: (u) => /ashbyhq\.com/i.test(u),
  async prepare(page) {
    await generic.prepare(page);
    if (!/\/application\b/.test(page.url())) {
      await clickByText(page, /^apply( for this job| now)?$/i, 2000).catch(() => {});
      await settle(page);
    }
    // Ashby renders the form client-side after load; reading fields before the
    // system fields appear finds nothing and reports "filled 0".
    await page.waitForSelector('input[id^="_systemfield_"]', { timeout: 15000 }).catch(() => {});
  },
};

/**
 * Workday is the hard one and the honest caveat of this whole tool:
 * every employer runs its own tenant, and every tenant makes you create an
 * account (with email verification) before the form exists. The persistent
 * browser profile keeps that session, so it is a ONE-TIME manual step per
 * company -- after that this adapter drives it.
 */
export const workday: Adapter = {
  ...generic,
  name: "workday",
  requiresAccount: true,
  matches: (u) => /myworkdayjobs\.com|myworkdaysite\.com|wd\d+\.myworkday/i.test(u),

  async prepare(page) {
    await page.waitForSelector("[data-automation-id]", { timeout: 15000 }).catch(() => {});
    await generic.prepare(page);
    await clickByText(page, /^(apply|apply manually|autofill with resume)$/i, 2000).catch(() => {});
    await settle(page);
    // The page shell carries data-automation-id long before the form exists. Zebra, 21 Nov
    // 2026: 0 inputs at 5 s, 16 at 10 s, so reading early filled nothing. Wait for a real box.
    await page.waitForSelector('[data-automation-id="formField-legalNameSection_firstName"] input, input[id$="--firstName"], form input:not([type="hidden"])', { state: "visible", timeout: 25000 }).catch(() => {});
    await settle(page, 800);
  },

  async next(page) {
    const btn = page.locator('button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="wd-CommandButton_uic_nextButton"]');
    if (await btn.first().isVisible().catch(() => false)) {
      const txt = ((await btn.first().innerText().catch(() => "")) || "").trim();
      if (SUBMIT_RE.test(txt)) return false;   // that is the final submit, not a next
      await btn.first().click().catch(() => {});
      await settle(page, 2000);
      return true;
    }
    return generic.next(page);
  },

  async submit(page) {
    const btn = page.locator('button[data-automation-id="bottom-navigation-next-button"]');
    const txt = ((await btn.first().innerText().catch(() => "")) || "").trim();
    if (SUBMIT_RE.test(txt)) {
      await btn.first().click();
      await settle(page, 4000);
      return true;
    }
    return generic.submit(page);
  },
};

const ALL = [greenhouse, lever, ashby, workday];

export function pickAdapter(url: string): Adapter {
  return ALL.find((a) => a.matches(url)) ?? generic;
}
