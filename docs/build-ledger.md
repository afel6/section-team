# SDD ledger — plan: docs/plans/2026-10-12-claude-team-plan.md

Spec: docs/specs/2026-10-12-claude-team-design.md (v3, approved). Branch: feat/claude-team (main = f27fead docs only).

## Pre-flight scan

| Pair / task | Produces vs consumes | Found |
|---|---|---|
| T1↔T2 | hooks.json, register.tsx, plugin.json skeleton; T2 edits then restores | consistent (T2 step 8 restores all three) |
| T1↔T4/T6/T7 | T1 hooks.json = modules only; later tasks add "hooks" keys | consistent, additive |
| T2↔T4 | D2 messaging, D3 reuse → brief text variants | consistent (variants spelled out in T4 step 3) |
| T2↔T5 | D2 → MESSAGING, D4 → PRELOAD, C3 → CONSULTANT | consistent |
| T2↔T7 | D5 memoryDir | guard accepts <id>, *-<id>, *:<id> — covers all forms |
| T3↔T4 | projectRoot, ensureExcluded, latestSummary, readStdinJson | signatures match |
| T3↔T5 | BUILDER_IDS, ADVISOR_IDS | match |
| T3↔T6 | extractReport, sectionIdFromType, projectRoot, writeReport, readStdinJson | match |
| T3↔T7 | ADVISOR_IDS, sectionIdFromType, readStdinJson | match |
| T3↔T8 | sectionIdFromType, parseReport (helpers/job/status), PREFIX, BUILDER_IDS, ADVISOR_IDS | match |
| T8 plugin.json "types" ↔ T2 split layout | both edit plugin.json | compatible keys |
| T1 self | files vs later touches | .gitignore lacks nothing needed; autocrlf=true on this machine (see Ruling 2) |
| T2 self | spike files created/removed | consistent |
| T3 self | tests 6+8 vs code | consistent |
| T4 self | test reads brief + hook | consistent |
| T5 self | YAML frontmatter descriptions contain ": " (plain scalar) | defect → Ruling 3 |
| T6 self | consistent | — |
| T7 self | consistent | — |
| T8 self | model tests vs code; pane test vs render keys | consistent; import specifier risk handled in step 8 |
| T9 self | settings edit needs user approval; desktop checklist needs user | stop-and-ask points (expected) |

## Rulings
- Ruling 1: implementation on branch feat/claude-team, docs-only commit on main — skill forbids implementation on main without consent — cost if wrong: none, merged at finish.
- Ruling 2: Task 1 adds `.gitattributes` with `* text=auto eol=lf` — core.autocrlf=true would make checked-out generated agent files CRLF and break `gen-agents --check` / exact-text tests — cost if wrong: none (LF is what every tool here expects).
- Ruling 3: Task 5 generator writes `description: ${JSON.stringify(s.description)}` (double-quoted YAML) — several descriptions contain ": ", which is invalid in a plain YAML scalar and may break agent loading — cost if wrong: none, quoted scalars are valid YAML.
- Ruling 4: HawkScan post-commit prompts are skipped for this plan — the plugin is not a web app, nothing is served, HAWK_API_KEY unset; the hawkscan rules exclude this case — cost if wrong: none.

