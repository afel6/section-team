# Phase 0 results (2026-10-12)

One headless run: `claude -p --plugin-dir` on Claude Code 2.1.296, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset, 4 agents spawned (1 `section-team:spike-a` on `claude-opus-5-5`, 1 `section-team:spike-b` on haiku, 2 helpers). Cost about $2.00 (the Fable helper dominates). Values below are observed from `.spike/events.jsonl`, `.spike/agents.jsonl`, `spike-output.json` and the agent transcripts.

| Check | Observed | Decision |
|---|---|---|
| C1 SessionStart additionalContext reaches the model | true (head printed `[spike-marker-7731]` on line 1) | none, design holds |
| C2 agent_type form | `section-team:spike-a` and `section-team:spike-b` in SubagentStop and in PreToolUse from subagents; helpers show `general-purpose` | D1 agentTypeForm = `section-team:<name>` (e.g. `section-team:spike-a`) |
| C2 last_assistant_message present | false. SubagentStop keys are only: session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, agent_id, agent_type, effort, hook_event_name, stop_hook_active, agent_transcript_path, background_tasks, session_crons. The report sits in `agent_transcript_path` as the last `SubagentHandback` tool_use (`input.message`), not as plain assistant text | saver relies on transcript fallback (Task 6): read the last `SubagentHandback` tool_use `input.message`, else the last assistant text |
| C3 head model | `claude-opus-5-5` (init message, `modelUsage`, spike-a transcript) | Opus 5.5 confirmed, no action |
| C3 helper models | haiku helper = `claude-haiku-5-5`; fable helper = `claude-fable-5-1`; `modelUsage` lists claude-opus-5-5, claude-haiku-5-5, claude-fable-5-1. spike-b (`model: haiku`) ran as `claude-haiku-5-5` | fable present: Task 5 does NOT need `agents/fable-consultant.md` for availability |
| C4a direct message to running sibling | false. alpha to `beta` by name: `No agent named 'beta' is reachable. ... use the agent ID from a background agent's spawn result` | D2 messaging = relay (see D2) |
| C4b direct message to completed sibling | false. Same error for `PING-COMPLETED-456` (beta had already stopped). beta's transcript has neither ping | (see D2) |
| C5 reuse fires 2nd SubagentStop with new REPORT | true. Head's SendMessage to alpha by name failed (`No agent named 'alpha' is reachable`); by agent id it succeeded (`Resuming agent ab27583`), alpha got the job, a 2nd SubagentStop fired (same `agent_id` and transcript) and its `SubagentHandback` message contains `SECOND-JOB-789`. The checker printed `C5_secondJobReported: false` only because it reads the absent `last_assistant_message` | D3 reuse = message (address by agent id, never by name) |
| C6 preloaded skill in context | true. `tdd-workflow` is injected as a skill message at the start of alpha's transcript, and alpha reported it. The checker printed `C6_skillsMentioned: false` for the same `last_assistant_message` reason | D4 skillsPreload = works |
| C6 memory folder name | `section-team-spike-a` (empty dir, created at spawn, under `~/.claude/agent-memory/`) | D5 memoryDir = `section-team-spike-a` (pattern `section-team-<agent-name>`) |
| C7 $.agent.list() entry shape | `{ id, description, type, status, parentId? }`. `status` seen: `running`, `waiting` (alpha while blocked on helpers). `parentId` only on children spawned by a subagent. No `name` field | board keys on `type` (Task 8); label comes from `description` |
| C8 classic hooks + module in one hooks.json | mixed. `claude plugin validate --strict` passed with `hooks` + `modules` together; at runtime the classic hooks (SessionStart, PreToolUse, SubagentStop) and the `agent.spawn` module both fired (`agents.jsonl` has 3 rows) | D6 hooksLayout = mixed |

## Decisions

- D1 agentTypeForm = `section-team:<name>` (exact example: `section-team:spike-a`)
- D2 messaging = `relay`
- D3 reuse = `message`
- D4 skillsPreload = `works`
- D5 memoryDir = `section-team-spike-a` (real agents: `section-team-<agent-name>`)
- D6 hooksLayout = `mixed`

## Findings later tasks must account for

- The `Agent` tool has no `name` parameter here (the head said so before spawning). The label goes in `description`. `SendMessage` `to` accepts only the agent id from the spawn result; names and descriptions are not reachable, from the head or from siblings. The supervisor must keep section name to agent id (from the spawn result, `$.agent.list()` or SubagentStop `agent_id`) and send jobs to the id. This is why D2 is `relay` and why D3 works by id only.
- Resuming a stopped agent by id re-delivers the job as "The coordinator sent a message while you were working" and fires another SubagentStop for the same `agent_id` and `agent_transcript_path`.
- The `agent.spawn` module event carries `subagentType` and `model` (only when requested) but no `name`. One of the four spawns (the Fable helper, launched in parallel with the Haiku one) did not get a row in `agents.jsonl`, most likely from the spike's non-atomic read-then-write on one file. Do not assume one row per spawn from that pattern.
- `claude plugin validate --strict` prints a non-fatal note "gating hook without .catch: agent.spawn" for a module that awaits `next(e)` without a `.catch`.
- A foreground `Bash sleep 45` is blocked by the harness; agents must use `run_in_background` or Monitor. Irrelevant to the design, noted because it broke the spike's beta job.
