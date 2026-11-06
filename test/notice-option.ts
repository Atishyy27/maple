import assert from "node:assert/strict";
import { matchOption } from "../src/form/resolve.ts";

const lever = ["Select", "Immediately available", "15 days (or less)", "30 days", "60 days", "90 days", "More than 90 days", "45 days"]
  .map((t) => ({ value: t === "Select" ? "" : t, text: t }));

assert.equal(matchOption(lever, "0")?.text, "Immediately available");
assert.equal(matchOption(lever, "30")?.text, "30 days");
assert.equal(matchOption([{ value: "a", text: "Yes" }, { value: "b", text: "No" }], "0"), undefined);
console.log("notice-option: ok");
