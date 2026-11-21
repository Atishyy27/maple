#!/usr/bin/env bash
# Fill and submit every job in a TSV (row<TAB>company<TAB>url), one at a time, through the
# browser already running on port 9222. One result line per job, so a crash loses nothing.
#   bash scripts/bulk-submit.sh jobs.tsv /path/to/cv.pdf
#
# Guards, added after 17 and 22 Nov 2026 (a stopped run kept going beside a new one, and
# 6 companies got the same application 2-3 times):
#   1. A lock directory (mkdir is atomic, so two runs started together cannot both pass).
#   2. Everything already applied to: var/submitted.txt plus the application ledger, links
#      normalised (scripts/seen-urls.mjs), so a re-linked posting still counts as seen.
#   3. A URL is recorded BEFORE its run and kept if the run clicked submit at all, confirmed
#      or not, or timed out: an unsure job is never retried automatically.
IN="$1"; CV="$2"; OUT="${IN%.tsv}-results.tsv"
cd "$(dirname "$0")/.."
LOCK=var/bulk.lock.d; DONE=var/submitted.txt; PENDING=var/submit-pending.txt
touch "$DONE"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
    echo "another bulk run is going (pid $(cat "$LOCK/pid")); stop it first"; exit 1
  fi
  rm -rf "$LOCK"; mkdir "$LOCK" || { echo "cannot take the lock"; exit 1; }
fi
echo $$ > "$LOCK/pid"
SEEN=$(mktemp)
trap 'rm -rf "$LOCK" "$SEEN"' EXIT
node scripts/seen-urls.mjs list > "$SEEN"
total=$(wc -l < "$IN"); i=0
while IFS=$'\t' read -r row company url; do
  i=$((i+1)); url="${url%$'\r'}"
  key=$(node scripts/seen-urls.mjs norm "$url" </dev/null)
  if grep -qxF "$key" "$SEEN"; then echo "[$i/$total] row $row $company :: already submitted, skipped"; continue; fi
  echo "$url" >> "$PENDING"
  res=$(timeout -k 10 150 npx tsx src/cli.ts apply --attach --submit --cv "$CV" --url "$url" </dev/null 2>&1 | grep -E "│ 0 " | tail -1 | tr -s ' ' | sed 's/│/|/g')
  # yes = confirmed, clicked = pressed submit without a confirmation, empty = timed out mid-run.
  if grep -qE "'(yes|clicked)'" <<<"$res" || [ -z "$res" ]; then echo "$url" >> "$DONE"; echo "$key" >> "$SEEN"; fi
  printf '%s\t%s\t%s\t%s\n' "$row" "$company" "$url" "${res:-timeout or crash (recorded as seen; check by hand)}" >> "$OUT"
  echo "[$i/$total] row $row $company :: ${res:-timeout or crash}"
done < "$IN"
echo "done -> $OUT"
