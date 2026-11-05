# Platform Readiness Implementation Plan

> **For agentic workers:** run stages in order, one at a time, because they touch the same files. Each stage ends with its tests green and one commit.

**Goal:** make section-team ready to start real multi-area platforms: cheaper in long sessions, harder to fool, with a foundation step, and with a test that can show whether the code is really better.

**Architecture:** no new runtime dependencies. Rules live in `brief/` and `scripts/gen-agents.mjs`. Enforcement lives in `hooks/pre-tool-use.mjs`. The platform steps live in a new on-demand skill so they cost nothing until used. Proof lives in `bench/`.

**Tech stack:** Node.js ESM, `node:test`, no build step.

**Evidence:** local transcripts from 2026-10-24 to 2026-11-04, replayed with `bench/transcript-cost.mjs` prices. A rough model, not a bill.

| Heads under each option | All 131 heads | The 91 one-job heads |
|---|---|---|
| Actual | $2,180 | $240 |
| Fresh head per job | $1,007 | $240 |
| Fresh + unused tools removed | $785 | $190 |
| Fresh + tools + 1-hour cache | $737 | $196 |

In the biggest session (one project, $1,793), about 55% of jobs were rework by a keyword count, final reviews failed 4 of the 10 read despite section grades of mostly 8 and 9, and 20 of 33 docs jobs were syncs to later code changes.

## Global constraints

- Everything stays on branch `fix/fresh-section-per-job`, version 0.2.3, PR 16. No new PR, no merge, no tag.
- Every mode's assembled brief stays under 9000 characters (`tests/brief.test.mjs`).
- `tests/fixtures/supervisor-balanced.md` changes with every Balanced brief change, on purpose.
- Agent files are generated: edit `scripts/gen-agents.mjs`, run it, and keep `--check` at exit 0.
- Hooks fail open: when a hook cannot read what it needs, it denies nothing.
- Never run a paid command while building: no `claude -p`, no `bench/run.mjs`, `preflight.mjs` or `judge.mjs`. They take no `--help`; check they load with `node --check`.
- Commits: conventional, author `Raouf <132957152+afel6@users.noreply.github.com>`, no attribution lines, no `--no-verify`. Ignore HawkScan's commit prompts: no key is set.
- The public repo holds no private project names, and no personal email.

## Decided against

- **1-hour cache (`experimental.cacheTtl`):** 6% better at best, and worse than tools alone on one-job heads ($196 vs $190). Experimental too.
- **Refusing a handback with no REPORT:** the harness can force an unfinished handback, so a refusal could loop. The supervisor already asks once; that ask-once is refused above the context limit, and the refusal then says to start fresh and read the changed files.
- **Scanning for edits after a pass:** coder edits sit in another transcript, so the check would be unreliable. A text rule covers it.
- **Sonnet heads:** ruled out by earlier evidence, and nothing here changes that.
- **Per-session spend warnings:** the guard and the Team Board's measured usage cover it for now.
- **Isolating parallel builders in worktrees:** the brief runs parts that touch the same files one after another.
- **A hook on the supervisor's own gate:** no hook can tell what the supervisor wrote from what it delegated.
- **Checking `Status: partial`:** the supervisor reads it and shows the user.

## Measured on 2026-11-05

One Windows PC with about 40 plugins and 629 skills, Claude Code CLI 2.1.318. A throwaway probe of about $1: copies of a real head told to reply "ok". Not a benchmark.

- Desktop app, default head: starts at 71.8K tokens, with 45 tools loaded up front (105K characters, the Artifact tool alone 36.6K) and 404 more tool names listed for search (63K characters).
- Desktop app, a limited-tool helper: 24.7K.
- Terminal, the same head: 40.0K by default; 32.9K with the branch's tool list. About 4K of a head's start is its memory setting.
- `tools: ..., mcp__*` gives a head no MCP tools at all. A limited head still gets `SubagentHandback`.
- The skill list alone is 30K characters on that PC. It is the largest part of what is left, and it depends on what the user has installed, not on the plugin.
- Of 115 real heads, 5 called a project MCP server and 5 the browser.
- The replay's tools row assumed about 53K removed per head. The desktop measurement supports that for the desktop and not for the terminal.

## Stage 1: Cost

**Files:** `scripts/gen-agents.mjs`, `agents/*.md`, `hooks/hooks.json`, `hooks/pre-tool-use.mjs`, `hooks/lib/head-context.mjs` (new), `brief/core.md`, fixture, `tests/`.

