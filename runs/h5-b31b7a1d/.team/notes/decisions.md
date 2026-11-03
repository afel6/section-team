# Decisions log — date, section, decision, why

- 2026-11-03 · testing · Import tests read "an earlier entry with valid fields" as: it broke none of not-an-object..bad-split (so an earlier bad-split or unknown-field entry never makes a later one `duplicate`). Why: stricter reading of the README; the implementation matches it.
- 2026-11-03 · testing · Duplicate descriptions are compared only after `trim()` + `toLowerCase()`: inner whitespace is not collapsed ("Ho tel" is not "Hotel"), and NBSP/tab/newline at the ends are trimmed, since `String.prototype.trim` removes them. Why: the spec names exactly those two calls and adds no other normalization.
- 2026-11-03 · testing · Near-miss copies are run through a module loader hook that sends `lib/<file>` to the copy, not by copying them into lib/. Why: lib/ never changes, so there is nothing to restore after a failed run. A control run with an unchanged copy passes, so the hook alone breaks nothing.
