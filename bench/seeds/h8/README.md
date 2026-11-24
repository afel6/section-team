# Loans

A small command-line tool that keeps track of the things you lend to people: who has what, and when you want it back. Node.js 24.2 or later, no dependencies.

## Run

```
node loans.mjs <command> [arguments]
```

| Env | Default | Meaning |
|---|---|---|
| `LOANS_FILE` | `loans.json` | The data file, relative to the current folder |

A missing data file means no loans yet. Every change is written to the data file atomically (a temp file, then a rename), so a crash never leaves half a file.

## Test

```
npm test
```

## Commands

| Command | Does | Prints |
|---|---|---|
| `add <item> --to <person> [--due <date>]` | records a new loan | `added #<n>` |
| `list [--all] [--to <person>] [--due-before <date>]` | lists loans | one line per loan, or `no loans` |
| `back <n>` | marks loan `<n>` as returned | `returned #<n>` |
| `edit <n> [--item <item>] [--to <person>] [--due <date> \| --no-due]` | changes the fields given | `updated #<n>` |
| `remove <n>` | deletes loan `<n>` | `removed #<n>` |
| `show <n>` | shows one loan | five lines: `loan #<n>`, `item: ...`, `to: ...`, `due: <date or ->`, `returned: yes\|no` |
| `rename <person> --to <new name>` | gives every loan of a person (returned ones too) to a new name | `renamed <count> loan(s)` |
| `people` | who has something right now | `<person>: <count>` per person, by name, or `nobody has anything` |

Options may come anywhere after the command: `add --to Sam Blue umbrella` is the same as `add Blue umbrella --to Sam`. The words that are not options form the item, joined by single spaces.

**Loan numbers.** Every loan gets a number: the first loan is #1 and each new loan gets the next one. A number is never given to another loan, even after `remove`: when #3 is removed, no later loan is #3.

**Listing.** `list` shows the loans not returned yet; `--all` shows the returned ones too, marked `[returned]`. `--to <person>` keeps that person's loans, and `--due-before <date>` keeps the loans due before that date (loans without a due date are left out). Loans are sorted by due date, earliest first, then by number; loans without a due date come last. A line reads `#<n> <item> -> <person>`, then ` (due <date>)` when the loan has a due date, then ` [returned]` when it is returned:

```
#2 Drill -> Sam (due 2026-03-01)
#1 Blue umbrella -> Kim
```

**Rules**
- `<item>`: 1 to 100 characters after trimming white space at both ends.
- `<person>`: 1 to 40 characters after trimming; letter case matters (`Sam` and `sam` are two people).
- `<date>`: `YYYY-MM-DD`, and it must be a real calendar date, for `--due` on `add` and `edit` and for `--due-before` alike. Leap years follow the calendar: `2024-02-29` is a date, `2026-02-29` and `2100-02-29` are not.
- `<n>`: a loan number written in digits, such as `3`.

**Errors.** A command that fails prints `error: <message>` to stderr, exits with code 1 and changes nothing. A missing or unknown command prints the usage to stderr and exits with code 2. The messages:

| Message | When |
|---|---|
| `item must be 1 to 100 characters` | bad item |
| `person must be 1 to 40 characters` | bad person |
| `due date must be a real date as YYYY-MM-DD` | bad `--due` or `--due-before` |
| `loan number must be a whole number like 3` | bad `<n>` |
| `no loan #<n>` | no loan has that number |
| `loan #<n> is already returned` | `back` on a returned loan |
| `--to is required` | `add` or `rename` without `--to` |
| `--due and --no-due cannot be used together` | both on `edit` |
| `nothing to change` | `edit` without any option |
| `unknown option <option>`, `<option> needs a value` | a bad option |
| `expected one loan number`, `expected one person`, `unexpected argument <word>` | wrong number of words |
| `data file <file> is damaged`, `cannot read data file <file>`, `cannot write data file <file>` | data file problems |

## Layout

- `loans.mjs`: entry point; `run(args, file)` runs one command and returns what to print.
- `lib/args.mjs`: splits the words into positional words and options.
- `lib/commands.mjs`: the commands; each returns a new store instead of changing the old one.
- `lib/rules.mjs`: input rules shared by all commands; they throw `UserError`.
- `lib/format.mjs`: the order and the text of listed loans.
- `lib/store.mjs`: loading and atomic saving of the data file.
- `test/`: `node:test` suites.