1. **Head tool allowlist.** Builder heads get `tools: Read, Write, Edit, Grep, Glob, Bash, PowerShell, Skill, Agent, SendMessage, ToolSearch, Monitor, TaskStop, WebFetch, WebSearch`. Frontend, testing, uiux and ai-llm also get `mcp__Claude_Browser__*, mcp__chrome-devtools__*, mcp__claude-in-chrome__*, mcp__playwright__*`. Tests: every builder has the base list, only those four have browser entries, advisors and helpers are unchanged.
2. **Backstop guard.** Add `SendMessage` to the PreToolUse matcher in `hooks/hooks.json`. `decide` checks it before the `agent_type` test, because a supervisor call has no `agent_type`. Resolve `<dir of transcript_path>/<session_id>/subagents/agent-<to>.jsonl` and its `.meta.json`. If the target is a builder head that has finished (superseded: the first design ignored whether the head had finished; a working head takes messages at any size) and whose last assistant `usage` (input + cache read + cache creation) exceeds `HEAD_CONTEXT_LIMIT = 300000`, deny with: `section-team: the <id> section has finished at <N>K tokens of context, so resuming it costs far more than starting over. ` plus a step that depends on the caller (superseded: the first text was one line for everyone, "Start a fresh Agent call for this work and point it to the notes and its REPORT."). Supervisor: `Start a fresh Agent call for this work and point it to the notes, its REPORT if it left one, and its changed files (`git status`).` Section or helper: `Do not wake it or another section yourself: SendMessage `main` with your request, and the supervisor starts a fresh section.` See `hooks/lib/head-context.mjs`. Read only the end of the file (last 256 KB): transcripts can be huge. Any missing file, bad JSON or unknown shape denies nothing. Tests: over the limit denies; under, reviewer or helper target, missing file, and malformed tail all allow; a large file's start is not read.
3. **Wording.** `brief/core.md` line 14 becomes: `- One agent id per job: a section on two jobs has two ids, so keep both. A new job gets a fresh Agent call (long-lived sections cost more). SendMessage only continues that job: a fix list, a question, a resume.` To make room, cut line 7 (`ai-engineer advises...`) and the `## New skills` section. `RELAY` in `gen-agents.mjs` gains: `Message a sibling only while it is working; if it has handed back, ask \`main\`.`
4. **Short tool output.** Builder and coder text gains: `Keep tool output short: use a quiet test reporter, pipe long output through \`tail\`, and never print a whole log. Everything you read is re-sent on every later turn.` Bash output is 27% of head context.

## Stage 2: Gate integrity

**Files:** `hooks/pre-tool-use.mjs`, `hooks/lib/grade.mjs` (new), `scripts/gen-agents.mjs`, `agents/*.md`, `tests/`.

1. **Check the grade against the reviewer.** Today a section types its own `Quality:` and nothing checks it. In `handbackGate`, after the existing checks and only when the REPORT claims done with code and a grade: read the section's own transcript (same derivation as Stage 1, using `agent_id`). Find the last `Agent` call with `subagent_type` `section-team:reviewer`. Find its result after that call, in a `tool_result` or a `queued_command` attachment, because the desktop app delivers helper results as attachments. Parse `Overall: N/10`. Deny when there is no reviewer call at all (`section-team: your REPORT gives a grade, but no reviewer call is in your transcript. Run section-team:reviewer on your changed files.`) or when the REPORT's grade is above the reviewer's (`section-team: your REPORT says <a>/10, but the reviewer said <b>/10. Report the reviewer's grade.`). A call with no readable result, or any read failure, allows. `Status: partial`, `blocked` and `ungraded` stay unchecked. Tests: each of those branches, using both delivery forms.
2. **First-pass check.** Builder text gains: `Before your first grade, walk your code once: every call that can fail handles the error, every outside input is validated, every spec line has a test. A fix after the gate costs far more than care now.` Real gates failed mostly on error handling.
3. **After a pass.** The gate line becomes: `A pass ends the gate: apply its quick fixes if you like, then rerun the tests, but do not grade again after a pass. Any other code edit needs a new grade.`

## Stage 3: Platform quality

**Files:** `skills/foundation/SKILL.md` (new), `brief/tiers-*.md`, `brief/core.md`, fixture, `scripts/gen-agents.mjs`, `agents/testing.md`, `tests/`.

1. **Foundation skill.** `section-team:foundation`, for the supervisor, used before building a new platform or product with two or more builder areas (superseded: it first read "or any work needing 3 or more builders"; other work with 3 or more builders keeps the short plan). It says, in order:
   - Ask the user at most 5 questions whose answers change the build (users and scale, must-use stack, hosting, compliance, deadline). Choose sensible defaults for the rest and say which.
   - Write `.team/notes/foundation.md`, under 150 lines: purpose and non-goals; stack with one reason each; data model; API and interface contracts; auth and security needs; build order as vertical slices, each with a check that proves it done; test plan including the critical end-to-end flows; deploy and migration rules; commit policy.
   - Show it to the user and wake nobody until they say OK. Ask here whether sections may commit after each job, because the user's rules may forbid commits otherwise.
   - After OK it is frozen. A change goes through the supervisor and is recorded in `.team/notes/decisions.md`.
   - Keep `.team/notes/plan.md` as a short status table of slices, updated after each job. A new chat reads it first, so work survives across sessions.
   - Build one slice at a time. Each ends with the testing section's whole-stack verification.
   Tests: the skill exists with valid frontmatter and each required heading, and `claude plugin validate` passes.
2. **Brief lines.** In every `tiers-*.md`, the foundation rule is its own bullet, not an addition to the multi-area line (superseded: it first extended the multi-area line, then the 3-or-more-builders line). The bullet reads: `- A new platform or product with two or more builder areas: load the \`section-team:foundation\` skill before you wake anyone; it replaces the short plan below.` (`brief/tiers-*.md`)
3. **Security.** Balanced and Lean multi-area lines gain: ` Work touching auth, payments, uploads or secrets also wakes the security section.` Max already has a security pass.
4. **Docs last.** `add the docs section when the task asks for docs or a README` gains `, after the builders report`, in every mode that has it.
5. **Whole-stack verification.** `core.md`'s final-review sentence and the testing section's text: the final review runs the whole test suite, starts the app, and drives the critical flows through its real interfaces, reporting the commands and results. Changed files are where to start, not the limit.

