// calc-cli.mjs: prints the value of an expression.
// Usage: node calc-cli.mjs <expression> [<name>=<value>]...
import { CalcError, evaluate } from './calc.mjs'

const USAGE = 'Usage: node calc-cli.mjs <expression> [<name>=<value>]...'
const VARIABLE = /^([A-Za-z_][A-Za-z0-9_]*)=(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/
const SIGNIFICANT_DIGITS = 12
const EXIT_EVAL = 1
const EXIT_USAGE = 2

class UsageError extends Error {}

// The variable arguments, left to right, as an object without a prototype (so __proto__ is an ordinary name).
function parseVariables(args) {
  const vars = Object.create(null)
  for (const arg of args) {
    const m = VARIABLE.exec(arg)
    const value = m ? Number(m[2]) : NaN
    if (!Number.isFinite(value)) throw new UsageError(`Error: bad variable ${arg}`)
    vars[m[1]] = value
  }
  return vars
}

const formatValue = value => String(Number(value.toPrecision(SIGNIFICANT_DIGITS)))

function main(args) {
  if (args.length === 0) throw new UsageError(USAGE)
  const vars = parseVariables(args.slice(1))
  process.stdout.write(`${formatValue(evaluate(args[0], vars))}\n`)
}

try {
  main(process.argv.slice(2))
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`${err.message}\n`)
    process.exitCode = EXIT_USAGE
  } else if (err instanceof CalcError) {
    process.stderr.write(`Error: ${err.message}\n`)
    process.exitCode = EXIT_EVAL
  } else {
    throw err
  }
}
