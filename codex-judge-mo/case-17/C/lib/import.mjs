// POST /groups/:id/import: records a list of expenses and payments for a group in one go, all of them or none.
// Same contract as the other handlers: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const MAX_ENTRIES = 50
const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}

// Thrown by the entry checks below; `rule` is what the 422 reply names.
class EntryProblem extends Error {
  constructor(rule) {
    super(rule)
    this.rule = rule
  }
}

// Runs parse(); a ValidationError from it becomes the given rule.
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new EntryProblem(rule)
    throw err
  }
}

// The checks every entry gets, whatever its type, in order.
function entryType(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new EntryProblem('not-an-object')
  const { type } = entry
  if (type !== 'expense' && type !== 'payment') throw new EntryProblem('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[type].includes(key))) throw new EntryProblem('unknown-field')
  return type
}

// The fields of a new expense, like parseExpense in lib/expenses.mjs; split counts as left out only when absent.
const parseExpenseEntry = (group, entry) => ({
  description: check('bad-description', () => parseDescription(entry.description)),
  payer: check('bad-payer', () => parseMember(entry.payer, group.members, 'payer')),
  amount: check('bad-amount', () => parseAmount(entry.amount)),
  split: check('bad-split', () => parseSplit(Object.hasOwn(entry, 'split') ? entry.split : undefined, group.members)),
})

function parsePaymentEntry(group, entry) {
  const from = check('bad-from', () => parseMember(entry.from, group.members, 'from'))
  const to = check('bad-to', () => parseMember(entry.to, group.members, 'to'))
  if (from === to) throw new EntryProblem('bad-to')
  return { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) }
}

// Two expenses are the same when payer, amount in cents and trimmed, lower-cased description are.
const expenseKey = ({ payer, amount, description }) =>
  JSON.stringify([payer, amount, description.trim().toLowerCase()])

function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  const flag = name => {
    if (!Object.hasOwn(body, name)) return false
    if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
    return body[name]
  }
  return { entries, dryRun: flag('dry_run'), skipRecorded: flag('skip_recorded') }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)

  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  const seen = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  entries.forEach((entry, index) => {
    try {
      const type = entryType(entry)
      if (type === 'payment') {
        accepted.push({ type, fields: parsePaymentEntry(group, entry) })
        return
      }
      const fields = parseExpenseEntry(group, entry)
      const key = expenseKey(fields)
      const isDuplicate = seen.has(key)
      seen.add(key)
      if (isDuplicate) throw new EntryProblem('duplicate')
      if (recorded.has(key)) {
        if (!skipRecorded) throw new EntryProblem('already-recorded')
        skipped.push(index)
        return
      }
      accepted.push({ type, fields })
    } catch (err) {
      if (!(err instanceof EntryProblem)) throw err
      problems.push({ index, rule: err.rule })
    }
  })
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  const expenses = []
  const payments = []
  let { nextExpenseId, nextPaymentId } = state
  for (const { type, fields } of accepted) {
    if (type === 'expense') expenses.push({ id: nextExpenseId++, group: group.id, ...fields })
    else payments.push({ id: nextPaymentId++, group: group.id, ...fields })
  }
  const next = {
    ...state,
    expenses: [...state.expenses, ...expenses],
    payments: [...state.payments, ...payments],
    nextExpenseId,
    nextPaymentId,
  }
  const reply = {
    status: dryRun ? 200 : 201,
    body: {
      expenses: expenses.map(expenseView),
      payments: payments.map(paymentView),
      skipped,
      balances: balances(next, group),
    },
  }
  // A dry run, or an import whose entries were all skipped, leaves the store and the data file alone.
  return dryRun || accepted.length === 0 ? reply : { ...reply, state: next }
}
