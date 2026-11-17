# Maple

Fills job application forms for me. A Node + Playwright command-line tool. No AI, no API key.

It reads each field's label on the page, matches it against two files I wrote (`profile.yaml`
and `answers.yaml`), fills what it is sure about, and leaves the rest blank. It never guesses.

Works on Greenhouse, Lever, Ashby, Workday, plain careers-page forms, and Google Forms
(when signed in). Runs in my own Brave, with or without a window.

## Setup (once)

```sh
npm install
npm run profile -- path/to/cv.pdf     # writes profile.yaml from the CV; fix any TODO in it
```

Edit `answers.yaml` for the usual questions (notice period, why this company, and so on).

## Apply to one job

```sh
npm run browser                        # starts Brave on port 9222 (add -- --headless for no window)
npx tsx src/cli.ts apply --attach --cv path/to/cv.pdf --url <job link>
```

The filled tab stays open. Fill anything it left blank (CTC, for example), then press Submit.

To let it press Submit too, add `--submit`. It submits only when it filled 3 or more fields and
no required field is empty.

## Apply to many jobs

Make a file with one job per line: `row<TAB>company<TAB>link`. Then:

```sh
bash scripts/bulk-submit.sh jobs.tsv path/to/cv.pdf
```

Results go to `jobs-results.tsv`, one line per job. Only one bulk run can go at a time, and a
link that was already submitted (listed in `var/submitted.txt`) is never submitted again.

## Make it fill more

Every question it skipped is in `var/unanswered.log`. Add the question and your answer to
`answers.yaml`; the next run fills it.

## Logins

Maple's Brave is a separate profile (browsers do not allow automating your main one). Sign in
to Google, LinkedIn or Workday once in that window and it remembers.

## What it cannot do

- Salary or CTC fields: left blank on purpose, you type them.
- Forms that appear only after clicking "Apply" on a listing page: often fills nothing.
- Greenhouse's hidden captcha can reject an automated Submit; press it yourself there.
- Pages that need a login you have not done in Maple's Brave.

## Test

```sh
npm test
```

Longer notes, bugs found on real forms, and platform details: [docs/NOTES.md](docs/NOTES.md).
