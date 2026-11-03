# Maple

**Ma**ss **Apl**y **E**fficiently. Maple reads a job application form live, fills it from your own data, and stops so you can review and submit.

It runs locally, needs no account or API key, and contacts only the job page itself.

## Rules it never breaks

- It does not guess. A field it cannot answer confidently stays blank and goes to `var/unanswered.log`.
- It does not submit for you, and it does not touch captchas.
- It only uses facts from your own profile and answer bank.

## Quick start

```sh
npm ci
npx playwright install chromium
npm run serve      # terminal 1: mock job boards on :3939
npm run demo       # terminal 2: fills both, submits nothing
npm test           # resolver fuzz test
npm run typecheck
```

For real use, copy `fixtures/demo-profile.yaml` to `profile.yaml` and `fixtures/demo-answers.yaml` to `answers.yaml`, then fill them in. Both are git-ignored.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what is built and what is next.

Maple grew out of a take-home assignment for a company called Tsenta. It reverses that assignment's main trade-off, described below, and has no connection to the company.

## What is different from the take-home

The take-home used a **Strategy Pattern with hardcoded selectors** per ATS
(`#first-name`, `#g-fname`). That is fast and deterministic against a mock site
that never changes. Against real boards it is the whole problem: Greenhouse,
Lever and Workday reship their markup, and every id in that file dies with it.

Here, **no field selector is hardcoded anywhere.** At runtime the tool reads
the live DOM, resolves each control's human label, and matches that label
against your answers. Per-platform code is reduced to *navigation only* --
which button pages forward, which one submits.

```
src/form/introspect.ts   live DOM  -> Field[]     <- the core
src/form/aliases.ts      label phrase -> profile key
src/form/resolve.ts      Field    -> value        <- the matcher
src/form/fill.ts         value    -> typed in
src/ats/adapters.ts      next / submit / confirmation only
src/profile/fromCv.ts    CV pdf   -> profile.yaml
```

## Measured

Run against two mock boards written for this repo (`npm run serve` + `npm run demo`).
They are not a toy: each one reproduces a pattern that actually broke a live run.

| board | shape | what it is there to catch |
|-------|-------|---------------------------|
| northwind | 3-step wizard | `aria-labelledby` labels with no `<label for>`, a button combobox over a `role=listbox`, **a field that does not exist in the DOM until a specific option is chosen**, digits-only phone validation, and repeating rows with generated id prefixes |
| vertex | single page | clean labels, a name-variant leak trap (middle/maiden/father/nominee must stay blank), proximity-only captions, `role=radio` experience brackets, an unanswerable "excluding internships" field, and a consent box that must stay unticked |

The previous fixtures were the ones supplied with a company's take-home and were
branded as such, so they were removed rather than republished. These are written
from scratch, which also makes the numbers honest: the old boards were the ones
the design had been written against.

CV import, against a generated one-page CV: 16 of 25 profile fields extracted
(name, email, phone, LinkedIn, GitHub, portfolio, school, degree, major, grad
year, 14 skills, city/country). The remaining 9 are things a CV does not state
-- salary expectation, notice period, work authorisation -- and are written as
TODO.

### The one concept: label resolution

An input's human label lives in one of six places, and the order matters --
explicit associations beat proximity, proximity beats whatever the developer
named the variable:

