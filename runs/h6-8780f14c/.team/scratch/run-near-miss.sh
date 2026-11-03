#!/usr/bin/env bash
# Swaps each near-miss copy into place, runs the suite, restores the original and verifies its hash.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BACKUP="$ROOT/.team/scratch/orig"
mkdir -p "$BACKUP"
cp -p jsonpatch.mjs jsonpatch-cli.mjs "$BACKUP/"
ORIG_SUM="$(sha256sum jsonpatch.mjs jsonpatch-cli.mjs)"
restore() {
  cp -p "$BACKUP/jsonpatch.mjs" "$BACKUP/jsonpatch-cli.mjs" "$ROOT/"
}
trap restore EXIT INT TERM
for copy in .team/near-miss/*; do
  name="$(basename "$copy")"
  target="${name#*-}"
  cp "$copy" "$target"
  out="$(timeout 600 node --test --test-timeout=60000 test/*.test.mjs 2>&1)"
  fails="$(printf '%s\n' "$out" | grep -E '^# fail ' | awk '{print $3}')"
  restore
  if [ "${fails:-0}" -gt 0 ]; then echo "KILLED   $name ($fails failing)"; else echo "SURVIVED $name"; fi
done
restore
NOW_SUM="$(sha256sum jsonpatch.mjs jsonpatch-cli.mjs)"
if [ "$ORIG_SUM" = "$NOW_SUM" ]; then echo "originals restored (sha256 match)"; else echo "RESTORE MISMATCH"; exit 1; fi
