# Contributing to section-team

Thanks for helping. Bug reports and ideas go through the issue forms; code changes go through pull requests.

## Set up
1. Install Node.js (tested on v26) and Claude Code with plugin support.
2. Clone the repo and try your copy: `claude --plugin-dir <path-to-section-team>`.

## Before you open a pull request
Run every check and make sure all pass:

```bash
npm test
npm run test:board
npm run validate
node scripts/gen-agents.mjs --check
node --test bench/*.test.mjs
```

## How the code is organised
- `brief/supervisor.md` is the supervisor's instructions, injected at session start.
- `agents/*.md` are generated. Never edit them by hand: change the roster or the shared text in `scripts/gen-agents.mjs`, then run `node scripts/gen-agents.mjs`.
- `hooks/` holds the hooks (session start, the handback gate, report saving) and the Team Board (`hooks/register.tsx`).
- `skills/add-skill/` is the procedure for reviewing and installing a skill from GitHub.
- `bench/` is the benchmark harness. A benchmark round runs real paid Claude sessions, so only run it if you know the cost.

## Rules
- Write the failing test first for any change in behaviour, then make it pass.
- Keep files and functions small, validate input at boundaries, and never swallow errors.
- Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Never commit secrets, keys or personal paths.