1. `aria-labelledby` -> text of the referenced nodes
2. `aria-label`
3. `<label for="id">`
4. a wrapping `<label>`
5. `<fieldset><legend>` (this is how radio-group *questions* are marked up --
   the individual radios' labels are the *options*, not the question)
6. proximity: nearest short text block in the ancestor chain
7. fallback: `placeholder`, then the humanised `name`/`id`

Get this right once and one mapper covers every board. Get it wrong and you
have written a per-ATS selector file with extra steps.

### Matching

`score(alias, label)` in `resolve.ts`. The load-bearing term is the penalty on
**unexplained label tokens**: every token in the label the alias fails to
account for costs 0.15. That is what stops the alias `name` from claiming the
label `Last Name` -- it covers the alias completely, but leaves `last`
unexplained, so it loses to `last name`.

Precedence: `answers.yaml` (hand-written) > profile field > boolean default.
Below the confidence threshold nothing is filled -- the label is written to
`var/unanswered.log` instead. **A field is never guessed at.**

## Setup

```sh
npm install
npx playwright install chromium
```

## Prove it works before pointing it at a real employer

```sh
npm run serve      # terminal 1: serves the two mock boards on :3939
npm run demo       # terminal 2: fills both, submits nothing
npm run demo -- --submit    # fills and submits, against the mocks only
```

Record the numbers from a clean run and treat a drop as the regression telling
you. Coverage alone is not the metric: a wrong value is worse than a blank, so
check the leak traps on vertex stayed empty.

## Use

```sh
# 1. build profile.yaml from your CV (deterministic, no LLM)
npm run profile -- cv/my-cv.pdf

# 2. fill the TODOs it leaves. A TODO means "no answer", not "guess".
$EDITOR profile.yaml answers.yaml

# 3. see what the mapper actually sees on a real posting (read-only)
npm run fields -- 'https://job-boards.greenhouse.io/<co>/jobs/1234567'

# 4. fill without submitting, in a browser that outlives the run
npm run browser                      # terminal 1: keep this open
npm run apply -- --attach --cv cv/ai.pdf --url '<job-url>'

# 5. put URLs in jobs.txt, then for real
npm run apply -- --submit
```

Submitting is **opt-in**. The default fills the form, screenshots it, and
leaves the browser open for you to check.

## Growing the answer bank

`var/unanswered.log` gets one JSON line per field that had no confident match,
carrying the exact label the board used. Paste that label into `answers.yaml`
as a new `match` phrase. After ~20 applications the bank covers nearly
everything, and the log goes quiet. That loop is the product -- there is no
model in the path, so the coverage is exactly what you put in.

### Delete by index took an unrelated row with it (Deutsche Bank, 6 Oct 2026)

A stray click created an empty `Certifications` row. Workday then blocked the whole step
with "The field Certification is required and must have a value". Deleting that row by its
button index also deleted the **Education** row, because after the re-render the two
sections' Delete buttons shared an index.

So the existing rule "never delete a row by page-wide index" is not enough on its own.
The working pattern, now in `db-apply.mjs`:

1. Map every `Add` / `Delete` button to its owning section heading by walking up the DOM
   **before** clicking anything, and click by section, never by bare index.
2. Never let an empty row be created in a section you do not intend to fill.
3. Fill every repeating row in ONE pass, then save once. Saving between rows is what
   loses rows.
4. After the save, count the rows back out of the page text and log the count.

`db-apply.mjs` is the whole DB flow end to end on an already-signed-in browser, and it
stops before the terms tick and Submit by design.

### The fixtures found a real bug the day they were written (6 Oct 2026)

First run against the new `vertex` board filled **"Years of experience excluding
internships"** with `1-3` at 0.80 confidence. That field has no true answer for a
student: excluding internships the count is zero, and no form offers zero.

Root cause: the unexplained-token penalty is a *scoring* heuristic, not a semantics
check. "excluding internships" is two extra tokens, costing 0.30, which a strong base
match absorbs. A phrase that **inverts** a field's meaning can never be out-scored
reliably, so it has to be denied outright.

Fix: an `UNANSWERABLE` deny-list in `resolve.ts`, checked right after the name-variant
guard. Add a phrase whenever a form invents a new way to ask. After the fix the vertex
board fills 12 instead of 13 and all six leak traps hold.

That is the argument for keeping purpose-built fixtures rather than a company's: these
boards are written to catch the failures that actually happened in the field, so a
regression shows up in `npm run demo` instead of on a real employer's form.

### EA: --wait can never fire, because register and apply are the same page (8 Oct 2026)

`--wait` parks until a form appears that is NOT an auth gate, and it classifies any
page carrying a password field as a gate. EA puts account creation and the
application on one page, so the password field never goes away and the loop waits
out its full timeout reporting `filled 0`. It is not a bug in the detection; the
premise that a gate is a separate step is just false here.

Two consequences, both learned the expensive way:

1. On EA the tool contributes nothing. Fill it by hand, or drive it over CDP, but do
   not spend a 10-minute wait on it.
2. **Everything on that page is lost if the browser closes.** It is one form with one
   submit, so there is no server-side draft, unlike Workday which saves per step.
   A 600-second run expiring took the whole thing with it: city fix, phone fix,
   gender and all three job-specific answers.

Rule: before driving a single-page application over CDP, check what owns the
browser's lifecycle. If a `--wait` run launched it, that run's timeout is a deadline
on your work.

### Picking a react-select option: it must START with the term, never merely contain it

Twice now, typing "India" into a country dropdown has selected **British Indian
Ocean Territory +246**, because its name contains "Indian" and it sorts first.

- HackerRank, 8 Oct: pressing Enter took whatever was highlighted. Caught only
  because the committed value was verified before submit.
- Instawork, 9 Oct: the fix from the day before was still wrong. The matcher looked
  for `^India$` while the option text is `India +91`, found nothing, and fell back
  to the first option *containing* "India". Same wrong country, new route.

The rule that actually holds:

1. Never commit with `Enter`. Click the option element.
2. Match on the option STARTING with the term: `/^India\s*\+91$/`, not `/India/`.
3. Narrow the search text so the right option is in the short list. Typing `91`
   returns four options; typing `India` returns the trap first.
4. Verify against `.select__single-value`, what the control renders. The visible
   `<input>` is a search box that clears after selection, so `input.value` is empty
   even on a correct pick and will tell you a filled field is blank.

A wrong country on a submitted application is worse than a blank one: a blank gets
queried, a wrong value gets believed.

## Google Forms, honestly

Verified on the Retape AI application, 1 Oct 2026: **12 of 13 fields in 7.2 seconds**,
headed, against a profile already signed in to Google. Faster and cleaner than any
Workday run. But it can never finish the job, for one structural reason.

1. **A file-upload question is a Drive picker in a cross-origin iframe.** There is no
   `<input type=file>` anywhere in the page, so there is nothing to set and nothing for
   the mapper to even report as skipped. If the upload is required, the form cannot be
   submitted by this tool, full stop. Fill everything else and hand the window over.
2. **Never let it sign in to Google for you.** Signing in from an automated browser
   triggered identity verification, including a selfie prompt, on a real account on
   25 Sep 2026. That is an account-risk event. Sign in by hand in the window `--wait`
   opens, or start the browser yourself and attach.
3. **Choices are `role="radio"` toggles carrying the OPTION text as their label**, not
   real inputs. Two lines in `answers.yaml` per option that is TRUE for you, answered
   `"yes"`, and the toggle handler reads `aria-checked` and clicks only if it differs.
4. **"Collect email addresses" adds a consent toggle whose label contains the live
   signed-in address**, e.g. `Record you@example.com as the email to be included with
   my response`. Match on the invariant tail, never on the address.
5. **Run it from a real terminal.** A run driven from an agent harness can be killed on
   a background timer, and killing the process closes the browser and takes the filled
   form with it. Start the browser separately with `npm run browser` and pass
   `--attach`: the run then only connects and disconnects, so the window survives.

### ERR_INTERNET_DISCONNECTED when the network is fine (6 Oct 2026)

A run died with `page.goto: net::ERR_INTERNET_DISCONNECTED` while `curl` reached the same
host with HTTP 200 and Google resolved. The network was never the problem. A Chromium from
an earlier killed run was still alive and still holding `SingletonLock`, `SingletonSocket`
and `SingletonCookie` in `var/browser-profile/`, and every new launch inherited a broken
network service from it.

Fix, in this order:

```sh
pkill -f "tsx src/cli.ts apply"
pkill -f "Chrome for Testing"
rm -f var/browser-profile/Singleton{Lock,Socket,Cookie}
```

Then probe before spending a sign-in on it: `npm run apply -- --headless --url '<url>'`.
A healthy probe prints `step 1: filled 0` on a job-description page. A broken one prints
the disconnect again. Nothing is lost by killing here, because a page that never loaded
left no session to flush.

## Workday, honestly

Greenhouse / Lever / Ashby are single-page forms and work end to end.

**Workday does not, on the first run for a given employer.** Every company runs
its own tenant and forces account creation with email verification before the
form exists. No tool can automate that away without owning your mailbox.

What this does instead: one persistent browser profile at
`var/browser-profile/`. Sign in to a tenant by hand once, in the window the
tool opens; the cookies live in that profile and every later run against that
employer is already authenticated. So it is one manual signup per company, not
per job.

### Learned on the first live tenant, GE Vernova, 25 Sep 2026

1. **`fields` is the wrong first command on a gated tenant.** `inspectOnly` closes
   the context the moment it prints, so there is no window to sign in through.
   Use `apply` without `--submit`: `cli.ts` sets `keepOpen` for a single URL with
   no submit and not headless, which blocks on the browser until Ctrl-C. That
   pause is the sign-in window.
2. **The posting URL is not the form URL.** A Workday job-description page has no
   inputs, so the mapper correctly reports `0 fields discovered`. That is an
   honest answer, not a failure, and it looks identical to one. Sign in, click
   Apply, reach the real form, copy *that* URL from the address bar, run again.
3. **A referral binds to an email address, not to a name.** The invite mail says
   to register with the address it was sent to. Register with any other address
   and the referral silently detaches from the application. Check
   `profile.yaml: email` matches the invite before the first run on that tenant.
4. **`resumePath` rots.** It held an absolute path that was wrong in three ways
   at once (missing a directory segment, a folder that had since been renamed,
   and the wrong variant). A broken upload path fails quietly. Re-point it at the
   target-specific CV as step zero of every application, not as an afterthought.
5. **`referralSource` is a real field, not boilerplate.** It defaulted to
   "Company website". On a referred application that is the field that decides
   whether the referrer gets credit. Set it per application.
6. **The 8s default timeout is tight for Workday**, which renders lazily. A
   suspiciously short field list is more likely a timeout than a mapper failure.
   Raise it before blaming the label resolver.

### The loop to run after every application

- Read `var/unanswered.log`, paste each new label into `answers.yaml`.
- Anything the tenant did that surprised you goes in this section, same day.
- Re-point `profile.yaml: resumePath` and `referralSource` for the next target.
- If a field was filled *wrong* rather than skipped, raise `--threshold` and
  record the label here; a confident wrong answer is worse than a skip.

## Multi-entry sections: the rule that makes this sellable

Learned the hard way on GE Vernova's Workday tenant, 25 Sep 2026, across an hour and two
rounds of silent data loss. This is the single behaviour that separates a demo autofiller
from something you could charge for.

**Workday persists only the rows you touched in the current pass.** Work Experience,
Education and Websites are repeating panels. If a pass types into rows 3 and 4 and leaves
rows 1 and 2 alone, the save writes 3 and 4 and **silently drops 1 and 2**. The DOM keeps
rendering all four afterwards, so nothing looks wrong until the Review page, several steps
later, shows half the record gone. It is not a delete, not a validation failure, and it
produces no error.

Three rules follow, and all three are non-negotiable:

1. **Re-assert every row before every save.** Before clicking Save and Continue on a
   repeating section, write every row's values back into every row, including ones already
   correct and ones the parser filled. Cheap, idempotent, and the only thing that makes the
   save whole.
2. **Never click a Delete button located by index.** These panels all render a button
   labelled "Delete", and a page-wide `getByRole("button", {name: /delete/i}).nth(i)` walks
   across sections. On the GE run this removed two work-experience entries while the caller
   believed it was clearing empty Website slots, and the DOM count stayed the same
   afterwards so the mistake was invisible. Scope every delete to the row's own container,
   or do not delete at all.
3. **Verify after save, not after the run.** Capture intended state before the save,
   re-read persisted state after it, diff, and fail loudly on drift. Three separate rounds
   of loss on the GE run would each have been caught in seconds by a diff, instead of being
   discovered on the Review page at the end. A form-filler that cannot prove its own writes
   survived is not a product.

**Corollary for the honeypot and the format-sensitive fields:** a confident wrong value is
worse than a skip, and a silently dropped row is worse than both, because a skip is at least
visible in `var/unanswered.log`.

## Limits

- **Google-authenticated forms are out of scope. Do not attempt them.** Signing in
  to Google from this tool's Chromium profile triggers identity verification
  (`myaccount.google.com/verification/selfie/...`), which needs a live face on
  camera and cannot be automated. Worse, repeatedly tripping Google's
  anti-automation challenges risks the account itself, and that account holds his
  mail, his applications and any referral bindings. Hit on a Google Forms
  application, 25 Sep 2026; backed out deliberately. Fill those by hand in the
  normal browser. Same reasoning as the LinkedIn auto-send refusal: the tool is
  capable, the account risk is not worth one form.
- No CAPTCHA solving. If one appears, solve it in the open window.
- Sign-in and sign-up walls are filled with nothing (`src/form/gate.ts`). Fynd's posting
  redirects to a login page whose only box is "Email or phone number", and on 2 Nov 2026
  the phone alias typed into it. Sign in by hand, then run again.
- `--headless` is not advised for Workday; its SPA behaves differently.
- Resume parsing is regex over PDF text. It fills what it can prove and marks
  the rest TODO. Two-column CV layouts extract worst -- check the output.
- Custom widgets (chip pickers, div toggles) are found by behaviour signature,
  not by ARIA, because plenty of them ship with no ARIA at all. That detection
  is deliberately conservative: it needs a real state attribute on a toggle,
  and 3+ structurally identical clickable siblings for a chip group. Widgets
  that meet neither bar are skipped and logged, not guessed at.
- Live runs so far are single postings, not a measured batch: Enterpret on
  Greenhouse filled 11 of 11 fields on 2 Nov 2026, after the cover-letter fix
  below. Run `npm run fields -- <real-url>` first on a new board.

### Greenhouse: the CV went into the cover-letter slot (Enterpret, 2 Nov 2026)

Both upload buttons are labelled "Attach". Only the hidden input ids, `resume` and
`cover_letter`, say which is which. The resolver read the label alone and fell back
to the CV for any file input, so both slots got the CV. It now reads the id, name
and surrounding text, and leaves a cover-letter slot empty when no cover letter is
on file. `test/upload-slots.ts` holds the case.
- No LLM. Novel essay questions go to `unanswered.log` for you to answer once,
  by design. An LLM fallback would slot into `resolve.ts` behind the same
  `Resolved | null` return.

## Identity

This tree is `Atishyy27` only -- see `../README.md` for how that is pinned.
