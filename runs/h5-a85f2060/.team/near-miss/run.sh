#!/usr/bin/env bash
# Runs the test suite against each near-miss copy swapped into lib/, always restoring the original.
# Usage: run.sh [near-miss file ...]   (default: every NN-*.mjs next to this script)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NM="$ROOT/.team/near-miss"

PENDING_NAME=""
PENDING_BACKUP=""

restore_pending() {
  if [ -n "$PENDING_BACKUP" ] && [ -f "$PENDING_BACKUP" ]; then
    cp "$PENDING_BACKUP" "$ROOT/lib/$PENDING_NAME"
  fi
}

on_exit() {
  restore_pending
}
trap on_exit EXIT
trap 'restore_pending; exit 130' INT
trap 'restore_pending; exit 143' TERM

if [ "$#" -gt 0 ]; then
  COPIES=("$@")
else
  COPIES=("$NM"/[0-9]*-*.mjs)
fi

for arg in "${COPIES[@]}"; do
  copy="$arg"
  [ -f "$copy" ] || copy="$NM/$arg"
  if [ ! -f "$copy" ]; then
    echo "$arg MISSING" >&2
    exit 2
  fi
  base="$(basename "$copy")"
  name="${base#[0-9][0-9]-}"
  backup="$NM/.orig-$name"

  cp "$ROOT/lib/$name" "$backup" || { echo "cannot back up lib/$name" >&2; exit 2; }
  PENDING_NAME="$name"
  PENDING_BACKUP="$backup"

  cp "$copy" "$ROOT/lib/$name"
  (cd "$ROOT" && timeout 120 node --test "test/*.test.mjs") >/dev/null 2>&1
  status=$?

  restore_pending
  before="$(sha256sum "$ROOT/lib/$name" | cut -d' ' -f1)"
  after="$(sha256sum "$backup" | cut -d' ' -f1)"
  if [ "$before" != "$after" ]; then
    echo "!!! RESTORE FAILED for lib/$name (hash differs from backup $backup)" >&2
    exit 2
  fi
  rm -f "$backup"
  PENDING_NAME=""
  PENDING_BACKUP=""

  if [ "$status" -ne 0 ]; then
    echo "$base CAUGHT"
  else
    echo "$base SURVIVED"
  fi
done

git -C "$ROOT" status --short -- lib
sha256sum "$ROOT"/lib/*.mjs
