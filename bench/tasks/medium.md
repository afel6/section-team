Build a command-line todo app `todo.mjs` (an ES module, run as `node todo.mjs <command> [args]`).

Storage
- A JSON file whose path is the environment variable TODO_FILE (default: `todo.json` in the current directory). Create it on the first write.
- Writes must be atomic: write a temporary file in the same folder, then rename it over the data file.

Commands (every stdout line ends with "\n"; exit code 0 on success)
- `add <text...>`: join the remaining arguments with single spaces and trim. If the result is empty, print `Error: text required` to stderr and exit 2. Otherwise store it and print `Added #<id>: <text>`. Ids are integers starting at 1; a new id is always (highest id ever used) + 1, so ids are never reused, even after a remove.
- `list`: one line per todo, sorted by id: `#<id> [ ] <text>` when open, `#<id> [x] <text>` when done. With no todos, print `No todos`.
- `done <id>`: mark it done and print `Completed #<id>` (marking an already-done todo also prints `Completed #<id>` and exits 0).
- `remove <id>`: delete it and print `Removed #<id>`.
- For `done` and `remove`: a missing or non-integer id prints `Error: invalid id` to stderr and exits 2; an id that does not exist prints `Error: not found #<id>` to stderr and exits 1.
- `clear-done`: remove all done todos and print `Cleared <n>`.
- No command, or an unknown command: print a usage text that starts with `Usage:` to stderr and exit 2.
- If the data file exists but is not valid JSON: print `Error: corrupt data file` to stderr, exit 3, and never overwrite that file.

Also add tests with node:test, a `package.json` ("type": "module" and a "test" script), and a README with usage.
