// POST /groups/:id/import: records a list of expenses and payments in one go, all of them or none of them.
// Same contract as the other handlers: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const EXPENSE_FIELDS = ['type', 'description', 'payer', 'amount', 'split']
const PAYMENT_FIELDS = ['type', 'from', 'to', 'amount']
const MAX_ENTRIES = 50

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Thrown by checkEntry with the first rule an entry breaks.
class Broken extends Error {
  constructor(rule) {
    super(rule)
    this.rule = rule
  }
}

// Runs one of the POST routes' parsers, turning its ValidationError into the import rule it stands for.
function parseAs(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new Broken(rule)
    throw err
  }
}

// The body's own checks, in order; the first one that fails is the 400 message. Returns the import options.
function parseImportBody(body) {
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

// One entry's fields, checked by the same rules as POST /groups/:id/expenses or /payments. Throws Broken with
// the first field rule the entry breaks; duplicates are found later, by the caller.
function checkEntry(entry, group) {
  if (!isObject(entry)) throw new Broken('not-an-object')
  if (entry.type !== 'expense' && entry.type !== 'payment') throw new Broken('bad-type')
  const fields = entry.type === 'expense' ? EXPENSE_FIELDS : PAYMENT_FIELDS
  if (Object.keys(entry).some(key => !fields.includes(key))) throw new Broken('unknown-field')
  if (entry.type === 'expense') {
    return {
      type: 'expense',
      description: parseAs('bad-description', () => parseDescription(entry.description)),
      payer: parseAs('bad-payer', () => parseMember(entry.payer, group.members, 'bad payer')),
      amount: parseAs('bad-amount', () => parseAmount(entry.amount)),
      split: parseAs('bad-split', () => parseSplit(entry.split, group.members)),
    }
  }
  const from = parseAs('bad-from', () => parseMember(entry.from, group.members, 'bad from'))
  const to = parseAs('bad-to', () => parseMember(entry.to, group.members, 'bad to'))
  if (to === from) throw new Broken('bad-to')
  return { type: 'payment', from, to, amount: parseAs('bad-amount', () => parseAmount(entry.amount)) }
}

// Two expenses are the same when payer, amount in cents and description (trimmed, lower case) match.
const sameKey = ({ payer, amount, description }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

// The first rule an entry breaks, duplicates included, or null when it has none. `seen` holds the keys of the
// earlier entries that passed the field rules; this entry's key is added to it.
function brokenRule(parsed, seen, recorded) {
  if (parsed.type !== 'expense') return null
  const key = sameKey(parsed)
  if (seen.has(key)) return 'duplicate'
  seen.add(key)
  return recorded.has(key) ? 'already-recorded' : null
}

// Sorts the entries into problems [{index, rule}], skipped indexes and the parsed entries to import.
function classifyEntries(entries, group, recordedExpenses, skipRecorded) {
  const recorded = new Set(recordedExpenses.map(sameKey))
  const seen = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  entries.forEach((entry, index) => {
    let parsed = null
    let rule
    try {
      parsed = checkEntry(entry, group)
      rule = brokenRule(parsed, seen, recorded)
    } catch (err) {
      if (!(err instanceof Broken)) throw err
      rule = err.rule
    }
    if (rule === 'already-recorded' && skipRecorded) skipped.push(index)
    else if (rule) problems.push({ index, rule })
    else accepted.push(parsed)
  })
  return { problems, skipped, accepted }
}

// The stored expenses and payments for the accepted entries, each kind numbered on from its next id.
function numberEntries(accepted, state, groupId) {
  const expenses = []
  const payments = []
  for (const { type, ...fields } of accepted) {
    if (type === 'expense') expenses.push({ id: state.nextExpenseId + expenses.length, group: groupId, ...fields })
    else payments.push({ id: state.nextPaymentId + payments.length, group: groupId, ...fields })
  }
  return { expenses, payments }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseImportBody(body)
  const recordedExpenses = state.expenses.filter(e => e.group === group.id)
  const { problems, skipped, accepted } = classifyEntries(entries, group, recordedExpenses, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  const { expenses, payments } = numberEntries(accepted, state, group.id)
  const next = {
    ...state,
    expenses: [...state.expenses, ...expenses],
    payments: [...state.payments, ...payments],
    nextExpenseId: state.nextExpenseId + expenses.length,
    nextPaymentId: state.nextPaymentId + payments.length,
  }
  const reply = {
    status: dryRun ? 200 : 201,
    body: { expenses: expenses.map(expenseView), payments: payments.map(paymentView), skipped, balances: balances(next, group) },
  }
  // A dry run, or an import whose entries were all skipped, leaves the store and the data file as they are.
  return dryRun || accepted.length === 0 ? reply : { ...reply, state: next }
}