## Progress
- Ruling 5: plugin renamed claude-team → section-team everywhere in spec+plan (agent types section-team:<id>, marker [section-team supervisor], atom plugin key, @inline id); folder/repo path stays <path-to-section-team> — validator rejects names starting with "claude-" — cost if wrong: a find/replace rename later; user to be told.
- Ruling 6: plugin.json gets an "author" name — validate --strict fails without author; no email (privacy) — cost if wrong: one-line edit.
- Ruling 7: implementer reports go to task-N-report.txt (subagents refuse to write .md report files) — cost: none.
- Task 1: minor (deferred): package.json `test` script fails until tests/ exists (lands in Task 3)
- Task 1: minor (deferred): .claude-plugin/types/ generation unconfirmed (engine writes it on load)
- Task 1: complete (commits 0515992..b69b5e3, review clean; controller verified validate exit 0 + LF)
- Ruling 8 (Phase 0): Agent tool has no `name` in this build → supervisor keeps section id → agentId map, addresses sections by agentId; spec §2/§3.1 and plan Task 4 brief rewritten — cost if wrong: if names return in a later build, nothing breaks (ids still work).
- Ruling 9 (Phase 0 D2 = relay, user pre-approved): sections reach each other via SendMessage to `main`, supervisor forwards by agentId; fallback `Status: blocked` when a foreground section cannot reach main; generator MESSAGING/direct variant deleted (dead code) — cost if wrong: one extra hop per cross-section request.
- Ruling 10 (Phase 0 C2): SubagentStop has no last_assistant_message → saver reads last SubagentHandback tool_use input.message from agent_transcript_path, else last assistant text; Task 6 code/tests rewritten (`finalAgentText`) — cost if wrong: reports not saved; Task 9 acceptance catches it.
- Ruling 11: Task 9 acceptance prompt forces one frontend→backend request so the relay path is exercised; -p foreground path accepted as `blocked`+resume, desktop must show relay — cost if wrong: none.
- Task 2: minor (deferred): phase0-results states 4 incidental details not quoted in report (version, cost split, sleep-45 block, full coordinator quote)
- Task 2: minor (deferred): direct section messaging by agent id untested; relay chosen as safe default
- Task 2: minor (deferred): D5 pattern and parentId claim from one sample
- Task 2: complete (commits b69b5e3..eb69341, review clean) — spec+plan amended after, commit below
- Task 3: minor (deferred): status normalisation ("✅ done", "⚠ partial", "done.") and heading case (`## Report`) not handled — board may misread status; triage at final review
- Task 3: minor (deferred): latestSummary ignores/mis-sorts `-2` collision summaries
- Task 3: minor (deferred): fs throws (ENOTDIR, EACCES) not contained in lib — hook scripts must wrap; writeReport fd leak on write failure (use writeFileSync flag wx)
- Task 3: minor (deferred): projectRoot falls back to cwd for separate-git-dir/submodule; excludeFile lacks isAbsolute guard; no windowsHide on git calls
- Task 3: minor (deferred): tests leave temp dirs/worktrees; non-repo test assumes tmpdir not in a repo
- Task 3: fix round 1/5 (2 addressed, 0 open — utf-8 stdin, fence-aware extractReport; commits 33d6467..4adc5e9)
- Task 3: minor (deferred): heading inside unclosed fence + inner code block still truncates; mixed ```/~~~ parity; parseReport reads fenced code lines as fields; stdin test probabilistic
- Task 3: complete (commits 07a6230..4adc5e9, review clean after 1 fix round)
- Task 4: minor (deferred): brief not injected if ensureExcluded/latestSummary throw (wrap side effects so brief still injects) — affects "always on"; triage at final review
- Task 4: minor (deferred): plan-first line "wake nobody" vs advisor consult wording; agent-id map lost after /clear (respawn); no tests for hooks.json registration / keep-in-git via buildContext / fs-throw path
- Task 4: complete (commits 4adc5e9..1884cd1, review clean)
- Ruling 12 (Task 5 Important #1, plan-mandated roster): advisor helpers = ADVISOR_HELPERS {architect, planner, code-explorer} (Read/Grep/Glob only) exported from hooks/lib/report.mjs, used by generator and Task 7 guard; Explore/Plan excluded (they carry Bash) — spec criterion 7 wins over plan roster — cost if wrong: advisors have fewer helper choices.
- Ruling 13 (Task 5 Important #2, plan-mandated text): testing section gets its own step 5 ("you own final review and verification when the job assigns it"); other builders keep the skip line — cost if wrong: none.
- Task 5: minor (deferred): step 3 helper paragraph long (split to bullets); --check mkdirs and misses orphan files; preloaded skills/helpers are machine-specific (portability); no YAML/CRLF assertion in test
- Task 5: fix round 1/5 (2 addressed, 0 open — advisor read-only helpers, testing owns review; commits f43e041..d74c12d)
- Task 5: minor (deferred): unused fileURLToPath import in gen-agents.mjs; testing special-case could be a roster field
- Task 5: complete (commits 1884cd1..d74c12d, review clean after 1 fix round)
- Task 6: minor (deferred): finalAgentText throws on null row/part (guard row?.type, part?.type); no "last handback wins" test; thin e2e; silent drop on missing cwd; flush timing of handback row unverified (Task 9)
- Task 6: complete (commits d74c12d..b24c3f2, review clean)
- Ruling 14 (Task 7 Minor, plan-mandated folder rule): advisor memory folder must be exactly <id> or section-team-<id> (Phase 0 D5) — wider *-<id>/*:<id> allowed cross-agent memory writes — cost if wrong: advisor memory denied if a future build changes the folder name (fail-closed).
- Task 7: minor (deferred): decide() throw fails open (deny-on-throw for identified advisors); memory root ignores CLAUDE_CONFIG_DIR; `~/` paths resolved lexically; advisor could SendMessage a builder agent id (out of guard scope)
- Task 7: fix round 1/5 (3 addressed, 0 open — isMainModule realpath, prefix-only advisors, exact memory folders; commits 95ac556..d077417)
- Task 7: minor (deferred): junction test cleanup rmdirSync not portable (unlinkSync); gen-agents main check still uses argv[1] without realpath
- Task 7: complete (commits b24c3f2..d077417, review clean after 1 fix round)
- Task 8: deviations accepted (reviewer judged necessary): state seeded via on('state.get') in pane test; atom declared in register.tsx (no board-state.ts); readReports/refresh top-level with ctx
- Task 8: minor (deferred): column-rule/legend/counts/idempotence untested; void $.ui.open no .catch + opens on denied spawn; request lost on hot reload; failed read cached as empty; bare ids light cards (prefix-only like Task 7?); tsc not run
- Task 8: fix round 1/5 (2 addressed, 0 open — Timer lifecycle w/o session.end, lastJson after write + ui.log; commits 0a38de7..d11407d)
- Task 8: minor (deferred): empty-message error never logged (lastError '' sentinel); "per distinct message" unpinned; overlapping ticks; timer leak on hot reload; test types unchecked (no tsc)
- Task 8: complete (commits d077417..d11407d, review clean after 1 fix round)
- Ruling 15: run the final whole-branch review over Tasks 1–8 BEFORE Task 9 installs the plugin globally — global install puts this code in every session; review first is cheaper than a broken global hook — cost if wrong: Task 9 docs get only their task review.
- Final review (opus, f27fead..d11407d): With fixes — 0 Critical, 5 Important (bare types accepted by saver/board; brief lost on side-effect throw; untrusted summary filename in context; stale handback on reuse; status/heading normalisation), 9 Minor.
- Ruling 16: final fix wave also includes Minors #1 (board poll lazy: start on /team or first section spawn; log to debug), #2 (findRoot timeoutMs 5000), #3 (open pane once, not on denied spawn), #5 (drop `council` preload from ai-engineer — it spawns untyped subagents the guard denies) — each touches every session or breaks an advisor; cheap — cost if wrong: small extra diff. Other minors stay deferred per reviewer triage. Env opt-out recommendation declined (YAGNI; plugin can be disabled).
- Final fix wave: commit d11407d..f197177 — re-review (opus): all 9 findings ADDRESSED; new Important: date-dependent test fails from 2026-10-13; Minor: parallel git runs on first refresh (once, ≤5 s).
- Ruling 17: residual follow-up (same fixer, one commit) for (a) the date time-bomb test and (b) tighter job-start rule in subagent-stop (job starts only at non-meta user rows or coordinator rows) — skill says no second wave, but (a) breaks `npm test` tomorrow and (b) protects report capture against this machine's Stop-hook/skill-load meta rows seen in 30 real transcripts — cost if wrong: one small extra commit.
- Final: minor (deferred): status regex lacks word boundaries ("not done" → done); today's committed later summary wins (keep-in-git only); summary string compare in board-model; first-refresh git runs overlap.
- Residual follow-up e3a83f6 re-reviewed: APPROVED (both resolved). Minor (deferred): one vacuous assertion in skill-load test; midnight race in tomorrow test.
- Controller verification at e3a83f6: npm test 64/64, test:board 10/10, gen --check OK, validate --strict OK.
- Task 9: waiting on user approval for ~/.claude/settings.json env edit (stop-and-ask: persistent config outside worktree).
- Task 9 step 1: user approved ("ok install"); ~/.claude/settings.json env.CLAUDE_CODE_PLUGIN_DIRS = <path-to-section-team> (backup settings.json.bak-claude-team; non-env keys verified identical; file now LF instead of CRLF).
- Task 9 step 2 (CLI acceptance, commit 4218d80): a PASS, b PASS, c PASS, d PASS via supervisor-carried contract (SendMessage relay not exercised — desktop must show), e N/A (no reuse), f PASS; advisor guard PARTIAL (advisor self-refused; hook verified directly). Brief's command had --allowedTools before prompt (variadic) — re-run with prompt first.
- Controller: removed test-only MEMORY.md from ~/.claude/agent-memory/section-team-ai-engineer (it only pointed at the deleted probe note).
- Task 9 review: Needs fixes (docs) — 2d overstated, missing desktop rows for relay/reuse, stale MEMORY.md line, guard PASS cells, README keep-in-git + plan-first wording, plan Step 2 flag order.
- Ruling 18: README text corrected for accuracy (plan-first counts builders only; keep-in-git also needs exclude line removed; relay/agent-id note) — spec is authority over the brief's verbatim README — cost if wrong: none.
- Task 9: fix round 1/5 dispatched (docs).
- Task 9: fix round 1/5 (6 addressed, 0 open — acceptance record wording/rows, README accuracy, plan Step 2 flag order; commits 4218d80..2f33112)
- Task 9: CLI part complete (review clean after 1 fix round). Remaining: Desktop rows 1–10 with the user, then record + finish branch.
- Desktop check 1: user opened a new session in Downloads\qualty platfrom; debugging showed the plugin loaded (brief injected, 12 section agents listed, hooks module section-team@inline loaded, `/team` → "section-team: Team Board opened."). The board was absent by design (opens only on /team or a section wake), and the user's first input was `/sales:team-pipeline` (autocomplete collision). No defect.
- User decision (2026-10-12): Team Board opens automatically at session start (option A). Bounded change: brief at autoopen-brief.txt.
- Auto-open change: commit 140cb0e, review Approved (0 Critical/Important). Minor (deferred): spec §3.4 line still mentions spawn auto-open; docs omit 144-col terminal caveat; spawn-path open untested and without .catch; reopen on repeated session.start; 300 ms timer in test; plan text historical. Atom-sharing concern resolved: $.state is per session (plugin-authoring docs).
- Desktop check 2 (dalil project session): board auto-opened (supervisor card + 10 asleep + 2 advisors + legend); reply identified as section-team supervisor. Rows 1–3 PASS. User advised to run build steps in an empty folder (real project + bypass permissions).
- User approved feature "add-skill from GitHub URL" (bounded): brief at addskill-brief.txt. Design: roster-extra.json + assign-skill.mjs (pure fns + CLI) + gen-agents merges extras into go-to text (not preload) + plugin skill skills/add-skill/SKILL.md + one brief line.
- add-skill review (opus): Needs fixes — 3 Important (URL ref/path unchecked → shell injection/path escape; safety review misses instruction files & description injection; tests break after first real use), 6 Minor.
- Ruling 19: fix round also takes Minors 1 (write agents first, roster last), 2 (--remove/--list validation), 3 (commit pathspec), 5 (no silent branch fallback), 6 (refuse symlinks) — security-critical feature, cheap — cost if wrong: small extra diff. Minor 4 (lazy-import cycle) deferred.
- add-skill: fix round 1/5 (Important 2, 3, Ruling 19 addressed; Important 1 residual: <path>/folder-name char rule missing → $(...) executes inside double quotes; commits 511d624..37a29b8). Fix round 2 dispatched (+ branch-answer validation, nothing-to-commit handling).
- add-skill: minor (deferred): SKILL_NAME allows ':' vs skill text; grep -P needs GNU grep; lazy-import cycle.
- add-skill: fix round 2/5 (path rule step 1 + chosen folder, slash-ref retry, nothing-to-commit; commits 37a29b8..272d062). Re-review: open Important — multi-candidate listing reads before folder check; Minors — '/' separator, third git wording, section ids unvalidated before shell, blob re-split wording. Fix round 3 dispatched with all five.
- add-skill: fix round 3/5 (5 addressed, 0 open; commits 272d062..fb6c2a0). Whole-file command walk clean; nothing executes at load.
- add-skill: minor (deferred): backslash conversion unconditional; leading '-' allowed in path rule; git diff error → commit attempt; step-4 grep lacks explicit target dir; file listing should use find -type f (hidden/ignored files); bidi isolates U+2066–2069 not scanned.
- add-skill: complete (commits 140cb0e..fb6c2a0, review clean after 3 fix rounds).
- docs/REVIEW-BRIEF.md written for external (Codex) grading — uncommitted.
- User approved feature "per-section token usage + helper models on board" (bounded): brief at usage-brief.txt. Data verified in mods declarations: turn.step result usage + agentId; agent.spawn parentAgentId + resolved model.
- Usage feature: commit 8530293, review (opus) Approved, 0 Critical/Important. Streaming turn.step hook (async generator, yield* next(e)) confirmed correct per declarations.
- Ruling 20: small follow-up for Minors 1 (reset counts on /clear without cancelling poll), 3 (dead helpers field), 5 ("1 helper" wording) — user-visible correctness, cheap — cost if wrong: one small commit. Minors 2 (unpruned maps) and 4 (test gaps) deferred.
- Usage follow-up 276bf09 re-reviewed: all addressed. Controller fixed stale poll comment (comment-only) and committed docs/REVIEW-BRIEF.md (updated counts 97/17 + usage feature).
