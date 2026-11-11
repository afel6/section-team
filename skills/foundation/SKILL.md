---
name: foundation
description: Lay the foundation when work first spans two or more builder areas, whether a new platform or a request that adds a second area to an existing product. For the supervisor only. Asks the user a few questions, writes a short frozen foundation note, gets the user's OK, then builds verified slices, one at a time or side by side when they share nothing.
---
# Foundation first

For the supervisor, before waking any builder when work first spans two or more builder areas, whether a new platform or a request that adds a second area to an existing product. Do the steps in order. `.team/` is at the project root, which is the main checkout in a worktree session: keep these notes there.

## Ask
Ask the user at most 5 questions whose answers change the build: users and scale, must-use stack, hosting, compliance, deadline. Choose sensible defaults for the rest and say which.

## Write the foundation note
For an existing product, write the note from the current code and the new request.
Write `.team/notes/foundation.md`, under 150 lines, with:
- purpose and non-goals;
- stack, with one reason each;
- data model;
- API and interface contracts;
- for each request that waits on an outside call, what it reads again before it writes;
- auth and security needs;
- build order as vertical slices, each with a check that proves it done, the sections it wakes (the security section for a slice that touches auth, payments, uploads or secrets) and whether it can be built beside another slice;
- test plan, including the critical end-to-end flows;
- quality targets that apply (performance, accessibility, recovery, operations), each with a number or a check;
- deploy and migration rules;
- commit policy.

Add a line for it, and one for `.team/notes/plan.md` once you keep it, to `.team/notes/INDEX.md`.

## Check the plan
Wake `section-team:plan-advisor` (Agent call, `run_in_background: false`) on `.team/notes/foundation.md`. It returns at most 8 fixes, each with its reason. Revise the note, then show the user the advice you took and the advice you did not, with why.

## Get the OK
Show the note to the user and wake nobody until they say OK. Ask here whether sections may commit after each job, because the user's rules may forbid commits otherwise.

## Freeze it
After the OK the note is frozen. A change goes through you and is recorded in `.team/notes/decisions.md`. A change to the frozen note wakes `section-team:plan-advisor` again on the changed note before the change is used.

## Keep the plan
Keep `.team/notes/plan.md` as a short status table of the slices, updated after each job. A new chat reads it first, so the work survives across sessions.

## Build slices one at a time, or side by side when they share nothing
Wake the sections for one slice only, or together for slices the note says can be built side by side (no shared files, contracts already in notes). Wake every section the note lists for the slice, the security section included. Each slice, or each set built side by side, ends with the testing section's whole-stack verification (full test suite, app started, critical flows driven through its real interfaces) before the next slice starts; for the last one that is the final review the brief asks for. Each job message names the foundation note and the slice. In a worktree session, give the note's full path.

If there is no repo yet, create it yourself before the first job and add both `.team/` and `**/.claude/agent-memory-local/` to `.git/info/exclude`, because session start only does that for a repo that already exists.
