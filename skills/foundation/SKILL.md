---
name: foundation
description: Lay the foundation when work first spans two or more builder areas, whether a new platform or a request that adds a second area to an existing product. For the supervisor only. Asks the user a few questions, writes a short frozen foundation note, gets the user's OK, then builds one verified slice at a time.
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
- build order as vertical slices, each with a check that proves it done;
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

## Build one slice at a time
Wake the sections for one slice only. Each slice ends with the testing section's whole-stack verification (full test suite, app started, critical flows driven through its real interfaces) before the next slice starts. Each job message names the foundation note and the slice. In a worktree session, give the note's full path.

If there is no repo yet, create it yourself before the first job and add both `.team/` and `**/.claude/agent-memory-local/` to `.git/info/exclude`, because session start only does that for a repo that already exists.
