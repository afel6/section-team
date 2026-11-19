# timelog

A command-line tool that reads a plain text time log, reports how much time went to each project and checks the log for overlapping entries. Node.js 22 or later, no dependencies.

## Run

```
node timelog.mjs report <file> [--from <date>] [--to <date>]
node timelog.mjs check <file>
```

## Test

```
npm test
```

## The log file

The log is a UTF-8 text file; a byte order mark at its very start is ignored. Lines are separated by `\n`, and a `\r` at the end of a line is dropped. Line numbers count from 1 and include every line.

- A line that is empty or holds only spaces and tabs is skipped, and so is a line whose first character other than a space or a tab is `#` (a comment).
- Every other line is an entry: `<date> <start>-<end> <project> [<note>]`. Fields are separated by one or more spaces or tabs, and spaces and tabs at the start or end of the line are ignored. A note is everything after the project, and it is ignored.
  - `<date>` is `YYYY-MM-DD`, a real date of the Gregorian calendar (years `0000` to `9999`, leap years included).
  - `<start>` and `<end>` are `HH:MM`, from `00:00` to `23:59`, always with two digits each.
  - `<project>` is 1 to 30 characters of `a-z`, `0-9` and `-`, starting with a letter.
- An entry runs from `<start>` to `<end>` on `<date>`. When `<end>` is earlier than `<start>`, the entry runs past midnight and ends at `<end>` on the next day: `23:30-00:30` is one hour. It still belongs to `<date>`.
- Times are wall-clock times: every day has 24 hours.

A line that breaks a rule is an error, reported with the first reason that applies, in this order: `missing fields` (fewer than 3 fields), `bad date`, `bad time`, `zero-length entry` (start equals end), `bad project`. The first bad line in the file is the one reported.

## report

`node timelog.mjs report <file> [--from <date>] [--to <date>]` prints, for the entries whose date is from `--from` to `--to` (both included; either may be left out), one line per project: the project, a tab and its total time. The lines are sorted by total time, most first, then by project name. A last line `total`, a tab and the sum of all the lines follows; with no entries in the range, it is the only line.

Durations are printed as `H:MM`: whole hours (as many digits as needed), a colon and the minutes, always two digits. 65 minutes is `1:05`, 0 minutes is `0:00` and 6000 minutes is `100:00`.

```
$ node timelog.mjs report work.log --from 2026-03-02
client-a	3:15
admin	0:45
total	4:00
```

## check

`node timelog.mjs check <file>` reads and parses the file as `report` does (same errors and exit codes) and looks for entries whose times overlap. Every entry counts, whatever its date or project. An entry covers the time from its start to its end, past midnight into the next day when its end is earlier than its start; all dates share one time line. Two entries overlap when they share more than 0 minutes: one that ends at 10:00 and one that starts at 10:00 do not.

- No overlaps: one line `no overlaps in <n> entries` (`no overlaps in 1 entry` for a single entry), exit 0.
- Overlaps: one line per overlapping pair, `line <a> overlaps line <b> by <H:MM>`, with `<a>` the smaller line number and `<H:MM>` the shared time, sorted by `<a>` then `<b>`. At most 50 such lines: with more pairs, the first 50 are followed by `and <k> more`, where `<k>` counts the pairs not shown. Exit 1.

`check` takes no options; anything after the file is a usage error (exit 2, the same usage line as `report`).

```
$ node timelog.mjs check work.log
line 3 overlaps line 7 by 0:15
```

## Errors

Each error writes exactly one line to stderr, nothing to stdout, and exits with a non-zero code. The first check that fails decides it:

| Exit | stderr | When |
|---|---|---|
| 2 | `usage: node timelog.mjs report <file> [--from <date>] [--to <date>]` | The command is not `report` or `check`, the file is missing, `check` has more than one argument, or an option is unknown, repeated or has no value |
| 2 | `error: bad date for --from: <value>` (or `--to`) | An option's value is not a date as above; `--from` is checked first |
| 3 | `error: cannot read <file>` | The file cannot be read (missing, a folder, no permission) |
| 3 | `error: <file> is not valid UTF-8` | The file's bytes are not valid UTF-8 |
| 4 | `error: line <n>: <reason>` | A line breaks a rule (see above) |

On success it exits 0 and writes nothing to stderr.

## Layout

- `timelog.mjs`: the entry point; writes what `lib/cli.mjs` returns.
- `lib/cli.mjs`: arguments, reading the file, error replies.
- `lib/parse.mjs`: the log format; `parseLog(text)` returns entries `{line, date, day, start, end, project, minutes}`.
- `lib/dates.mjs`: date checks and day numbers.
- `lib/report.mjs`: totals per project.
- `lib/check.mjs`: overlapping entries.
- `lib/format.mjs`: `H:MM` durations.
