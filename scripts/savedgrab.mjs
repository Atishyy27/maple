// Read the LinkedIn tab YOU already have open and collect every post link on it.
//
// Strictly read-only: it does not navigate, click, connect, message, save or
// like anything. It scrolls the page you opened, which is the same traffic your
// own thumb makes, and reads the DOM. Nothing else.
//
//   node keepopen.mjs          <- you run this first, in its own terminal
//   node savedgrab.mjs         <- then this
import { chromium } from "playwright";
import fs from "fs";

const out = process.argv[2] || `${process.env.HOME}/Downloads/urls.txt`;
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = b.contexts().flatMap(c => c.pages());
// prefer the saved-posts tab; a stray notifications or feed tab is not it
const page = pages.find(p => p.url().includes("my-items/saved-posts"))
          || pages.find(p => p.url().includes("my-items"))
          || pages.find(p => p.url().includes("linkedin.com"));

if (!page) {
  console.log("no linkedin tab open. pages I can see:");
  pages.forEach(p => console.log("   ", p.url().slice(0, 90)));
  console.log("\nopen https://www.linkedin.com/my-items/saved-posts/ in that window, then run me again.");
  process.exit(1);
}
console.log("reading:", page.url().slice(0, 90));

const collected = await page.evaluate(async () => {
  const seen = new Map();
  const sweep = () => {
    document.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]').forEach(a => {
      const u = a.href.split("?")[0];
      const id = (u.match(/(\d{15,25})/) || [])[1];
      if (id && !seen.has(id)) seen.set(id, u);
    });
    // LinkedIn puts the id in a different attribute every few months
    // (data-urn, data-id, data-chameleon-result-urn ...), so sweep EVERY
    // attribute on the page for an activity urn instead of naming them.
    document.querySelectorAll("*").forEach(el => {
      for (const at of el.attributes) {
        const id = (at.value.match(/urn:li:(?:activity|share|ugcPost):(\d{15,25})/) || [])[1];
        if (id && !seen.has(id))
          seen.set(id, `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`);
      }
    });
  };
  let last = -1, still = 0;
  for (let i = 0; i < 120 && still < 4; i++) {
    sweep();
    if (seen.size === last) still++; else { still = 0; last = seen.size; }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1100));
  }
  sweep();
  return [...seen.values()];
});

fs.writeFileSync(out, collected.join("\n") + (collected.length ? "\n" : ""));
console.log(`\n${collected.length} post links -> ${out}`);
collected.slice(0, 5).forEach(u => console.log("   ", u));
if (collected.length > 5) console.log(`    ... and ${collected.length - 5} more`);
console.log(`\nnext:  python3 ~/Desktop/codes_masti/masti/cnc/me/apps/post2row.py add --file ${out}`);
process.exit(0);   // detach, leave his browser exactly as it was
