# Mode round — design (2026-11-01)

## Why
Version 0.2.0 lets each project pick Lean, Balanced or Max. The picker shows Balanced's usage as measured and Lean's and Max's as targets. This round measures all three against Claude Code without the plugin on three new tasks, by rules fixed in advance, and the picker then shows what was measured. The result is published whatever it shows. The frame is the Measurement section of `docs/specs/2026-11-01-quality-modes-design.md`; this spec replaces its step 2.

## Decided with the user (2026-11-01)
- **3 runs per setup and task** (36 runs), not 5 or 2.
- **Clean environment:** builders and judges run with every plugin off except section-team, which is on only in the Lean, Balanced and Max runs, and two built-in plugins left on in every setup (named under Runs). The user's `~/.claude/CLAUDE.md` and `~/AGENTS.md` stay as the baseline every setup shares. Carrying that decision through, MCP servers and the skills synced from claude.ai are off too (proposed with this spec).
- **Plugin fix first:** Max keeps its near-miss copies out of the project (v0.2.1, below), and the round measures v0.2.1.
- **Outside judges:** if no outside judge passes its held-out check, the Opus judges decide every bar and the results say "not outside-confirmed".

## Where this differs from quality-modes Measurement step 2 (deliberately)
- Setups are named `lean` and `max` (as `run.mjs` has them since 0.2.0), not `team-lean` and `team-max`.
- Opus judges see the labels W, X, Y, Z; only outside judges get A–D.
- Codex joins Antigravity as an outside judge, and every outside case is judged in a fresh session.
- Outside confirmation needs 7 of 9 groups (not 6), by the sign of the quality difference (not rank order), a zero counts as disagreement, and the outside judge's gap must point the same way as the Opus gap.
- Lean's usage bar applies to h5 and h6 only. The hidden-test condition, the scale-ceiling rule and the arithmetic rules are new.
- The estimate rises from about $65 to about $137, because of the multi-area task h4 and the four-solution judges.

## Pre-registration
- **Freeze commit:** before the first paid run, one commit holds the tasks, the h5 seed, the hidden tests, the reference solutions, the calibration near-miss versions, the judge prompt, `bench/bars-mo.json` (every number in "Bars and rules"), the mode-check rules, the leak-scan word list, the run sheet for outside judges and this spec. The freeze commit and the tag `v0.2.1` are pushed before the first run, and the write-up cites both.
- **Plugin paths untouched:** `v0.2.1` is an ancestor of the freeze commit, and harness work touches only `bench/` and `docs/`. At the freeze, before each batch and before publishing, `git diff --stat v0.2.1 <freeze> -- agents hooks skills brief .claude-plugin scripts types package.json tests` prints nothing.
- **Harness bugs:** a bug found during the runs may be fixed only if it does not touch a scoring rule. The fix commit names, before any rerun, every run whose inputs or outputs the bug's code path could change; if the bug affects one setup, all four runs of each affected group are rerun. A bug in code that only reads finished runs and judge verdicts and never starts `claude` or `codex` (scoring, statistics, bars, mode fidelity and reports: `score.mjs`, `transcript-cost.mjs`, `aggregate.mjs`, `stats.mjs`, `bars*.mjs`, `mode-check.mjs`, `mode-gates.mjs`, `gate-stats.mjs`, `test-strength.mjs`, `leak-scan.mjs`) is fixed and everything is rescored, with no reruns. A bug in judging or anonymizing (`judge.mjs`, `external-judge.mjs`, `codex-judge.mjs`, `anonymize.mjs`) is fixed and every affected judge case is judged again in a fresh session, with no build reruns; the fix commit names those cases first. The write-up lists each bug, its commit and the rerun ids.
- **No tuning on h4–h6**, before or after. Once published they are no longer held out.

## The plugin under test: v0.2.1
- **Change, Max brief** (`brief/tiers-max.md`, `brief/gate-max.md`): near-miss copies live only in `.team/near-miss/` and stay there; a copy is swapped in only after every builder has reported, and the original is always restored. To stay under the 9000-character cap, the Max brief also makes seven wording cuts that keep its meaning (plan Task 1 Step 3 (a)–(g)); `git diff v0.2.0 v0.2.1 -- brief/` shows them.
- **Change, testing section's instructions** (generated `agents/testing.md`): when a job asks for near-miss copies (only Max's jobs do):
  - name each copy `.team/near-miss/<n>-<original file name>`, with a first-line comment `near-miss: <the one bug>`;
  - restore the original also when a test run fails;
  - never leave a copy anywhere else.

  The assembled Max brief is at its 9000-character limit (the SessionStart context cap), so these details live with the section that does the work. The README's Modes row says where the copies live. Lean's and Balanced's briefs do not change; assembled Balanced stays word for word.
- **Why:** a copy left in the project is deliberately broken code a user could import or commit by mistake, and it marks a solution as Max for any judge (`bench/anonymize.mjs` already drops `.team/`).
- **Release:** version 0.2.1 in `package.json` and `.claude-plugin/plugin.json`, the usual tests and reviewer gate, tag `v0.2.1`.
- **Pinned load:** runs load the plugin from a git worktree of tag `v0.2.1` outside the repo, never from the live `C:\Users\Asus\claude-team`. The user's `~/.claude/settings.json` `env` also sets `CLAUDE_CODE_PLUGIN_DIRS` (to the live checkout), so the worktree's absolute path goes both in the runs' process environment and in the `env` block of every run's `--settings`, which outranks the user's file; `--plugin-dir` is not used. Loading is proven from the init message, not assumed:
  - in `lean`, `team` and `max` runs, the init lists exactly one section-team entry, whose `path` (resolved, compared ignoring case) is the worktree and whose `version` is `0.2.1`;
  - in `solo` runs, no entry is `section-team@inline` or has a `path` under the live checkout, and its other entries are exactly the preflight's recorded built-ins (which also rules out a load from the pinned worktree).

  Anything else voids the run. Before each batch and before publishing, `git -C <worktree> status --porcelain` and `git -C <worktree> diff --stat v0.2.1` print nothing. Each `run.json` records the worktree commit and the init's section-team `path` and `version`.

