#!/usr/bin/env bash
# Fill and submit every job in a TSV (row<TAB>company<TAB>url), one at a time, through the
# browser already running on port 9222. One result line per job, so a crash loses nothing.
#   bash scripts/bulk-submit.sh jobs.tsv /path/to/cv.pdf
#
# Two guards, both added after 17 Nov 2026, when a stopped run kept going in the background
# and a second run started beside it: 6 companies got the same application 2-3 times.
#   1. A lock file: a second copy refuses to start while one is running.
#   2. var/submitted.txt: every URL that was ever submitted. A URL in it is never tried again.
IN="$1"; CV="$2"; OUT="${IN%.tsv}-results.tsv"
cd "$(dirname "$0")/.."
LOCK=var/bulk.lock; DONE=var/submitted.txt
touch "$DONE"
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "another bulk run is going (pid $(cat "$LOCK")); stop it first"; exit 1
fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK" "$SEEN"' EXIT
# Everything already applied to: this file plus the ledger, with links normalised (query string,
# trailing slash and /apply suffixes stripped), so a re-linked posting still counts as seen.
SEEN=$(mktemp); node scripts/seen-urls.mjs list > "$SEEN"
total=$(wc -l < "$IN"); i=0
while IFS=$'\t' read -r row company url; do
  i=$((i+1)); url="${url%$'\r'}"
  key=$(node scripts/seen-urls.mjs norm "$url")
  if grep -qxF "$key" "$SEEN"; then echo "[$i/$total] row $row $company :: already submitted, skipped"; continue; fi
  res=$(timeout 150 npx tsx src/cli.ts apply --attach --submit --cv "$CV" --url "$url" 2>&1 | grep -E "│ 0 " | tail -1 | tr -s ' ' | sed 's/│/|/g')
  grep -q "'yes'" <<<"$res" && { echo "$url" >> "$DONE"; echo "$key" >> "$SEEN"; }
  printf '%s\t%s\t%s\t%s\n' "$row" "$company" "$url" "${res:-timeout or crash}" >> "$OUT"
  echo "[$i/$total] row $row $company :: ${res:-timeout or crash}"
done < "$IN"
echo "done -> $OUT"
