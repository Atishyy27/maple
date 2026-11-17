#!/usr/bin/env bash
# Fill and submit every job in a TSV (row<TAB>company<TAB>url), one at a time, through the
# already-running browser on 9222. Writes one result line per job so a crash mid-run loses nothing.
#   bash scripts/bulk-submit.sh var/bulk-17nov.tsv /path/to/cv.pdf
IN="$1"; CV="$2"; OUT="${IN%.tsv}-results.tsv"
cd "$(dirname "$0")/.."
[ -n "$APPEND" ] || : > "$OUT"
total=$(wc -l < "$IN"); i=0
while IFS=$'\t' read -r row company url; do
  i=$((i+1))
  url="${url%$'\r'}"
  res=$(timeout 150 npx tsx src/cli.ts apply --attach --submit --cv "$CV" --url "$url" 2>&1 | grep -E "│ 0 " | tail -1 | tr -s ' ' | sed 's/│/|/g')
  conf=$(grep -o "submitted -> .*" <<<"$res" | head -1)
  printf '%s\t%s\t%s\t%s\n' "$row" "$company" "$url" "${res:-timeout or crash}" >> "$OUT"
  echo "[$i/$total] row $row $company :: ${res:-timeout or crash}"
done < "$IN"
echo "done -> $OUT"
