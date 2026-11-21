import type { Page, Frame } from "playwright";
import path from "node:path";
import type { Resolved } from "../types.js";
import { matchOption, boolOption, norm } from "./resolve.js";

export type FillOpts = {
  /** ms of jitter between keystrokes. 0 = instant fill. */
  humanDelay?: number;
};

const sel = (ref: string) => `[data-atsz-ref="${ref}"]`;

/**
 * Real click first, synthetic click as fallback.
 *
 * Custom widgets built from <div>s carry an onclick handler, so dispatching
 * the event directly is equivalent to a user click -- and it still works when
 * the element cannot be scrolled to because a clipping ancestor has no
 * scrollable overflow.
 */
async function clickWidget(scope: Page | Frame, selector: string) {
  const loc = scope.locator(selector).first();
  try {
    await loc.click({ timeout: 2500 });
  } catch {
    await loc.evaluate((el: any) => el.click());
  }
}
const jitter = (base: number) => Math.floor(base * (0.6 + Math.random() * 0.9));

async function typeInto(scope: Page | Frame, ref: string, text: string, o: FillOpts) {
  const loc = scope.locator(sel(ref)).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await loc.click({ timeout: 5000 }).catch(() => {});
  await loc.fill("", { timeout: 3000 }).catch(() => {});
  if (!o.humanDelay) {
    await loc.fill(text);
  } else {
    await loc.pressSequentially(text, { delay: jitter(o.humanDelay) });
  }
  // Some React forms only commit on blur.
  await loc.evaluate((el: any) => el.dispatchEvent(new Event("change", { bubbles: true }))).catch(() => {});
}

/**
 * Custom dropdowns (react-select on Greenhouse/Lever/Ashby, Workday's button
 * + listbox). Type, wait for the popup to render, click the closest option.
 * Deliberately text-driven, not index-driven -- these lists reorder.
 */
