// POST /groups/:id/import: records a list of expenses and payments in one go, all of them or none. Same handler
// contract as lib/groups.mjs: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const MAX_ENTRIES = 50
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}

// Thrown by an entry check; `rule` is what the 422 reply names.
class RuleError extends Error {
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
    if (err instanceof ValidationError) throw new RuleError(rule)
    throw err
  }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Expenses with the same key are the same expense for `duplicate` and `already-recorded`.
const expenseKey = ({ payer, amount, description }) =>
  JSON.stringify([payer, amount, description.trim().toLowerCase()])

// The clean fields of one entry, tagged with its type. Throws RuleError on the first rule from not-an-object to
// bad-split (or bad-to / bad-amount for a payment) that the entry breaks.
function parseEntry(entry, members) {
  if (!isObject(entry)) throw new RuleError('not-an-object')
  if (entry.type !== 'expense' && entry.type !== 'payment') throw new RuleError('bad-type')
  const fields = ENTRY_FIELDS[entry.type]
  if (Object.keys(entry).some(key => !fields.includes(key))) throw new RuleError('unknown-field')
  if (entry.type === 'expense') {
    return {
      type: 'expense',
      description: check('bad-description', () => parseDescription(entry.description)),
      payer: check('bad-payer', () => parseMember(entry.payer, members, 'bad payer')),
      amount: check('bad-amount', () => parseAmount(entry.amount)),
      split: check('bad-split', () => parseSplit(Object.hasOwn(entry, 'split') ? entry.split : undefined, members)),
    }
  }
  const from = check('bad-from', () => parseMember(entry.from, members, 'bad from'))
  const to = check('bad-to', () => parseMember(entry.to, members, 'bad to'))
  if (to === from) throw new RuleError('bad-to')
  return { type: 'payment', from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) }
}

function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  return { entries, dryRun: parseFlag(body, 'dry_run'), skipRecorded: parseFlag(body, 'skip_recorded') }
}

// Sorts the entries into what to import, what to skip and what is wrong, in entry order.
function sortEntries(entries, group, state, skipRecorded) {
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  const seen = new Set()
  const accepted = []
  const skipped = []
  const problems = []
  entries.forEach((entry, index) => {
    let parsed
    try {
      parsed = parseEntry(entry, group.members)
    } catch (err) {
      if (!(err instanceof RuleError)) throw err
      problems.push({ index, rule: err.rule })
      return
    }
    // Payments are never duplicate or already recorded. Every valid expense counts for later duplicates, even a
    // duplicate or skipped one.
    const key = parsed.type === 'expense' ? expenseKey(parsed) : null
    if (key !== null && seen.has(key)) problems.push({ index, rule: 'duplicate' })
    else if (key !== null && recorded.has(key) && !skipRecorded) problems.push({ index, rule: 'already-recorded' })
    else if (key !== null && recorded.has(key)) skipped.push(index)
    else accepted.push(parsed)
    if (key !== null) seen.add(key)
  })
  return { accepted, skipped, problems }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)
  const { accepted, skipped, problems } = sortEntries(entries, group, state, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  const expenses = []
  const payments = []
  for (const { type, ...fields } of accepted) {
    if (type === 'expense') expenses.push({ id: state.nextExpenseId + expenses.length, group: group.id, ...fields })
    else payments.push({ id: state.nextPaymentId + payments.length, group: group.id, ...fields })
  }
  const next = {
    ...state,
    expenses: [...state.expenses, ...expenses],
    payments: [...state.payments, ...payments],
    nextExpenseId: state.nextExpenseId + expenses.length,
    nextPaymentId: state.nextPaymentId + payments.length,
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
  // A dry run, or an import whose entries were all skipped, writes nothing.
  return dryRun || accepted.length === 0 ? reply : { ...reply, state: next }
}
