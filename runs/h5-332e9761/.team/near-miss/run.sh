#!/usr/bin/env bash
# Swaps each near-miss copy into lib/, runs the tests, and reports CAUGHT or SURVIVED. Run from the project root.
set -u

start_sums=$(sha256sum lib/*.mjs)
survivors=0

for copy in .team/near-miss/[0-9][0-9]-*.mjs; do
  name=$(basename "$copy")
  target="lib/${name#??-}"
  before=$(sha256sum "$target" | cut -d' ' -f1)
  backup=$(mktemp)
  cp "$target" "$backup"
  trap 'cp "$backup" "$target"' EXIT INT TERM

  cp "$copy" "$target"
  node --test "test/*.test.mjs" >/dev/null 2>&1
  code=$?
  cp "$backup" "$target"

  after=$(sha256sum "$target" | cut -d' ' -f1)
  if [ "$before" != "$after" ]; then
    echo "RESTORE FAILED $target"
    exit 2
  fi
  trap - EXIT INT TERM
  rm -f "$backup"

  if [ "$code" -ne 0 ]; then
    echo "CAUGHT $copy"
  else
    echo "SURVIVED $copy"
    survivors=$((survivors + 1))
  fi
done

end_sums=$(sha256sum lib/*.mjs)
if [ "$start_sums" = "$end_sums" ]; then
  echo "LIB RESTORED"
else
  echo "LIB CHANGED"
  exit 2
fi

echo "survivors: $survivors"
[ "$survivors" -eq 0 ] || exit 1
