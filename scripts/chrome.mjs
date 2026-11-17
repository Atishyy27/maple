// Start your installed Brave, Chrome or Edge with CDP on 9222 for `apply --attach`.
// Playwright's own launcher adds --enable-automation, and Lever's hCaptcha rejects
// the submit even when a human clicks it. A plain Chrome started by us has no such flag.
// Chrome only allows remote debugging on a non-default profile, so Maple keeps its own.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  process.env.MAPLE_CHROME,
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.error("no Chrome or Edge found; set MAPLE_CHROME to its path, or use `npm run browser:bundled`");
  process.exit(1);
}

const profile = resolve("var/chrome-profile");
mkdirSync(profile, { recursive: true });
const child = spawn(exe, [
  "--remote-debugging-port=9222",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  ...(process.argv.includes("--headless") || process.env.MAPLE_HEADLESS ? ["--headless=new", "--window-size=1366,900"] : []),
], { detached: true, stdio: "ignore" });
child.unref();

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const v = await (await fetch("http://127.0.0.1:9222/json/version")).json();
    console.log(`browser up on 9222: ${v.Browser} (${exe})`);
    process.exit(0);
  } catch {}
}
console.error("Chrome started but 9222 did not answer; is another Chrome already using this profile?");
process.exit(1);
