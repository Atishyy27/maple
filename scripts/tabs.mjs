// Close stray tabs in Maple's browser without ever killing it.
//   node scripts/tabs.mjs close-stray     -> close finished/blank/listing tabs, keep the rest
//   node scripts/tabs.mjs list
// Never closes the last tab: closing it shuts the browser and drops every login session.
// That is how four signed-in Zebra applications were lost on 21 Nov 2026.
const BASE = "http://127.0.0.1:9222";
const KEEP = /myworkday(jobs|site)\.com\/.+\/apply|\/application\b|applyManually|jobs\.lever\.co\/.+\/apply|greenhouse\.io\/.+\/jobs\//i;

async function tabs() {
  const r = await fetch(`${BASE}/json/list`);
  return (await r.json()).filter((t) => t.type === "page");
}

const cmd = process.argv[2] || "list";
const all = await tabs().catch(() => null);
if (!all) { console.log("browser not running on 9222"); process.exit(0); }
if (cmd === "list") {
  for (const t of all) console.log(KEEP.test(t.url) ? "keep " : "stray", t.url.slice(0, 110));
} else if (cmd === "close-stray") {
  const stray = all.filter((t) => !KEEP.test(t.url));
  const keepCount = all.length - stray.length;
  // leave one tab open if everything is stray
  const toClose = keepCount > 0 ? stray : stray.slice(0, -1);
  for (const t of toClose) await fetch(`${BASE}/json/close/${t.id}`).catch(() => {});
  console.log(`closed ${toClose.length} of ${all.length} tabs; ${all.length - toClose.length} left open`);
}
