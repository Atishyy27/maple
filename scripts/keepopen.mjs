// Launch a headed browser with CDP on 9222 and HOLD it open.
// The previous attempt called process.exit(0) right after launch, which killed
// the browser it had just created. The whole job of this file is to not exit.
import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext("var/browser-profile", {
  headless: false, viewport: null,
  args: ["--remote-debugging-port=9222", "--disable-blink-features=AutomationControlled", "--no-sandbox"],
});
console.log(`browser up on 9222, pages=${ctx.pages().length}`);
await new Promise(() => {});   // never resolves: the process is the browser's lifeline
