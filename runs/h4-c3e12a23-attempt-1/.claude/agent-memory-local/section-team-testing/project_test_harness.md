---
name: project-test-harness
description: Booking-app test infra quirks: Bash sandbox limits, near-miss tooling in .team/scratch, child-process 'close' vs 'exit'
metadata:
  type: project
---
Near-miss tooling lives in `.team/scratch/`: `make-near-miss.mjs` (patch table -> `.team/near-miss/NN-<file>`, rerun after any server.mjs change), `run-near-miss.mjs NN ...` (swap, `npm test`, restore + sha check; batches of ~15 fit the 10-min Bash limit), `known-fail.txt` (test names already failing on real code).

**Why:** Bash here denies `/tmp` writes, shell loops, env-var prefixes, redirects and `rm`-like chains; plain `node <script>` / `npm test` work. Coders often get Bash denied, so run their tests yourself.

**How to apply:** put probes as `.team/scratch/*.mjs` run with `node --test`; in spawn helpers resolve on `'close'` (stdio drained), never `'exit'`; raw TCP requests must not half-close (node:http aborts on client FIN). Related: [[feedback-review-gate]].