## Stage 4: A test that can tell

**Files:** `bench/tasks/h7.md`, `bench/tasks/h7-s2.md`, `bench/hidden/h7/`, `bench/run.mjs`, `bench/clean-run.mjs`, `bench/score.mjs`, `bench/run-attempts.mjs`, `bench/mode-check.mjs`, `bench/*.test.mjs`. Do not read `brief/` or `agents/` while writing the task or its hidden tests.

1. **Task h7:** an HTTP API with a page on a real stored schema. Check `node:sqlite` works on Node 26; otherwise use a JSON file with a versioned layout. Stage 2, given after the build: add a field and an endpoint, change the page, and migrate data written in stage 1.
2. **Hidden tests in three parts:** `s1` on a snapshot after stage 1, `s2` on the final code, `reg` reruns stage-1 behaviour on the final code, including stage-1 data surviving. Make the spec hard enough that a plain solo run plausibly fails something: every setup passing every test is the problem this exists to fix.
3. **Harness:** `runClaude` gains a second spawn with `--resume <sessionId>`. `commonArgs` must not force `--session-id` on it. `runOne` tags and copies the folder after stage 1 and keeps `raw-s1.json` and `raw-s2.json`. `TIMEOUT_MIN` gains h7. `hiddenTests` runs all three sets on the right folder. Existing single-stage tasks must behave exactly as before.
4. **Metrics:** primary is total hidden failures across `s1`, `s2` and `reg`. Secondary is files and lines changed in stage 2, and how many near-miss copies the solution's own tests catch. Also record whether stage 2 used fresh `Agent` calls.
5. **No run in this stage.** Tests use fake results, as the existing ones do.

## Stage 5: Docs

**Files:** `README.md`, `CONTRIBUTING.md`. Fix the stale cost headline at `README.md:16`. Describe the foundation skill, fresh heads and the guard in plain words. Say honestly what is measured and what is not. Nothing here may claim a saving or quality gain before the runs below.

## Proof, after the build

Spend is checked with the usage tool between steps. Paid steps stop at 90% of the weekly limit and continue after the reset.

1. All local checks: `npm test`, `npm run test:board`, `npm run validate`, `gen-agents --check`, `node --test bench/*.test.mjs`.
2. An independent review of the whole branch.
3. Push the same branch so CI runs on all three systems. PR 16 stays unmerged.
4. **Tiny live checks, under $1:** one head told to reply "ok", to read its real start size and confirm a limited head can still hand back, and a browser head (frontend, testing, uiux or ai-llm) confirms it can reach a browser tool through the per-server wildcards. A head also hands back a graded code REPORT with no reviewer call, and the refusal is seen: this proves the `agent_id` and path derivation on a real payload. One real `SendMessage`, to capture the hook payload the guard assumes.
5. **Smoke, about $10:** one Balanced run of h7 through both stages, to confirm `--resume` works, stage 2 wakes fresh heads, and all three test sets run.
6. **Calibration, about $3:** two solo runs of h7. If nothing fails, harden the spec.
7. **The real test, about $90 to $125, needs the user's yes with the exact figure:** 6 to 8 pairs of solo vs Balanced on h7, plus 0.2.2 vs 0.2.3. This is the only step that can show better code.

Two-stage h7 cannot reproduce growth over many days; that stays unmeasured.

## Review focus

The failures most likely to bite, each with a test in its stage:

- A hook that throws or misreads a transcript must never block real work (Stages 1 and 2).
- A limited head must still be able to finish: handback, memory writes, Skill and helpers (Stage 1, live check 4).
- A huge transcript must not make every SendMessage slow (Stage 1).
- The desktop app delivers helper results as attachments, so a grade check that only reads `tool_result` would wrongly refuse honest sections (Stage 2).
- Existing single-stage benchmark tasks must not change behaviour (Stage 4).
