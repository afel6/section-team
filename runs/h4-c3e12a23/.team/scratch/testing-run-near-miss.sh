#!/usr/bin/env bash
# Swaps each near-miss copy into place, runs npm test, records pass/fail, ALWAYS restores originals.
set -u
ROOT=/root/bench-runs/h4-c3e12a23
BACKUP=$ROOT/.team/scratch/testing-orig
mkdir -p "$BACKUP"
cp "$ROOT/server.mjs" "$BACKUP/server.mjs"
cp "$ROOT/public/app.js" "$BACKUP/app.js"
restore() {
  cp "$BACKUP/server.mjs" "$ROOT/server.mjs"
  cp "$BACKUP/app.js" "$ROOT/public/app.js"
}
trap restore EXIT INT TERM

for copy in $(ls "$ROOT/.team/near-miss/" | sort -n); do
  case "$copy" in
    *-server.mjs) target="$ROOT/server.mjs" ;;
    *-app.js) target="$ROOT/public/app.js" ;;
    *) continue ;;
  esac
  cp "$ROOT/.team/near-miss/$copy" "$target"
  fails=$(cd "$ROOT" && npm test 2>&1 | grep -E '^# fail ' | awk '{print $3}')
  restore
  if [ "${fails:-0}" -gt 0 ]; then echo "CAUGHT  $copy ($fails failing)"; else echo "MISSED  $copy"; fi
done
restore
diff -q "$BACKUP/server.mjs" "$ROOT/server.mjs" && diff -q "$BACKUP/app.js" "$ROOT/public/app.js" && echo "originals restored"
