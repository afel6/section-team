# Security policy

section-team runs hooks on every prompt and on every Write, Edit, MultiEdit, NotebookEdit, Bash, PowerShell, Agent, SubagentHandback and SendMessage call in every session, can stop processes (the opt-in memory guard), and can install third-party skills into `~/.claude/skills` (through `section-team:add-skill`). Please report a problem in any of these privately.

## Report a vulnerability
- Private vulnerability reporting: not enabled yet (checked 2026-11-23), so this repository's private advisory form does not work. Until it is, open an issue titled "Security contact request" that holds no detail of the problem, and the maintainer will arrange a private channel with you.
- Do not put any detail of a vulnerability in a public issue, pull request or discussion.
- Say which version you ran (the `Plugin:` line at the end of any file in `.team/reports/`), how you installed it (marketplace or clone), your OS and Claude Code version, and the steps to reproduce.

## What to expect
- One person maintains this plugin, on a best-effort basis. You should get a first reply within 7 days.
- A confirmed problem is fixed on `main`, released as a new version, and credited to you in the release notes unless you ask otherwise.

## Supported versions
Only the latest release gets fixes.

## In scope
- A project file (anything a cloned repo can commit, such as `.team/`) that changes what the plugin does beyond that project, or turns on something the user did not turn on.
- A skill install that skips the user's question when it should not, or writes outside `~/.claude/skills/<name>`.
- The memory guard stopping a process it should not, or starting when it is off.
- A hook that lets a section write where its rules say it cannot, or that leaks secrets, prompts or paths into files or messages it should not.

## Known limits
- The reviewer holds Bash: it is told never to edit, but it can run any command your permissions allow.
- The memory guard stops processes by the session's process tree: anything the session started that goes over the limit, the session's MCP servers included.
- `bench/` ships in the plugin, because the marketplace installs the whole repository; it runs only when you start it by hand.
- A project's `.claude/settings.json` can add hooks, and its `env` can repoint the `opus` alias (`ANTHROPIC_DEFAULT_OPUS_MODEL`) for every section head. The plugin's check of project settings covers only the install switch (`SECTION_TEAM_AUTO_INSTALL_SKILLS`) and `HOME` or `USERPROFILE`.
- Every push to `main` ships, because the marketplace serves the repository as it is on `main`; so `main` moves only at releases.

## Out of scope
- What a model chooses to do inside the permissions you gave Claude Code; the plugin's review steps reduce this risk but do not remove it.
- What a project's own `.claude/settings.json` does through Claude Code itself (hooks, and environment variables other than the three the plugin checks): review that file in repos you clone.
- The benchmark harness under `bench/`, which runs only when you start it by hand.
