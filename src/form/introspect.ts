import type { Page, Frame } from "playwright";
import type { Field } from "../types.js";

/**
 * Reads every fillable control out of the LIVE dom and returns a normalised
 * description of each one.
 *
 * This is the whole point of the project. Nothing below names a selector that
 * belongs to any particular ATS -- when Greenhouse or Workday reshuffles its
 * markup, this keeps working, because it asks the page what is on it instead
 * of asserting what should be.
 *
 * Each control is stamped with data-atsz-ref so Node can address it later
 * without holding an ElementHandle across a re-render.
 */
export async function introspect(scope: Page | Frame): Promise<Field[]> {
  await ensureShim(scope);
  await settleAnimations(scope);
  return scope.evaluate(() => {
    /**
     * Clear marks from the previous pass FIRST.
     *
     * Refs are numbered from zero every time, so on a multi-step form the
     * step-1 controls would still be carrying atsz-0..atsz-6 when step 2 is
     * stamped with the same names. `[data-atsz-ref="atsz-0"]` then matches
     * two elements and .first() picks the old, now-hidden one -- which fills
     * nothing and burns a full actionability timeout doing it.
     */
    document.querySelectorAll("[data-atsz-ref],[data-atsz-group]").forEach((el) => {
      el.removeAttribute("data-atsz-ref");
      el.removeAttribute("data-atsz-group");
    });

    // ---------- helpers, all in-page ----------

    const clean = (s: string | null | undefined): string =>
      (s ?? "")
        .replace(/ /g, " ")
        .replace(/\s+/g, " ")
        .replace(/[*∗]\s*$/, "")
        .replace(/\((required|optional)\)/gi, "")
        .replace(/\s*[:–—-]\s*$/, "")
        .trim();

    /**
     * NOTE: checkOpacity is deliberately OFF.
     *
     * Nearly every modern form fades its step in (`animation: fadeIn .3s`).
     * For those 300ms the computed opacity is < 1, and checkOpacity:true
     * calls a perfectly real, about-to-be-visible field hidden -- so whether
     * the tool sees the form at all becomes a race with the CSS animation.
     * Opacity is checked separately below, and only when nothing is animating.
     */
    const visible = (el: Element): boolean => {
      const anyEl = el as any;
      if (typeof anyEl.checkVisibility === "function") {
        if (!anyEl.checkVisibility({ checkVisibilityCSS: true })) return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;

      const animating =
        typeof document.getAnimations === "function" &&
        document.getAnimations().some((a) => a.playState === "running");

      let node: Element | null = el;
      for (let i = 0; i < 8 && node; i++) {
        const cs = getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (!animating && cs.opacity === "0") return false;
        node = node.parentElement;
      }
      return true;
    };

    /** Attached to a part of the page that is actually on screen right now. */
    const inLivePart = (el: Element): boolean => {
      let node: Element | null = el;
      for (let i = 0; i < 12 && node; i++) {
        const cs = getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };

    /** Text of an element with the values of any controls inside it removed. */
    const ownText = (el: Element): string => {
      const c = el.cloneNode(true) as Element;
      c.querySelectorAll("input,select,textarea,button,option,svg,script,style").forEach((n) => n.remove());
      return clean(c.textContent);
    };

    /**
     * The one concept: an input's human label lives in one of six places.
     * Order matters -- explicit associations beat proximity, proximity beats
     * the attribute names a developer happened to choose.
     */
    const labelFor = (el: Element): string => {
      // 1. aria-labelledby -> concatenated text of the referenced nodes
      const lb = el.getAttribute("aria-labelledby");
      if (lb) {
        const t = lb
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((n) => clean(n!.textContent))
          .join(" ");
        if (t) return t;
      }

      // 2. aria-label
      const al = clean(el.getAttribute("aria-label"));
      if (al) return al;

      // 3. <label for="id">
      const id = el.getAttribute("id");
      if (id) {
        const esc = (window as any).CSS?.escape ? (window as any).CSS.escape(id) : id.replace(/"/g, '\\"');
        const lab = document.querySelector(`label[for="${esc}"]`);
        if (lab) {
          const t = ownText(lab);
          if (t) return t;
        }
      }

      // 4. wrapping <label>
      const wrap = el.closest("label");
      if (wrap) {
        const t = ownText(wrap);
        if (t) return t;
      }

      // 5. fieldset > legend  (this is how radio-group questions are marked up)
      const fs = el.closest("fieldset");
      if (fs) {
        const lg = fs.querySelector("legend");
        if (lg) {
          const t = clean(lg.textContent);
          if (t) return t;
        }
      }

      // 6. proximity: climb a few ancestors, take the nearest short block of
      //    text that sits above the control. Covers every ATS that renders
      //    the question as a plain <div> sibling.
      let node: Element | null = el;
      for (let depth = 0; depth < 5 && node; depth++) {
        node = node.parentElement;
        if (!node) break;
        // a labelled ancestor wins immediately
        const inner = node.querySelector(
          'label,legend,[class*="label" i],[class*="question" i],[data-testid*="label" i]'
        );
        if (inner && !inner.contains(el)) {
          const t = ownText(inner);
          if (t && t.length < 300) return t;
        }
        const t = ownText(node);
        // A slider's live value readout sits right next to it. A string that
        // is only a number/currency is a value, never a question.
        if (t && t.length > 0 && t.length < 300 && !/^[\s$€£₹]*[\d,. ]+[a-z]{0,3}$/i.test(t)) return t;
      }

      // 7. placeholder, then the developer's own naming
      const ph = clean(el.getAttribute("placeholder"));
      if (ph) return ph;
      const nm = el.getAttribute("name") || id || "";
      return clean(nm.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
    };

    const isRequired = (el: Element): boolean =>
      el.hasAttribute("required") ||
      el.getAttribute("aria-required") === "true" ||
      /\*/.test(el.closest("label")?.textContent ?? "") ||
      /required/i.test(el.getAttribute("aria-describedby") ?? "");

    // ---------- kind ----------

    const kindOf = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "combobox" || el.getAttribute("aria-autocomplete") === "list") return "combobox";
      if (el.getAttribute("aria-haspopup") === "listbox") return "combobox";
      if (tag === "textarea") return "textarea";
      if (tag === "select") return "select";
      if (tag === "input") {
        const t = ((el as HTMLInputElement).type || "text").toLowerCase();
        if (["text", "email", "tel", "url", "number", "date", "file", "radio", "checkbox", "range"].includes(t)) return t;
        if (t === "search") return "text";
        return "text";
      }
      if (el.getAttribute("contenteditable") === "true") return "textarea";
      return "unknown";
    };

    // ---------- collect ----------

    const SEL = [
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])",
      "select",
      "textarea",
      '[role="combobox"]',
      '[contenteditable="true"]',
    ].join(",");

    const all = Array.from(document.querySelectorAll(SEL)).filter((el) => {
      // A file input is almost always hidden behind a styled drop zone or a
      // label. It is still the thing you set files on, so it is exempt from
      // the visibility test -- setInputFiles does not need it painted.
      const isFile = (el as HTMLInputElement).type === "file";
      // A file input is almost always zero-sized behind a styled drop zone, so
      // it is exempt from the size/opacity test. It is NOT exempt from
      // display:none -- that is how an inactive wizard step is hidden, and
      // filling those re-uploads the resume on every page.
      if (isFile ? !inLivePart(el) : !visible(el)) return false;
      const a = el as HTMLInputElement;
      if (a.disabled) return false;
      if (a.readOnly && kindOf(el) !== "combobox") return false;
      return true;
    });

    const fields: any[] = [];
    const seenGroups = new Set<string>();
    let n = 0;

    for (const el of all) {
      const kind = kindOf(el);
      const name = el.getAttribute("name") || undefined;

      // radios, and checkboxes that share a name, collapse into ONE field
      // whose options are the individual inputs.
      if ((kind === "radio" || kind === "checkbox") && name) {
        const siblings = Array.from(
          document.querySelectorAll(`input[type="${kind}"][name="${CSS.escape(name)}"]`)
        ).filter(visible) as HTMLInputElement[];

        if (kind === "radio" || siblings.length > 1) {
          const key = `${kind}:${name}`;
          if (seenGroups.has(key)) continue;
          seenGroups.add(key);

          const ref = `atsz-${n++}`;
          siblings.forEach((s, i) => s.setAttribute("data-atsz-ref", `${ref}-${i}`));
          (siblings[0] as Element).setAttribute("data-atsz-group", ref);

          // The group question is the fieldset legend / nearest block, not the
          // label of any single radio -- those are the option texts.
          const fs = siblings[0]!.closest("fieldset");
          const groupLabel = fs?.querySelector("legend")
            ? clean(fs.querySelector("legend")!.textContent)
            : labelFor(siblings[0]!.parentElement?.parentElement ?? siblings[0]!);

          fields.push({
            ref,
            kind,
            label: groupLabel,
            name,
            required: siblings.some(isRequired),
            group: name,
            options: siblings.map((s, i) => ({
              value: `${ref}-${i}`,
              text: labelFor(s) || s.value,
            })),
          });
          continue;
        }
      }

      const ref = `atsz-${n++}`;
      el.setAttribute("data-atsz-ref", ref);

      let options: { value: string; text: string }[] | undefined;
      if (kind === "select") {
        options = Array.from((el as HTMLSelectElement).options).map((o) => ({
          value: o.value,
          text: clean(o.textContent) || o.value,
        }));
      }

      fields.push({
        ref,
        kind,
        label: labelFor(el),
        name,
        id: el.getAttribute("id") || undefined,
        placeholder: el.getAttribute("placeholder") || undefined,
        required: isRequired(el),
        options,
        context: ownText(el.parentElement ?? el).slice(0, 200),
      });
    }

    // ---------- custom widgets ----------
    //
    // Some forms build controls out of plain <div>s with an onclick and no
    // role, no aria-checked, no input. Nothing semantic to query, so these
    // are found by BEHAVIOUR SIGNATURE instead: what does it look and act
    // like. Deliberately conservative -- a false positive here clicks
    // something real on a real employer's page.

    const clickable = (el: Element): boolean =>
      el.hasAttribute("onclick") ||
      el.getAttribute("role") === "button" ||
      getComputedStyle(el).cursor === "pointer";

    const inChrome = (el: Element): boolean => !!el.closest("nav,header,footer,aside,[role=navigation]");
    const hasControl = (el: Element): boolean => !!el.querySelector("input,select,textarea");

    // 1. toggle / switch: one clickable thing carrying a boolean state
    for (const el of Array.from(
      document.querySelectorAll('[role="switch"],[aria-checked],[data-value],[class*="toggle" i],[class*="switch" i]')
    )) {
      if (!visible(el) || inChrome(el) || hasControl(el)) continue;
      if (el.hasAttribute("data-atsz-ref")) continue;
      const dv = (el.getAttribute("data-value") || "").toLowerCase();
      // Require an actual STATE signal. Matching on a class name called
      // "toggle" also catches accordion carets, and clicking one of those
      // collapses a section the form still needs filled.
      const looksBoolean =
        el.getAttribute("role") === "switch" ||
        el.hasAttribute("aria-checked") ||
        dv === "true" ||
        dv === "false";
      if (!looksBoolean || !clickable(el)) continue;

      const ref = `atsz-${n++}`;
      el.setAttribute("data-atsz-ref", ref);
      fields.push({
        ref,
        kind: "toggle",
        label: labelFor(el),
        name: el.getAttribute("data-field") || undefined,
        required: isRequired(el),
        context: `state=${el.getAttribute("aria-checked") ?? dv ?? ""}`,
      });
    }

    // 2. chip / pill group: 3+ sibling elements that are structurally
    //    identical, clickable, and hold short text. That is a multi-select
    //    picker in every design system that ships one.
    const containers = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll("div,ul,section,fieldset"))) {
      const kids = Array.from(el.children);
      if (kids.length < 3 || kids.length > 60) continue;
      if (!visible(el) || inChrome(el) || hasControl(el)) continue;
      const first = kids[0]!;
      const uniform = kids.every(
        (k) =>
          k.tagName === first.tagName &&
          k.className === first.className &&
          clickable(k) &&
          (k.textContent || "").trim().length > 0 &&
          (k.textContent || "").trim().length < 40 &&
          k.children.length === 0
      );
      if (!uniform) continue;
      // keep the innermost such container only
      for (const c of Array.from(containers)) if (c.contains(el)) containers.delete(c);
      containers.add(el);
    }

    for (const el of containers) {
      const ref = `atsz-${n++}`;
      const kids = Array.from(el.children);
      kids.forEach((k, i) => k.setAttribute("data-atsz-ref", `${ref}-${i}`));
      fields.push({
        ref,
        kind: "chips",
        label: labelFor(el),
        required: isRequired(el),
        options: kids.map((k, i) => ({ value: `${ref}-${i}`, text: clean(k.textContent) })),
      });
    }

    return fields;
  }) as Promise<Field[]>;
}

