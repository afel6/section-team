// near-miss: split null treated as absent
// POST /groups/:id/import: records a list of expenses and payments for a group in one go, all of them or none.
// Same handler contract as lib/groups.mjs: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const MAX_ENTRIES = 50
const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']

// Per entry type: the fields it takes, and [field, rule, parse] for each field to keep, in the order they are
// checked. parse(entry, group, fieldsSoFar) returns the clean value or throws ValidationError.
const ENTRY_TYPES = {
  expense: {
    fields: ['type', 'description', 'payer', 'amount', 'split'],
    parsers: [
      ['description', 'bad-description', e => parseDescription(e.description)],
      ['payer', 'bad-payer', (e, g) => parseMember(e.payer, g.members, 'bad-payer')],
      ['amount', 'bad-amount', e => parseAmount(e.amount)],
      ['split', 'bad-split', (e, g) => parseSplit(e.split ?? undefined, g.members)],
    ],
  },
  payment: {
    fields: ['type', 'from', 'to', 'amount'],
    parsers: [
      ['from', 'bad-from', (e, g) => parseMember(e.from, g.members, 'bad-from')],
      ['to', 'bad-to', (e, g, { from }) => {
        const to = parseMember(e.to, g.members, 'bad-to')
        if (to === from) throw new ValidationError('bad-to')
        return to
      }],
      ['amount', 'bad-amount', e => parseAmount(e.amount)],
    ],
  },
}

// A field left out of the body is false; a field that is there, null included, must be a boolean.
function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

// The body's fields, checked in order; throws ValidationError (400) on the first bad one.
function parseBody(body) {
  const unknown = Object.keys(body).find(name => !BODY_FIELDS.includes(name))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  const dryRun = parseFlag(body, 'dry_run')
  const skipRecorded = parseFlag(body, 'skip_recorded')
  return { entries, dryRun, skipRecorded }
}

// One entry on its own: { rule } for the first rule it breaks, else { type, fields } with the clean fields.
function checkEntry(entry, group) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { rule: 'not-an-object' }
  // A strict match: Object.hasOwn would turn a type of ["expense"] into the key "expense".
  const { type } = entry
  if (type !== 'expense' && type !== 'payment') return { rule: 'bad-type' }
  const { fields: allowed, parsers } = ENTRY_TYPES[type]
  if (!Object.keys(entry).every(name => allowed.includes(name))) return { rule: 'unknown-field' }
  const fields = {}
  for (const [name, rule, parse] of parsers) {
    try {
      fields[name] = parse(entry, group, fields)
    } catch (err) {
      if (err instanceof ValidationError) return { rule }
      throw err
    }
  }
  return { type, fields }
}

// Two expenses are the same when payer, amount in cents and trimmed, lower-cased description all match.
const expenseKey = ({ payer, amount, description }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)

  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  // Keys of the earlier expense entries with valid fields, duplicate or already recorded ones included.
  const seen = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  entries.forEach((entry, index) => {
    const checked = checkEntry(entry, group)
    let { rule } = checked
    if (checked.type === 'expense') {
      const key = expenseKey(checked.fields)
      if (seen.has(key)) rule = 'duplicate'
      else if (recorded.has(key)) rule = 'already-recorded'
      seen.add(key)
    }
    if (rule === 'already-recorded' && skipRecorded) skipped.push(index)
    else if (rule) problems.push({ index, rule })
    else accepted.push(checked)
  })
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  let { nextExpenseId, nextPaymentId } = state
  const expenses = []
  const payments = []
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
    expenses: expenses.map(expenseView),
    payments: payments.map(paymentView),
    skipped,
    balances: balances(next, group),
  }
  // A dry run, or an import whose entries were all skipped, leaves the store and the data file as they are.
  if (dryRun) return { status: 200, body: reply }
  if (accepted.length === 0) return { status: 201, body: reply }
  return { status: 201, body: reply, state: next }
}
