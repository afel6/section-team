// POST /groups/:id/import: records a list of expenses and payments for a group in one go, all of them or none.
// Same handler contract as lib/groups.mjs: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}
const MIN_ENTRIES = 1
const MAX_ENTRIES = 50

// An entry that breaks one of the import rules; rule is its name in the 422 reply, such as 'bad-payer'.
class EntryProblem extends Error {
  constructor(rule) {
    super(rule)
    this.rule = rule
  }
}

// Runs parse and returns its value; a ValidationError from it becomes an EntryProblem for rule.
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new EntryProblem(rule)
    throw err
  }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

// The body's checks, in the order of their 400 messages.
function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < MIN_ENTRIES || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of ${MIN_ENTRIES} to ${MAX_ENTRIES} items`)
  }
  return { entries, dryRun: parseFlag(body, 'dry_run'), skipRecorded: parseFlag(body, 'skip_recorded') }
}

// One entry as { type, fields }, the fields being what the expense or payment POST route would keep.
// Throws an EntryProblem with the first rule the entry breaks.
function parseEntry(group, entry) {
  if (!isObject(entry)) throw new EntryProblem('not-an-object')
  const { type } = entry
  if (type !== 'expense' && type !== 'payment') throw new EntryProblem('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[type].includes(key))) throw new EntryProblem('unknown-field')
  const { members } = group
  if (type === 'expense') {
    const fields = {
      description: check('bad-description', () => parseDescription(entry.description)),
      payer: check('bad-payer', () => parseMember(entry.payer, members, 'bad payer')),
      amount: check('bad-amount', () => parseAmount(entry.amount)),
      split: check('bad-split', () => parseSplit(entry.split, members)),
    }
    return { type, fields }
  }
  const from = check('bad-from', () => parseMember(entry.from, members, 'bad from'))
  const to = check('bad-to', () => parseMember(entry.to, members, 'bad to'))
  if (to === from) throw new EntryProblem('bad-to')
  return { type, fields: { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) } }
}

// Two expenses are the same when payer, amount in cents and description (trimmed, any letter case) match.
const expenseKey = ({ payer, amount, description }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

// Sorts the entries into problems [{index, rule}], skipped indexes and accepted [{ type, fields }], in entry order.
function sortEntries(state, group, entries, skipRecorded) {
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  const seen = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  entries.forEach((entry, index) => {
    let parsed
    try {
      parsed = parseEntry(group, entry)
    } catch (err) {
      if (!(err instanceof EntryProblem)) throw err
      problems.push({ index, rule: err.rule })
      return
    }
    if (parsed.type === 'expense') {
      const key = expenseKey(parsed.fields)
      const isDuplicate = seen.has(key)
      seen.add(key)
      if (isDuplicate) return problems.push({ index, rule: 'duplicate' })
      if (recorded.has(key)) {
        if (skipRecorded) skipped.push(index)
        else problems.push({ index, rule: 'already-recorded' })
        return
      }
    }
    accepted.push(parsed)
  })
  return { problems, skipped, accepted }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)
  const { problems, skipped, accepted } = sortEntries(state, group, entries, skipRecorded)
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
  // A dry run, or an import that only skips, leaves the store as it is and writes nothing.
  if (dryRun) return { status: 200, body: reply }
  if (accepted.length === 0) return { status: 201, body: reply }
  return { status: 201, body: reply, state: next }
}