## Tasks
Three tasks, `h4`, `h5`, `h6` (no dashes). Specs in `bench/tasks/<task>.md`, hidden tests in `bench/hidden/<task>.test.mjs`, the h5 seed in `bench/seeds/h5/`. Same rules as h1–h3: Node.js built-ins only, no npm install, headless, no outside services. Each task asks for tests with `node:test`, a `package.json` with a `test` script, and a README with usage.

- **H4 — API plus UI (multi-area).**
  - An HTTP JSON API and a browser page served by the same server, storing its data in one JSON file. Exactly two builder areas (backend and frontend), so every mode wakes builders and no mode reaches the "3 or more builders" plan rule.
  - The page has its own behaviour, in its own section of the task text: at least one form that calls the API, a list rendered from API data that updates after a change, and the API's error messages shown to the user. The reference's browser-side code (HTML plus script) is at least about 200 of its new lines; the reference is about 500–800 new lines in all. As built: 464 new source lines without tests and docs (blank and comment lines counted), 171 of them browser code (HTML 41 + script 130); accepted, ruling 2026-11-02.
  - Hidden tests drive the server over HTTP: API status codes, bodies and error cases, and the served HTML checked for the ids and text the spec names. The served script is also run in a Node vm against a DOM and fetch stand-in that offers only the browser APIs the task text lists, and the tests check the page's behaviour there. The spec fixes the entry file, the port variable and the data file path.
- **H5 — existing codebase (single-area).**
  - A seeded Node.js HTTP JSON service of about 500 lines with its own passing `node:test` suite.
  - Two bug reports written as users would (symptom, not cause), each with its root cause in a function shared by more than one path.
  - One feature: a new endpoint that validates a JSON body against several named rules with exact error responses and changes the stored data, at least 150 new lines without tests (about 150–300), in a module whose path the spec fixes. The existing tests must keep passing. As built: about 151 new lines counted the same way (about 122 without blank and comment lines); accepted, ruling 2026-11-02.
- **H6 — tricky-spec library (single-area).** A library of about 150–400 lines with exact errors, plus a command-line entry that reads a file or stdin, so Max's security review applies. The spec fixes the module path, its exports, the CLI entry path and the CLI's exit codes.
- **Size floor:** an author who has not read `brief/` counts the reference's new lines and confirms from the task text alone that h4 reads as two areas; a task at or under 80 new lines is rejected.
- **Difficulty:** the tasks aim to be harder than h1–h3 (where solo scored 8.16, with the user's plugins on), so Balanced has room below the scale ceiling.
- **Authoring:** each task text goes through an adversarial ambiguity review before any test is written. Each spec requirement line has at least one hidden test.
- **Calibration:** the reference passes 100% of its hidden tests. At least 3 near-miss versions per task (an off-by-one, a symptom-only fix, a dropped edge case) each fail at least one. On h4 the dropped-edge-case variants stand in for a symptom-only fix (ruling 2026-11-02). Every h5 near-miss still passes the seed's own test files (restored to the seed's version after the hidden run). They live in `bench/heldout-calibration/<task>/reference/` and `.../near-miss/<name>/`, laid over the seed as for h1–h3, so `node bench/calibrate.mjs h4` (and h5, h6) reruns the calibration unchanged.

