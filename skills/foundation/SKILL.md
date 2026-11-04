---
name: foundation
description: Lay the foundation before building a new platform or product, or any work that needs 3 or more builder sections. For the supervisor only. Asks the user a few questions, writes a short frozen foundation note, gets the user's OK, then builds one verified slice at a time.
---
# Foundation first

For the supervisor, before waking any builder on a new platform or product, or on work that needs 3 or more builders. Do the steps in order.

## Ask
Ask the user at most 5 questions whose answers change the build: users and scale, must-use stack, hosting, compliance, deadline. Choose sensible defaults for the rest and say which.

## Write the foundation note
Write `.team/notes/foundation.md`, under 150 lines, with:
- purpose and non-goals;
- stack, with one reason each;
- data model;
- API and interface contracts;
- auth and security needs;
- build order as vertical slices, each with a check that proves it done;
- test plan, including the critical end-to-end flows;
- deploy and migration rules;
- commit policy.

Add a line for it, and one for `.team/notes/plan.md` once you keep it, to `.team/notes/INDEX.md`.

## Get the OK
Show the note to the user and wake nobody until they say OK. Ask here whether sections may commit after each job, because the user's rules may forbid commits otherwise.

## Freeze it
After the OK the note is frozen. A change goes through you and is recorded in `.team/notes/decisions.md`.

## Keep the plan
Keep `.team/notes/plan.md` as a short status table of the slices, updated after each job. A new chat reads it first, so the work survives across sessions.

## Build one slice at a time
Wake the sections for one slice only. Each slice ends with the testing section's whole-stack verification (full test suite, app started, critical flows driven through its real interfaces) before the next slice starts.
