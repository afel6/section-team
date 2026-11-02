// POST /groups/:id/import: records a list of expenses and payments for a group in one go, all of them or none.
// Same handler contract as lib/groups.mjs: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const MAX_ENTRIES = 50
const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const EXPENSE_FIELDS = ['type', 'description', 'payer', 'amount', 'split']
const PAYMENT_FIELDS = ['type', 'from', 'to', 'amount']

// A flag that is left out is false; one that is present must be a boolean, null included.
function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

// The body's options, checked in order; throws ValidationError (400) on the first bad one.
function parseOptions(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  return { entries, dryRun: parseFlag(body, 'dry_run'), skipRecorded: parseFlag(body, 'skip_recorded') }
}

// Runs [rule, parse] pairs in order: { rule } of the first parse that throws a ValidationError, else { values }.
function firstBroken(checks) {
  const values = []
  for (const [rule, parse] of checks) {
    try {
      values.push(parse())
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err
      return { rule }
    }
  }
  return { values }
}

function checkExpense(entry, members) {
  const { rule, values } = firstBroken([
    ['bad-description', () => parseDescription(entry.description)],
    ['bad-payer', () => parseMember(entry.payer, members, 'bad-payer')],
    ['bad-amount', () => parseAmount(entry.amount)],
    ['bad-split', () => parseSplit(entry.split, members)],
  ])
  if (rule) return { rule }
  const [description, payer, amount, split] = values
  return { type: 'expense', fields: { description, payer, amount, split } }
}

function differentMember(to, from, members) {
  const name = parseMember(to, members, 'bad-to')
  if (name === from) throw new ValidationError('bad-to')
  return name
}

function checkPayment(entry, members) {
  const { rule, values } = firstBroken([
    ['bad-from', () => parseMember(entry.from, members, 'bad-from')],
    ['bad-to', () => differentMember(entry.to, entry.from, members)],
    ['bad-amount', () => parseAmount(entry.amount)],
  ])
  if (rule) return { rule }
  const [from, to, amount] = values
  return { type: 'payment', fields: { from, to, amount } }
}

// One entry on its own: { rule } for the first rule it breaks, else { type, fields } as the POST routes parse them.
function checkEntry(entry, members) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { rule: 'not-an-object' }
  if (entry.type !== 'expense' && entry.type !== 'payment') return { rule: 'bad-type' }
  const allowed = entry.type === 'expense' ? EXPENSE_FIELDS : PAYMENT_FIELDS
  if (Object.keys(entry).some(key => !allowed.includes(key))) return { rule: 'unknown-field' }
  return entry.type === 'expense' ? checkExpense(entry, members) : checkPayment(entry, members)
}

// Two expenses are the same when payer, amount in cents and description (trimmed, any letter case) match.
const sameExpenseKey = ({ payer, amount, description }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

// Sorts every entry into problems [{ index, rule }], skipped indexes, or accepted { type, fields }, in entry order.
function reviewEntries(entries, group, state, skipRecorded) {
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(sameExpenseKey))
  const earlier = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  entries.forEach((entry, index) => {
    const checked = checkEntry(entry, group.members)
    if (checked.rule) return problems.push({ index, rule: checked.rule })
    if (checked.type === 'payment') return accepted.push(checked)
    const key = sameExpenseKey(checked.fields)
    const rule = earlier.has(key) ? 'duplicate' : recorded.has(key) ? 'already-recorded' : null
    // An earlier expense counts for duplicate whatever happens to it, skipped included.
    earlier.add(key)
    if (rule === 'already-recorded' && skipRecorded) skipped.push(index)
    else if (rule) problems.push({ index, rule })
    else accepted.push(checked)
  })
  return { problems, skipped, accepted }
}

// Gives each record of one kind the next id from start, in order; next is the id after the last one.
function numbered(fieldsList, start, groupId) {
  let id = start
  const records = fieldsList.map(fields => ({ id: id++, group: groupId, ...fields }))
  return { records, next: id }
}

// The store after the import, and the new expenses and payments in entry order.
function applyImport(state, group, accepted) {
  const fieldsOf = type => accepted.filter(a => a.type === type).map(a => a.fields)
  const expenses = numbered(fieldsOf('expense'), state.nextExpenseId, group.id)
  const payments = numbered(fieldsOf('payment'), state.nextPaymentId, group.id)
  const next = {
    ...state,
    expenses: [...state.expenses, ...expenses.records],
    payments: [...state.payments, ...payments.records],
    nextExpenseId: expenses.next,
    nextPaymentId: payments.next,
  }
  return { next, expenses: expenses.records, payments: payments.records }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseOptions(body)
  const { problems, skipped, accepted } = reviewEntries(entries, group, state, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }
  const { next, expenses, payments } = applyImport(state, group, accepted)
  const reply = {
    status: dryRun ? 200 : 201,
    body: { expenses: expenses.map(expenseView), payments: payments.map(paymentView), skipped, balances: balances(next, group) },
  }
  // A dry run, or an import whose entries were all skipped, writes nothing.
  return dryRun || accepted.length === 0 ? reply : { ...reply, state: next }
}