/**
 * esbuild (which tsx uses) compiles named inner functions with a `__name()`
 * helper call. page.evaluate ships only the function body to the browser, so
 * that helper is undefined there and every evaluate with a named inner
 * function throws "__name is not defined". Defining it in the page first
 * costs nothing and is a no-op under compiled output.
 *
 * Passed as a STRING deliberately -- a function argument would itself be
 * transformed and hit the same problem.
 */
export async function ensureShim(scope: Page | Frame): Promise<void> {
  await scope.evaluate("globalThis.__name = globalThis.__name || function (f) { return f }").catch(() => {});
}

/**
 * Block until nothing on the page is mid-animation, so a form that fades in
 * is read at its settled size and opacity. Capped, because an infinite
 * spinner would otherwise hang the run forever.
 */
export async function settleAnimations(scope: Page | Frame, timeout = 3000): Promise<void> {
  await scope
    .waitForFunction(
      "typeof document.getAnimations !== 'function' || document.getAnimations().every(a => a.playState !== 'running')",
      undefined,
      { timeout }
    )
    .catch(() => {});
}

/** Every frame on the page, so iframe-embedded boards (Greenhouse classic) work. */
export function scopes(page: Page): (Page | Frame)[] {
  return [page, ...page.frames().filter((f) => f !== page.mainFrame())];
}
