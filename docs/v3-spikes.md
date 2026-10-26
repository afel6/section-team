# v3 runtime spikes (2026-10-24)

One headless run: `claude -p ... --output-format json --allowedTools "Agent,SendMessage,Skill,Read"` on Claude Code 2.1.296 (`claude --version` on this machine), Windows 11, Git Bash. Throwaway project with three agents in `.claude/agents/`: `spike-peer` (Sonnet, Read+SendMessage), `spike-lead` (Sonnet, Agent+SendMessage+Skill), `spike-helper` (Sonnet, Read+Skill). The main session spawned `spike-peer` in the background, noted its agent id (`ab10630c43e527adb`), then spawned `spike-lead` with that id in its prompt. The lead sent `PING-S2` to the id and spawned `spike-helper`, which loaded `tdd-workflow`. First run was conclusive, so there was no second run.

Decisions (later tasks read these two lines verbatim):

S2: direct
S3: skill-tool

## S2: can one subagent SendMessage a sibling by agent id?

Yes. The lead (a subagent, spawn depth 1) addressed the peer by the id from the Agent tool's spawn result and the message was delivered.

Evidence, quoted from `spike.json` (lead's own tool call and its result, `parent_tool_use_id` = the lead's spawn):

- lead tool call input: `{"to":"ab10630c43e527adb","message":"PING-S2","type":"message","recipient":"ab10630c43e527adb","recipient_kind":"agent","content":"PING-S2"}`
- lead tool result: `{"success":true,"message":"Resuming agent ab10630","pin":{"id":"ab10630c43e527adb","name":"ab10630c43e527adb","ref":"4f0b56"}}`
- lead final report (reached the main session): `SEND-RESULT: {"success":true,"message":"Resuming agent ab10630", ...} (peer later replied: PEER-GOT:PING-S2)`
- main session summary of the peer: `Second stop, after lead's SendMessage resumed it: PEER-GOT:PING-S2`

Evidence from the peer's own transcript (`subagents/agent-ab10630c43e527adb.jsonl`; this is the transcript the brief's pass condition refers to). The message came from the lead's id (`af0a0aa682274b8e8`, `agentType: spike-lead` in its `.meta.json`), not from the main session:

- `Another Claude session sent a message while you were working: <agent-message from="af0a0aa682274b8e8"> PING-S2 </agent-message>`
- peer reply: `SendMessage {"to":"af0a0aa682274b8e8","message":"PEER-GOT:PING-S2", ...}` and final handback `{"message":"PEER-GOT:PING-S2"}`
- lead transcript (`agent-af0a0aa682274b8e8.jsonl`) received it back: `<agent-message from="ab10630c43e527adb"> PEER-GOT:PING-S2`

Notes and limits:

- The peer had already stopped (it handed back `PEER-READY` as soon as it started, it cannot idle-wait). The id-addressed SendMessage resumed it ("Resuming agent ab10630"). So this proves id addressing works, including for a stopped sibling. It did not test a sibling that is mid-turn at the moment of the message; the earlier by-name failure (phase0 rows C4a/C4b: `No agent named 'beta' is reachable ...`) stands for names.
- Delivery to a running agent is queued ("Message queued for delivery to af0a0aa682274b8e8 at its next tool round" was the peer's own send result to the lead), so a message to a busy sibling lands at its next tool round.
- Consequence for design: sections can message a sibling directly, but only if they hold its agent id, and ids only come from the spawn result (the main session). Names do not work.

## S3: can a helper subagent load a user skill with the Skill tool?

Yes. `spike-helper` was spawned by `spike-lead` (spawn depth 2, `parentAgentId` = the lead), had tools `Read, Skill`, and loaded the user skill `tdd-workflow` from `~/.claude/skills/tdd-workflow/SKILL.md`.

Evidence, quoted from the helper transcript (`subagents/agent-a46cc605189a96fe4.jsonl`):

- tool call: `Skill {"skill":"tdd-workflow"}`
- tool result: `Launching skill: tdd-workflow`, then the skill body: `Base directory for this skill: ~\.claude\skills\tdd-workflow` ... `# Test-Driven Development Workflow` ... `This skill ensures all code development follows TDD principles with comprehensive test coverage.`
- helper final handback: `{"message":"# Test-Driven Development Workflow"}`

Evidence from `spike.json`: lead final report `HELPER-RESULT: # Test-Driven Development Workflow`. The first heading in the SKILL.md on disk is `# Test-Driven Development Workflow`, so the returned text is real skill content, not a guess.

Note: the skill is a user-level skill (`~/.claude/skills`). Plugin-provided skills (for example `superpowers:...`) were not tested here.
