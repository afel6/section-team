// POST /groups/:id/import: records a list of expenses and payments for a group in one go, all of them or none.
// Same contract as the other handlers: it returns a new store instead of changing the one it gets.
import { parseExpense } from './expenses.mjs'
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const MAX_ENTRIES = 50
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// The rule of the first check that throws a ValidationError, or null when every check passes.
function firstBroken(checks) {
  for (const [rule, check] of checks) {
    try {
      check()
    } catch (err) {
      if (err instanceof ValidationError) return rule
      throw err
    }
  }
  return null
}

const isMember = (group, name) => typeof name === 'string' && group.members.includes(name)

// The first rule from not-an-object to bad-split (or bad-amount for a payment) that entry breaks, or null.
function entryProblem(group, entry) {
  if (!isObject(entry)) return 'not-an-object'
  // The typeof check matters: hasOwn turns ["expense"] into the key "expense".
  if (typeof entry.type !== 'string' || !Object.hasOwn(ENTRY_FIELDS, entry.type)) return 'bad-type'
  const fields = ENTRY_FIELDS[entry.type]
  if (Object.keys(entry).some(key => !fields.includes(key))) return 'unknown-field'
  if (entry.type === 'payment') {
    if (!isMember(group, entry.from)) return 'bad-from'
    if (!isMember(group, entry.to) || entry.to === entry.from) return 'bad-to'
    return firstBroken([['bad-amount', () => parseAmount(entry.amount)]])
  }
  return firstBroken([
    ['bad-description', () => parseDescription(entry.description)],
    ['bad-payer', () => parseMember(entry.payer, group.members, 'payer')],
    ['bad-amount', () => parseAmount(entry.amount)],
    ['bad-split', () => parseSplit(entry.split, group.members)],
  ])
}

// Two expenses are the same when payer, amount in cents and description (trimmed, lower case) all match.
const sameExpenseKey = ({ payer, amount, description }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

function parseOptions(body) {
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

// Sorts entries into new expenses, new payments, skipped indexes and problems, in entry order.
function planImport(group, recorded, entries, skipRecorded) {
  const plan = { expenses: [], payments: [], skipped: [], problems: [] }
  const seen = new Set()
  entries.forEach((entry, index) => {
    const problem = entryProblem(group, entry)
    if (problem) return plan.problems.push({ index, rule: problem })
    if (entry.type === 'payment') {
      return plan.payments.push({ from: entry.from, to: entry.to, amount: parseAmount(entry.amount) })
    }
    const expense = parseExpense(group, entry)
    const key = sameExpenseKey(expense)
    const isDuplicate = seen.has(key)
    seen.add(key)
    if (isDuplicate) return plan.problems.push({ index, rule: 'duplicate' })
    if (!recorded.has(key)) return plan.expenses.push(expense)
    if (skipRecorded) return plan.skipped.push(index)
    plan.problems.push({ index, rule: 'already-recorded' })
  })
  return plan
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseOptions(body)
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(sameExpenseKey))
  const plan = planImport(group, recorded, entries, skipRecorded)
  if (plan.problems.length > 0) return { status: 422, body: { error: 'import rejected', problems: plan.problems } }

  const expenses = plan.expenses.map((fields, i) => ({ id: state.nextExpenseId + i, group: group.id, ...fields }))
  const payments = plan.payments.map((fields, i) => ({ id: state.nextPaymentId + i, group: group.id, ...fields }))
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
      skipped: plan.skipped,
      balances: balances(next, group),
    },
  }
  // Nothing to save on a dry run, or when every entry was skipped.
  const changed = expenses.length + payments.length > 0
  return dryRun || !changed ? reply : { ...reply, state: next }
}
