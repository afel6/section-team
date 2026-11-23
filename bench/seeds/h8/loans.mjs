// Entry point: node loans.mjs <command> [arguments]. Env: LOANS_FILE (default loans.json in the current folder).
import { parseOptions } from './lib/args.mjs'
import { COMMANDS } from './lib/commands.mjs'
import { UserError } from './lib/rules.mjs'
import { load, save } from './lib/store.mjs'

const DEFAULT_FILE = 'loans.json'
const EXIT_ERROR = 1
const EXIT_USAGE = 2

export const USAGE = `usage: node loans.mjs <command> [arguments]
commands:
  add <item> --to <person> [--due <date>]
  list [--all] [--to <person>] [--due-before <date>]
  back <n>
  edit <n> [--item <item>] [--to <person>] [--due <date> | --no-due]
  remove <n>
  show <n>
  rename <person> --to <new name>
  people`

// Runs one command against the data file and returns what to print and the exit code, without printing.
// The store is saved only when the command changed it, and before anything is reported as done.
export function run(args, file = DEFAULT_FILE) {
  const command = COMMANDS.get(args[0])
  if (!command) return { code: EXIT_USAGE, stdout: '', stderr: `${USAGE}\n` }
  try {
    const parsed = parseOptions(args.slice(1), command.options)
    const result = command.run(load(file), parsed)
    if (result.store) save(file, result.store)
    return { code: 0, stdout: result.lines.map(line => `${line}\n`).join(''), stderr: '' }
  } catch (err) {
    if (!(err instanceof UserError)) throw err
    return { code: EXIT_ERROR, stdout: '', stderr: `error: ${err.message}\n` }
  }
}

if (import.meta.main) {
  const { code, stdout, stderr } = run(process.argv.slice(2), process.env.LOANS_FILE || DEFAULT_FILE)
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  process.exitCode = code
}
