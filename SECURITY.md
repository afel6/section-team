# Security policy

section-team runs hooks on every Write, Edit, Bash, PowerShell, Agent and SendMessage call in every session, can stop processes (the opt-in memory guard), and can install third-party skills into `~/.claude/skills` (through `section-team:add-skill`). Please report a problem in any of these privately.

## Report a vulnerability
- Use GitHub's private reporting: <https://github.com/afel6/section-team/security/advisories/new>.
- Do not open a public issue, pull request or discussion for it.
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

## Out of scope
- What a model chooses to do inside the permissions you gave Claude Code; the plugin's review steps reduce this risk but do not remove it.
- The benchmark harness under `bench/`, which runs only when you start it by hand.
