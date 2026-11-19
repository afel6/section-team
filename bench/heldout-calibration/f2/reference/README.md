# cron-next

A small cron expression library and a command-line tool that prints the next times an expression fires. Node.js 22 or later, no dependencies. All times are UTC.

## Command line

```
node cron-cli.mjs <expression> [--from <time>] [--count <n>]
```

- `<expression>`: five fields, minute hour day-of-month month day-of-week, quoted as one argument.
- `--from`: `YYYY-MM-DDTHH:MM[:SS]Z` (year 1970 to 9899); the default is now.
- `--count`: 1 to 1000; the default is 5.

```
$ node cron-cli.mjs "0 9 * * MON-FRI" --from 2026-11-19T09:00Z --count 2
2026-11-20 09:00 Fri
2026-11-23 09:00 Mon
```

| Exit | When |
|---|---|
| 0 | All runs printed |
| 1 | Fewer runs than `--count` within 100 years: the ones found are printed, then `error: only <k> of <n> runs within 100 years` |
| 2 | Bad arguments (usage line), `error: invalid --from: <value>` or `error: invalid --count: <value>` |
| 3 | `error: <message>` for a bad expression |

## Library

```js
import { parseCron, nextRuns, CronError } from './cron.mjs'
parseCron('*/15 9-17 * * MON-FRI') // { minute: [0, 15, 30, 45], hour: [9, ..., 17], ... }
nextRuns('0 0 13 * FRI', new Date(), 3) // the next 3 runs as Dates
```

Fields take `*`, values, ranges `a-b`, steps `/s` and comma lists; months and weekdays also take 3-letter names. Day-of-week 7 is Sunday, like 0. When both day fields are restricted (neither starts with `*`), a day matches either; otherwise it must match both.

## Test

```
npm test
```