## Runs
- **Setups:** `solo` (Claude Code with every plugin off, plus the user's global instructions and the skills, agents and rules in `~/.claude`), `lean`, `team` (Balanced) and `max`, given as `--conds=solo,lean,team,max`. `run.mjs` writes `.team/mode.json` for `lean` and `max`, none for `team`.
- **Scale:** 3 tasks × 4 setups × 3 runs = **36 runs**, tag `mo`; run ids like `h4-lean-mo-r1`. `run.mjs` refuses a `--round` that disagrees with `--tag`.
- **Order:** as `plan()` gives it: within each rep, task by task (h4, h5, h6), the setups run solo, lean, team, max in r1 and r3 and in reverse in r2, so no setup always goes first.
- **Time limits:** h4 120 minutes, h5 60, h6 60.
- **Clean environment:** each run's `--settings` holds:
  - `"syncClaudeAiPlugins": false`, which stops every account-synced plugin for that run only;
  - `enabledPlugins` with every key of `~/.claude/plugins/installed_plugins.json` (read when the batch starts) set to false;
  - `"section-team@inline"` true for `lean`, `team` and `max`, false for `solo`;
  - `"cc-plugin-plugin-authoring@builtin": false` (Claude Code 2.1.296 reads `enabledPlugins` for every built-in except `cc-plugin-sec-default`; the preflight confirms it is absent from the init);
  - `"syncClaudeAiSkills": false`, which hides the skills synced from claude.ai (`~/.claude/skills/synced/`, 146 on 2026-11-01) for that run only, so a re-sync during the round cannot change them.

  Runs also pass `--strict-mcp-config` with no MCP config and set `ENABLE_CLAUDEAI_MCP_SERVERS=false`, so no MCP server loads. The built-ins `cc-plugin-agents-md@builtin` (it reads `~/AGENTS.md`, which stays) and `cc-plugin-telemetry@builtin` are left on in every setup as shared baseline. The user-level skills, agents, commands and rules in `~/.claude` (not synced ones) stay for every setup; section-team's sections use the user-level agents as helpers, and solo can call the same agents. Automatic skill installs are off in the process environment and in `--settings`.
- **Init check:** every builder run passes `--output-format stream-json` with `--verbose`, so its output holds the init message as its first line even when the run is killed at its time limit (judges keep `--output-format json --verbose`). The preflight records each setup's init `plugins`, `agents` and `skills` and checks that `mcp_servers` is empty (the empty list is the reference), and every `run.json` saves all four lists. A run is **void** when:
  - its `plugins` differ from section-team (none for solo) plus the recorded built-ins;
  - its `mcp_servers` is not empty;
  - its `agents` or `skills` differ from the preflight's for that setup;
  - its init reports a different `claude_code_version`, model or `apiKeySource` than the round's (the preflight records them);
  - any assistant message in its session or subagent transcripts records an `effort` other than the round's (the init has no effort field, so this is read from the copied transcripts);
  - it has no init message.
- **Pinned CLI, model and effort:**
  - The preflight takes `<v>` from `claude --version` (the binary on PATH), copies `~/.local/share/claude/versions/<v>` (a Windows executable without an extension) to `~/bench-runs/claude-<v>.exe`, checks that the copy is byte-identical and prints `<v>`, and records `<v>` and the copy's SHA-256 as the round's version. `run.mjs`, `preflight.mjs` and `judge.mjs` start that path from one shared export, never `claude` from PATH, so the user's own sessions can keep updating with no change to the user's settings files. `DISABLE_AUTOUPDATER=1` is set in the spawn environment and in `--settings`. The preflight refuses to run when the round's pin already exists.
  - Every builder, preflight and Opus judge run gets `--model claude-opus-5-5 --effort medium`. Medium is the level h1–h3 and their judges actually ran at (every assistant message in their transcripts records `"effort":"medium"`), and the cost estimates come from those runs.
  - A version or model mismatch is a harness bug: it stops the batch, the mismatched runs are void and rerun on the round's version, and earlier batches stay valid.
- **Spawn environment:** `run.mjs`, `preflight.mjs` and `judge.mjs` build the child environment the same way:
  - Start from the parent environment.
  - Remove every `CLAUDECODE`, `CLAUDE_*`, `ANTHROPIC_*`, `DISABLE_*`, `SECTION_TEAM_*` and `MCP_*` variable, and `USE_STAGING_OAUTH`, `USE_LOCAL_OAUTH`, `MAX_THINKING_TOKENS`, `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` (names compared ignoring case, as on Windows), so a round started from a shell inside a Claude Code session behaves like one started from a plain terminal. Auth then comes from the user's stored Claude login (no API key; the preflight records `apiKeySource`), and no variable can swap the models behind the `opus` and `sonnet` aliases.
  - Add `CLAUDE_CODE_PLUGIN_DIRS=<worktree>` (builders and preflight), `SECTION_TEAM_AUTO_INSTALL_SKILLS=0`, `ENABLE_CLAUDEAI_MCP_SERVERS=false` and `DISABLE_AUTOUPDATER=1`.

  Each `run.json` records the names, never the values, of the variables passed. The preflight proves the result from its init messages.
- **Batches:** one batch per rep (all 12 runs of r1, then r2, then r3), so a stop never leaves uneven cells. Between batches, `node bench/score.mjs` runs, and every void run, API failure and rerun so far is listed.
- **Attempts and reruns:**
  - Before every attempt, including a rerun, `run.mjs` moves any earlier attempt's `results/<id>/` and the run's Claude Code project folder (transcripts and auto-memory) into `results/<id>/attempt-<n>/`, so nothing is deleted and each attempt starts with no memory of an earlier one.
  - It picks a fresh random UUID, passes it as `--session-id` and writes it to `results/<id>/session.json`.
  - A run is an **API failure** when its result has `is_error` and its result text names an API error, usage limit, rate limit or overload; the exact match rule is fixed and tested in the freeze commit. An API failure stops the batch and writes no `run.json`, so a resume reruns it.
  - Any other `is_error` ending, a timeout, a crash after the run started, or a missing result writes `run.json` with its `subtype` and result text, and is scored as that setup's run on what is on disk.
  - A run is rerun only when it is an API failure, void, or named by a harness-bug fix commit.
  - An API failure whose text names a usage limit or rate limit stops the batch and does not count toward any cap; the batch resumes in the next usage window.
  - Other API failures and void runs are rerun at most 2 times per run id. If a third attempt also fails for one of those reasons, the round stops, and the cause is fixed under the harness-bug rule before it resumes; such a run is never scored as a failure.
  - A harness-bug rerun replaces the earlier attempt (kept in `attempt-<n>/`, not scored), and its run's count of capped reruns starts again at 0.
  - A **counted run** is a run with a `run.json` that is not void.
- **Evidence:** right after each attempt exits (also on timeout), `run.mjs` copies that session's files only into `results/<id>/evidence/`:
  - `~/.claude/projects/<slug>/<sid>.jsonl`;
  - `<sid>/` with its subagent transcripts and `.meta.json`;
  - the mode record `~/.claude/section-team/modes/<sid>.json`.

  `<slug>` is the run folder with every non-alphanumeric character turned into `-`. The copy stops the batch loudly when the session file is missing, or when the mode record is missing for `lean`, `team` or `max`. `score.mjs`, `gate-stats.mjs` and `mode-check.mjs` take the session id from `session.json` (else, for runs without one, raw.json's id), and use it only if it is a plain id (letters, digits and dashes).
- **Cost of a run without `total_cost_usd`** (a timeout): it is computed from the copied transcripts' token usage at the per-token rates written in the freeze commit, by a method tested there, and marked in the table.
- **Preflight:** one run per setup (solo, lean, team, max), each in a run folder made by `prepareRun` (so lean and max get their mode file), with exactly the builders' binary, arguments, model, effort, `--settings` and environment.
  - It checks: the init `plugins` and section-team `path` and `version`; that no MCP server loads; the model and `claude_code_version`; that skill installs are off; and each session's mode record (`lean`, `balanced`, `max`; none for solo).
  - It lists `~/.claude/plugins/synced/` before and after and fails if that changed. It records the reference lists above.
  - It runs from the same shell the batches will use. About $1.

## Judging
- **Opus:** 9 groups (task × rep), 2 Opus judges each, with the pinned binary, `--model claude-opus-5-5 --effort medium`, `--verbose`, `--permission-mode default` (so a tool that needs permission runs only when `--allowedTools` names it: Bash only for `node`, `npm`, `ls` and `cat`; Write, Edit and web tools are refused), and the same clean `--settings` and environment as solo (section-team off). Each judge's init and transcript are checked like a solo run's (no plugin but the recorded built-ins, nothing under the live checkout, no MCP server, the round's version, model, `apiKeySource` and effort); a judgment that fails the check is void and re-asked under the re-ask rule. An attempt whose tool calls name a blind key (`blind-key` or `external-key`) or `bench/results`, or whose init shows another permission mode or none, fails its checks and is re-asked. Each judge sees all four solutions, labelled W, X, Y, Z by `anonymize.mjs` (positions rotated per group by task index + rep).
  - Judges see the folders and the label list in alphabetical order (W, X, Y, Z). Judge 2 sees the mirror of judge 1's assignment: the 1st label's folder swapped with the 4th's and the 2nd's with the 3rd's. So across a group's two judges each compared pair is seen in both orders. Edge-position counts per setup (how often it was a judge's first or last folder) are reported over the saved judgments; a left-out judgment is not counted.
  - `bench/judge-prompt.md` changes only its example answer, to show every label and a full four-item ranking; the rest stays word for word the held-out prompt. Judges rank all four with no ties.
  - Each judge's transcript is kept, and judges whose session compacted are listed (they still count).
- **Trial judge:** judge 1 of group h4-r1 runs first (`--limit=1`), after its own yes from the user. Its verdict counts as that judgment and is not rerun. Its measured cost sets the estimate for the other 17.
- **Unusable verdicts:** an Opus or outside verdict that fails the parser (missing score, non-integer, a ranking with ties or missing labels) is re-asked in a fresh session on the same case, in the same label order, at most twice. A usage or rate limit, an API error or a session with no result, a judge session with no transcript, or (Codex) a failed start or an error exit without a usable verdict stops judging without using an attempt; a resume asks again. If the third attempt is still unusable:
  - an Opus judgment is left out, so that group's qualities use its other judge, and it is listed; a group whose two Opus judgments are both left out drops out of every comparison and is listed;
  - an outside judge with any case still unusable does not count, and is reported as "not usable (k of 18)", where k is the number of usable cases.

  Every re-ask is listed.
- **Leak scan (before any judge runs):** over each anonymized solution, the harness lists every case-insensitive whole-word match of the frozen word list: section-team, section, supervisor, REPORT, GRADE, reviewer, near-miss, near miss, nearmiss, mutant, Lean, Balanced, Max mode, .team, ponytail. In file contents a letter or digit joins a word, and `-` or `.` joins one only between two letters or digits, so "boolean" and "clean-up" do not match "lean", "Lean." does, and ".team" matches only when no letter or digit comes before it. In relative paths only letters and digits join, so `near-miss-1-parse.mjs` matches. Words that contain `-`, `.` or a space match literally. The harness also lists as extra every file that is not `package.json`, a `*.md` file, a `.mjs`/`.js`/`.cjs`/`.html`/`.css`/`.json` file or a test path, and every file whose path has a word hit. A file link is scanned by its name and its target is not read; on Windows a folder junction is followed, so the files in it are scanned as the solution's. Nothing is edited or removed, so solutions stay as built. The hits and the test-line counts per setup are published beside the results as known tells.
- **Outside judges: Codex and Antigravity.**
  - **Cases:** each judge gets the same 18 cases: each group twice, case numbers shuffled (as `planCases` does).
    - In one case, A–D are the group's W, X, Y, Z renamed in that order; in the other, in mirrored order.
    - The case → group and label map is written only to `results/external-key-mo.json`.
    - The case set's root holds no README addressed to a judge; the user works from the frozen run sheet.
    - Right after `prepare`, before either judge opens a case, the set is copied once for the second judge, with no `verdict.json` and an empty `scratch/` in every case.
  - **Fresh session per case:** every case is judged in its own new session, with only that case's folder as the workspace and the tool's cross-conversation memory off where it has one. No case is judged in a session that has seen another case.
    - **Codex** runs headless per case: `codex exec --ephemeral --ignore-user-config -m <model> -c model_reasoning_effort="<effort>" --disable memories --skip-git-repo-check -C <case folder> -s <sandbox>`. The model and effort are copied from the user's `~/.codex/config.toml` (`gpt-6.1-sol`, `ultra` on 2026-11-01) into the frozen run sheet, because `--ignore-user-config` drops them. The sandbox is the least-privileged mode that works on this machine; on 2026-11-01 `workspace-write` blocked every command, and if only full access works, the user approves it first. Planning runs one throwaway case and shows from its `--json` events that the session loads no plugin, no MCP server and no memory; the runner records each exact command line. An attempt whose logged commands name a blind key (`blind-key`, `external-key`) or `bench/results` is unusable and re-asked.
    - **Antigravity** is run by hand, one new conversation per case. If the user does not run it that way, Antigravity does not count and is reported as not used.
  - They use no Claude usage. The write-up states how each judge was run.
- **Held-out check (unchanged rule):** each outside judge is first scored on the held-out round exactly as `docs/specs/2026-11-01-quality-modes-design.md` Measurement step 1 says and as `bench/external-judge` at c5ba259 computes it. The rule:
  - the team-minus-solo gap in 5-dimension quality is at least +0.5. The gap is the mean over the 9 held-out pairs of (team-ho quality − solo-ho quality), each computed by `judgeScores` in `bench/aggregate.mjs` from `judge-<as>.json` and `blind-key-<as>.json` alone, never through `results/summary.json`, and rounded to 2 decimals before the comparison (a test checks it gives +0.93 for `hoag`);
  - the outside judge picks the same pair winner as the Opus judges of round `ho` in at least 7 of 9 pairs. Following c5ba259's `pairWinners`, a pair's winner is the setup with the higher `overall` summed over that pair's judges; equal sums give "tie", which matches only a tie.
- **Fresh-session results decide.** Only a judge that passes counts below, and only results from fresh sessions decide: Codex as `hocx`, Antigravity as `hoag2`, each run per case under the procedure above. Each judges a new copy of the held-out case set, rebuilt from `~/bench-judge-ho` with the existing `external-key-ho.json` (same case numbers, pairs and label orders; `JUDGE.md` as c5ba259 writes it; no root README), made once per judge before that judge opens any case, with no `verdict.json` and an empty `scratch/` in every case. The earlier folders (`C:\Users\Asus\ag-judge`, `C:\Users\Asus\codex-judge`) are never reused.
- **Earlier one-session results are context only.** Antigravity's earlier verdicts (`hoag`, imported on 2026-11-01) and Codex's one-session run in the Codex app on 2026-11-01 (`hocx1`, over the cases it finished in `C:\Users\Asus\codex-judge`) are reported beside them:
  - `hoag` passed the rule (gap +0.93, same winner 8 of 9);
  - it was made in one session (verdicts written 16:11–16:26);
  - it gave every team solution 10 on every dimension.
- **Showing the size effect:** "more test lines" names, per pair or group, the setup whose solution has more test lines, counted as `score.mjs`'s `code.testLines` minus lines in files byte-identical to the seed's; equal counts give no prediction. In round `ho` its agreement is matched against c5ba259's `pairWinners` (8 of 9; counted from the committed `bench/data/heldout/summary.json`, which includes h2's seed test files: the same offset for both runs of an h2 pair, so no prediction changes). In round `mo` it is the share of a comparison's groups where that setup matches the sign of the Opus group gap, with a zero gap or an equal count counting as disagreement. It is shown next to each outside judge's count.
- **Held-out inputs:** `blind-key-ho.json`, `judge-ho.json`, `judge-hoag.json`, `blind-key-hoag.json` and `judge-prompt-ho.md` (c5ba259's `bench/judge-prompt.md`) are committed in `bench/data/heldout/`; `external-key-ho.json` exists only in the main checkout's git-ignored `bench/results`. The five JSON files are copied unchanged into `bench/results` of the checkout that runs the round (`judge-prompt-ho.md` is read in place by `rebuild-heldout`), and their SHA-256 hashes are listed in the write-up.
- **Recorded once:** each held-out verdict is written once to `results/outside-check-ho-<as>.json` (`gap`, `same`, `pairs`, `passed`), before any mode-round outside verdict is imported.

## Bars and rules (fixed in `bench/bars-mo.json`)
- **Quality** of a solution = the mean of the 5 judged dimensions (correctness, code quality, tests, robustness/security, docs/usability), averaged over its judges, as `bench/aggregate.mjs` computes it. Overall is reported beside it, not used for bars.
- **Group gap** for a comparison (mode vs comparator) = the mode's quality minus the comparator's in that group (same task and rep). **Gap** = the mean of the group gaps. **SD** = their sample standard deviation (divisor n−1). **95% range** = gap ± t(0.975, n−1) × SD / √n; with all 9 groups that is gap ± 2.306 × SD / 3.
- **Arithmetic:**
  - `bars.mjs` works from the unrounded per-judge scores, never from the rounded report table. It rounds each gap, Balanced's mean quality and the usage ratio to 2 decimals before comparing them with a bar. Each solution's quality is a multiple of 1/10 (1/5 with one judge), so every gap or mean over n ≤ 9 groups is a multiple of 1/(10n). For n = 4 or 8 such a value can lie exactly halfway between two 2-decimal values (for example 0.125), but no multiple of 1/(10n) with n ≤ 9 lies in [0.295, 0.30), [0.495, 0.50) or (8.600, 8.605), so no bar decision depends on how a halfway value rounds. The usage ratio is rounded as Math.round(Number((x × 100).toPrecision(12))) / 100.
  - Hidden-test pass rates are compared after rounding to 4 decimals.
  - A range "includes 0" when its unrounded lower end is at or below 0. Ranges are shown rounded to 2 decimals.
- **Bars:**
  - **Lean:** gap over solo at least **+0.30**, and usage at most **1.50×** solo's on h5 and h6, where usage = the mean cost over each setup's counted runs on those two tasks. A run's cost is its `total_cost_usd`, or, for a run without one, the cost computed from its transcripts (Runs). Lean's h4 cost is reported against Balanced's, not barred. If any counted h5 or h6 run in the comparison's groups has no cost (neither `total_cost_usd` nor a cost computed from its transcripts), or solo's mean cost there is not above $0, the usage ratio is not measured; a missing cost is never counted as $0. A Lean bar that is not already "not measured (n groups)" or "missed" on its gap or hidden-test part is then reported as "not measured (usage)", neither met nor missed. In the faithful-only check the usage ratio is shown as "not measured" and does not change the headline.
  - **Balanced:** gap over solo at least **+0.50**.
  - **Max:** gap over Balanced at least **+0.30**. If Balanced's mean quality over its counted runs is above **8.60**, the Max bar is reported as **"not measurable (scale ceiling)"**, and Max's result is its secondary measures. Above 8.60, Max would need more than 8.90; in the held-out round 4 of 180 dimension scores were 10 and the best task-cell mean was 8.93. This is decided once, on all counted Balanced runs, and also holds in the sensitivity check. With no judged Balanced run there is no mean, and the ceiling rule does not apply.
- **Hidden tests:** a bar is met only if the mode's mean hidden-test pass rate is not below its comparator's, over the same groups.
- **Noise label:** a met bar whose 95% range includes 0 is reported as "met, within noise".
- **Incomplete groups:** a comparison uses only the groups where both setups have a counted run. With n such groups:
  - the range uses t with n−1 degrees of freedom;
  - the hidden-test rule compares the same n groups;
  - the outside-confirmation threshold is ⌈0.75 × n⌉ of n (7 of 9 when complete);
  - the Lean usage bar uses the h5 and h6 runs in those groups;
  - with fewer than 6 groups, the comparison is reported as "not measured (n groups)", neither met nor missed.
- **Every run counts:** each run is scored as its setup whatever it did.
- **Faithful-only sensitivity check:** solo runs always count as faithful. A group enters a comparison's check only when both its runs are faithful. The check reports gap, range, n, the hidden-test rule and, for Lean, the usage ratio over the faithful groups' h5 and h6 runs, beside each bar; it has no outside confirmation and no "not measured" floor, and it never changes a bar's headline result or label.
- **Secondary measures** (reported, never bars):
  - **Rank wins:** over the 9 groups, a group counts for the mode when both its Opus judges rank it above the comparator, against it when both rank it below, and as split otherwise; a group with one usable judgment counts by that judge's ranking and is marked. Reported with the exact two-sided sign-test p over the non-split groups. The 18-judgment count is shown beside it without a p.
  - **Test strength (h5, h6):**
    - A solution's test files are the files Node's `--test` default patterns match in its folder, excluding files byte-identical to the seed's. A test file whose path holds a glob character (`[ ] * ? { }`, `+(`, `@(`) or a part starting with `-` is skipped and listed with its reason. Its test support files are every file those patterns match plus every file under a `test/`, `tests/` or `__tests__/` folder or named `*.test.js`/`.cjs`/`.mjs` (`score.mjs` `isTestPath`).
    - For each solution, one temp folder is built from the seed (h5 only), then the reference without its test support files, then the solution's test support files. In it, `node --test <file>` runs once per test file, alone, with `score.mjs`'s hidden-test environment and a 300 s limit; a file that passes is valid.
    - Each near-miss version is laid on top of the reference in a fresh folder built the same way, and it is caught when any valid file fails or times out. The share of near-miss versions caught is reported. A solution is "n/a" with its reason when it has no valid file, or when its `run.json` or folder is missing or unreadable.
    - H4 is not measured, because its tests need not go through a fixed module boundary.
  - The **tests** dimension on its own.
- **Outside confirmation** of a comparison. A **counting outside judge** is one that passed its held-out check and has all 18 mode-round cases usable. For each counting judge:
  - Its gap = the mean of its group gaps, each over its 2 cases; the Opus gap and group directions are the same over the 2 Opus judges. Its direction in a group is the sign of that group gap, and a zero on either side counts as disagreement.
  - The judge confirms the comparison when both gaps are non-zero with the same sign and the directions agree in at least 7 of 9 groups.
  - **Labels:** confirmation labels only met bars. The label is "met", then ", within noise" when the range includes 0, then ", outside-confirmed" when at least one outside judge counts and every counting judge confirms it, otherwise ", not outside-confirmed (<reason>)". The reason is one of: no outside judge passed its held-out check; no passing judge was usable in the mode round (each named, with "not usable (k of 18)" or "not used"); or <judge> disagrees (its count and gap).
  - A missed bar shows each passing judge's gap beside it, with no confirmation label.
  - The rule is computed for every comparison, including a Max comparison reported as not measurable. The "more test lines wins" agreement rate is shown beside each count.

## Mode fidelity (`bench/mode-check.mjs`)
Read-only, over `results/<id>/evidence/` and the run folder's `.team/`.

**Definitions:**
- A section is **woken** when the session or a subagent transcript has an Agent call with `subagent_type: "section-team:<id>"`, where `<id>` is a section head: backend, frontend, database, devops, mobile, uiux, ai-llm, testing, security or docs. Calls to reviewer, scout, coder, ai-engineer and data-scientist are not wake-ups. A later SendMessage does not count. **Builder sections** are every section head except testing, security and docs.
- A **reviewer call** is an Agent call with `subagent_type: "section-team:reviewer"`; no other agent type counts. Its model is the raw `message.model` of the first assistant line of its transcript that is not Claude Code's `<synthetic>` line; a call whose transcript has no such line is on no mode's model.
- A **caller** is the agent that made a reviewer call (`main` at the top level), as `gateSequences` in `bench/gate-stats.mjs` groups them.
- A **gate** is a run of one caller's reviewer calls in start order. A call starts a new gate when it is the caller's first, or when the caller got a new job between it and its previous reviewer call: for `main`, it made an Agent or SendMessage call to a builder section in between; for a section, a new message from another agent arrived in its transcript in between. Every other call is a **re-grade** of the current gate.
- A **fix round** is one re-grade. A review **fails** by the mode's mark (Lean: overall under 8; Balanced: overall under 8 or an item under 6; Max: overall under 9 or an item under 7), and a review with no readable GRADE counts as a fail. A gate **ends early** when its last review failed, fewer than the mode's fix rounds were used, and the caller made no further reviewer call before the run ended. **Grades again after a pass** means a re-grade whose previous review passed.
- A near-miss copy **sits outside `.team/`** when, at the end of the run, a file outside the run folder's top-level `.team/` and outside any `.git/` or `node_modules/` folder at any depth is byte-identical to a non-empty file under `.team/near-miss/`, has `near-miss`, `nearmiss` or `mutant` anywhere in its run-folder-relative path (ignoring case), or has `near-miss:` anywhere in its first line.
- A gate's final grade is never a fidelity condition; `gate-stats.mjs` reports it.

A run is **faithful** when all of its mode's rules hold:
- **All team setups:** the mode record names the expected mode (`lean`, `balanced`, `max`), and `.team/mode.json` still holds it at the end (none for `team`). On h4 only: the supervisor wakes the backend and frontend sections; it makes no Write, Edit or MultiEdit call on a file in the run folder other than files ending `.md`, files named `package.json` or `.gitignore` (in any folder) and files under `.team/` (other config files, such as `tsconfig.json`, count as source); and the docs section is woken (h4 asks for a README, and every brief wakes docs for multi-area work that asks for one).
- **Lean:**
  - Every reviewer call runs on a Sonnet model.
  - No gate ends early, has more than 1 fix round, or grades again after a pass.
  - On h4 the testing section is woken (for the final check). On h5 and h6 no section is woken.
- **Balanced:**
  - Every reviewer call runs on an Opus model.
  - No gate ends early, has more than 2 fix rounds, or grades again after a pass.
  - On h4 the testing section is woken. On h5 and h6 the testing section is woken and no other section is.
- **Max:**
  - Every reviewer call runs on an Opus model.
  - No gate ends early, has more than 3 fix rounds, or grades again after a pass; a gate that still fails after its third fix round is faithful.
  - The testing and security sections are woken on every task. On h5 and h6 no other section is woken.
  - At the end, `.team/near-miss/` holds at least one non-empty file, or a testing-section transcript has a Write, Edit or MultiEdit of a file under the run's `.team/near-miss/`, or a Bash or PowerShell command containing `.team/near-miss` (either slash, not followed by a name character); and no copy sits outside `.team/`.

Every team-setup run gets a row. A missing run.json, run folder or session evidence gives "no data"; one that cannot be read or parsed gives "run.json unreadable", "run folder unreadable", "session unreadable" or "mode record unreadable". Either way the run is not faithful.

A run that ends with a copy in place is scored as it is and listed. The write-up reports the tier each run's supervisor chose (from its own wake-ups, not those a section made), per task and mode.

## Gate stats
`bench/gate-stats.mjs` counts `team`, `lean` and `max` runs from their copied evidence. It keeps every graded item (not only overall) and judges first-try passes and final grades by each mode's own pass mark (Lean 8; Balanced 8 and no item under 6; Max 9 and no item under 7).

## Harness changes (all in the freeze commit, with tests)
- **`run.mjs`:**
  - h4–h6 time limits; `--round`/`--tag` agreement;
  - the pinned binary, model, effort, plugin worktree and auto-updater switch;
  - the clean `--settings`, `--strict-mcp-config` and `--verbose`;
  - the spawn environment;
  - `--session-id`, attempt folders, the API-failure rule, rerun caps and void runs;
  - the evidence copy;
  - the init checks and lists in `run.json`.
- **`preflight.mjs`:** all four setups with the builders' exact arguments (no Haiku override), the checks above, the binary copy and the round's recorded version.
- **`judge.mjs`:** the mirrored order for any number of labels; the pinned binary, model, effort, `--verbose`, clean settings and spawn environment; the init, effort, permission-mode and blind-key checks; transcripts kept; the re-ask rule.
- **`judge-prompt.md`:** only its example answer changes.
- **`aggregate.mjs`:** h4–h6 in its task order.
- **`external-judge.mjs`:**
  - Merged from `bench/external-judge` as a real git merge that keeps c5ba259 in history, pushed with the freeze commit.
  - Extended to 2–4 labels, the mirrored second case, per-comparison agreement, the second judge's copy, the run sheet in place of the root README, and the held-out verdict file.
  - The held-out check keeps c5ba259's `pairWinners` unchanged and shares no code with the mode-round rule. A test checks that for `hoag` it reproduces c5ba259's same-winner count (8 of 9) and gap.
- **New scripts:**
  - `bars.mjs`, which reads `bench/bars-mo.json` and writes `results/bars-mo.json` and a table; beside the bars, the table also prints Lean's h4 cost against Balanced's, the tests gap with its range (its SD is in the JSON), and the runs whose cost was computed from transcripts;
  - `mode-check.mjs`;
  - `test-strength.mjs`;
  - `leak-scan.mjs`;
  - a per-case Codex runner.
- **`gate-stats.mjs`:** as above.
- **`docs/benchmark-heldout-2026-11.md`:** "the mean of those six scores" becomes "five" (the code and the published numbers use five).

## Who builds it
- section-team sections build v0.2.1, the harness and the tasks, under the usual gate.
- Codex may implement harness pieces if its held-out check passes. It never authors tasks, hidden tests or references for a round it judges.
- The hidden-test author, the reference author and the size-floor counter are three different agents, none of which has read `brief/`.

## Publishing
- **`docs/benchmark-modes-2026-11.md`:**
  - setup, freeze commit and tag;
  - every bar with its gap, range, hidden tests, label and outside confirmation;
  - the sensitivity check and the secondary measures;
  - mode fidelity and the tier each run's supervisor chose;
  - gate stats, the leak scan, void runs, reruns and re-asks;
  - how each outside judge was run;
  - limits.
- **Raw data** in `bench/data/modes/` with the recompute command.
- **README:** the Modes table and the picker labels show the measured quality and usage with the round's date. A mode that misses its bar shows its honest number, and the label names the clean setup it was measured in. The label change ships as the next plugin version.

## Cost and approvals
- **Runs:** about **$114** of plan usage at measured and old multi-area rates (range $89–137); h4 drives about 60% of it.
- **Opus judges:** about **$23** (18 four-solution judges at about $1.30, to be measured by the trial judge).
- **Total:** about **$137** (range $109–163), plus a 5–10% rerun reserve. The preflight is about $1. Building the tasks and harness uses about $45–90 more of ordinary session usage.
- **Usage windows:** one batch per window (about $38 and 1.8 hours each).
- **The user says yes before:**
  - pushing the freeze commit and `v0.2.1`;
  - the preflight;
  - the runs, with the estimate;
  - the trial judge;
  - the other Opus judges, with the trial judge's measured cost;
  - running Codex headless, with its sandbox mode.

## Limits stated in advance
- **Few tasks and runs.** With three tasks and three runs per cell, the smallest reliably detectable gap is about 0.45 for a mode against solo and about 0.6 for Max against Balanced, so +0.3 bars can pass or fail on noise; the ranges show it. The range treats the 9 groups as independent: it describes run and judge noise on h4–h6 only, not how a mode would do on other tasks.
- **Scale ceiling.** Judges score 1–10 in whole numbers and almost never give 10 (4 of 180 dimension scores in the held-out round), so Max can hit the ceiling (the 8.60 rule).
- **Size bias.** Outside judges and Opus may both favour larger solutions; the "more test lines wins" rate shows how much agreement that alone explains. The leak scan lists other tells.
- **Measurement gaps.** Test strength is n/a for a solution whose tests import modules the reference lacks (2 of 18 h1 solutions on held-out data). Mode fidelity does not see files the supervisor writes through shell commands. Besides its own rules, Max's brief also differs from Balanced's in shared wording: v0.2.1 cut seven phrases to fit the 9000-character cap (for example, Max's small-task line drops "(one or two small functions)"). h5's hidden `npm test` check stops only the shell on a 120 s timeout on Windows; a hung solution's processes stay until the machine is cleaned.
- **h4's page tests** (7 of 38) restrict the script to a short list of browser APIs (no querySelector, dataset, event.target, res.ok, timers or AbortController), so they measure behaviour under that restriction, not idiomatic DOM code. Every setup gets the same restriction.
- **Untrusted code.** Outside judges and Opus judges run the solutions' code on the user's machine.
- **Judges' reach.** Opus judges' allowed tools (Read, Glob, Grep, and Bash for node, npm, ls and cat) are not confined to the copied case folder. The harness rejects an attempt whose tool calls name a blind key and keeps every judge transcript, but it sees only tool calls that spell out a key's file name or the results folder; a wildcard, a folder-wide search or a path built at run time goes unseen. Transcripts are kept for every attempt that returns a result. Outside judges are not confined either: Codex's sandbox limits writes, not reads; its logged commands get the same check. Antigravity, run by hand, leaves no tool record.
- **The baseline is the user's, minus plugins.** Builders and Opus judges still read the user's `~/.claude/CLAUDE.md` and `~/AGENTS.md`, and keep the user-level skills, agents and rules (the same set in every setup).
  - CLAUDE.md names skills from plugins that are off in every run (superpowers, frontend-design), and the synced skills are off too; a session that asks for one gets an error and carries on.
  - h1–h3 ran from inside the desktop app, with its session environment; this round strips it, so the built-in plugin list may differ from h1–h3's (the preflight records it).
  - Section agents and the reviewer skip CLAUDE.md, so it steers solo's whole run but only the supervisor in team setups.
  - Solo here is therefore neither bare Claude Code nor the user's everyday setup, and h1–h3 (solo 8.16) ran with the user's plugins on, so the two rounds' numbers are not directly comparable.
- **Outside judges' own instructions.** Outside judges read their own global instructions.

## Out of scope
A gate-off setup, other languages, automatic mode picking, more reps, and any tuning on h4–h6.