async function fillCombobox(scope: Page | Frame, ref: string, want: string, o: FillOpts) {
  const loc = scope.locator(sel(ref)).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await loc.click({ timeout: 5000 });
  await loc.fill("").catch(() => {});
  await loc.pressSequentially(want.slice(0, 24), { delay: jitter(o.humanDelay || 30) }).catch(async () => {
    await loc.type(want.slice(0, 24));
  });

  // Visible options only, and never the phone-number country picker (intl-tel-input renders its
  // ~240 hidden <li role="option" class="iti__country"> on the same page; Agoda, 21 Nov 2026).
  const popup = scope.locator('[role="option"]:visible, [role="listbox"] li:visible, .select__option:visible, [class*="option" i]:visible').filter({ hasNot: scope.locator(".iti__country") }).and(scope.locator(":not(.iti__country)"));
  try {
    await popup.first().waitFor({ state: "visible", timeout: 4000 });
  } catch {
    await loc.press("Enter").catch(() => {});
    return;
  }

  const n = Math.min(await popup.count(), 25);
  let bestIdx = -1, bestScore = 0;
  const w = norm(want);
  for (let i = 0; i < n; i++) {
    const t = norm((await popup.nth(i).innerText().catch(() => "")) || "");
    if (!t) continue;
    const s = t === w ? 1 : t.startsWith(w) || w.startsWith(t) ? 0.9 : t.includes(w) ? 0.75 : 0;
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  if (bestIdx >= 0) await popup.nth(bestIdx).click();
  else await loc.press("Enter").catch(() => {});
}

/** Put one resolved value onto the page. Returns false if it could not. */
export async function fillField(scope: Page | Frame, r: Resolved, o: FillOpts = {}): Promise<boolean> {
  const { field } = r;

  // For anything with a fixed option list, a confident label match is not
  // enough -- the value still has to exist as an option. Walk the ranked
  // candidates until one lands.
  if (["select", "radio", "checkbox", "combobox", "chips", "toggle"].includes(field.kind) && r.alts?.length) {
    for (const v of [r.value, ...r.alts]) {
      if (await fillOne(scope, { ...r, value: v }, o)) return true;
    }
    return false;
  }
  return fillOne(scope, r, o);
}

async function fillOne(scope: Page | Frame, r: Resolved, o: FillOpts): Promise<boolean> {
  const { field, value } = r;

  try {
    switch (field.kind) {
      case "file": {
        const p = String(value);
        if (!p) return false;
        await scope.locator(sel(field.ref)).first().setInputFiles(path.resolve(p));
        return true;
      }

      case "select": {
        const opts = field.options ?? [];
        const pick =
          typeof value === "boolean"
            ? boolOption(opts, value)
            : matchOption(opts, Array.isArray(value) ? value[0] ?? "" : String(value));
        if (!pick) return false;
        await scope.locator(sel(field.ref)).first().selectOption(pick.value);
        return true;
      }

      case "radio": {
        const opts = field.options ?? [];
        const pick =
          typeof value === "boolean"
            ? boolOption(opts, value)
            : matchOption(opts, Array.isArray(value) ? value[0] ?? "" : String(value));
        if (!pick) return false;
        await scope.locator(sel(pick.value)).first().check({ force: true });
        return true;
      }

      case "checkbox": {
        const opts = field.options ?? [];
        if (opts.length) {
          // group of checkboxes: tick every option that matches a wanted value
          const wants = Array.isArray(value) ? value : typeof value === "boolean" ? [] : [String(value)];
          if (typeof value === "boolean") {
            const pick = boolOption(opts, value);
            if (!pick) return false;
            await scope.locator(sel(pick.value)).first().check({ force: true });
            return true;
          }
          let any = false;
          for (const w of wants) {
            const pick = matchOption(opts, w);
            if (pick) { await scope.locator(sel(pick.value)).first().check({ force: true }); any = true; }
          }
          return any;
        }
        const loc = scope.locator(sel(field.ref)).first();
        if (value === false) await loc.uncheck({ force: true });
        else await loc.check({ force: true });
        return true;
      }

      case "toggle": {
        // Read the live state, then click only if it differs. Clicking blind
        // turns a correct answer into a wrong one half the time.
        const want = typeof value === "boolean" ? value : /^(true|yes|y|1)$/i.test(String(value));
        const loc = scope.locator(sel(field.ref)).first();
        const now = await loc.evaluate((el: any) => {
          const ac = el.getAttribute("aria-checked");
          if (ac !== null) return ac === "true";
          const dv = (el.getAttribute("data-value") || "").toLowerCase();
          if (dv === "true" || dv === "false") return dv === "true";
          return /\b(on|active|checked|selected)\b/i.test(el.className || "");
        });
        if (now !== want) await clickWidget(scope, sel(field.ref));
        return true;
      }

      case "chips": {
        const opts = field.options ?? [];
        const wants = Array.isArray(value)
          ? value
          : typeof value === "boolean"
            ? [value ? "Yes" : "No"]
            : [String(value)];
        let any = false;
        for (const w of wants) {
          const pick = matchOption(opts, w);
          if (!pick) continue;
          const loc = scope.locator(sel(pick.value)).first();
          const already = await loc.evaluate((el: any) =>
            el.getAttribute("aria-selected") === "true" ||
            el.getAttribute("aria-pressed") === "true" ||
            /\b(selected|active|checked|on)\b/i.test(el.className || "")
          ).catch(() => false);
          if (!already) await clickWidget(scope, sel(pick.value));
          any = true;
        }
        return any;
      }

      case "combobox": {
        const want = Array.isArray(value) ? value[0] ?? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
        if (!want) return false;
        await fillCombobox(scope, field.ref, want, o);
        return true;
      }

      case "range": {
        // Typing into a slider does nothing. Set the value and fire the
        // events the page listens for, then let the page clamp it.
        const n = String(value).replace(/[^\d.-]/g, "");
        if (!n) return false;
        await scope.locator(sel(field.ref)).first().evaluate((el: any, v: string) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter ? setter.call(el, v) : (el.value = v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, n);
        return true;
      }

      case "date": {
        const v = String(value);
        await scope.locator(sel(field.ref)).first().fill(v);
        return true;
      }

      default: {
        const v = Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
        if (!v) return false;
        await typeInto(scope, field.ref, v, o);
        return true;
      }
    }
  } catch (e: any) {
    lastFillError = String(e?.message ?? e).split("\n")[0]!.slice(0, 120);
    return false;
  }
}

/** Reason the most recent fill failed, for the unanswered log. */
export let lastFillError = "";
