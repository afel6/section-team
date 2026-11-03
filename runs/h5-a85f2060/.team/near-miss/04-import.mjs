// near-miss: seen.add(key) only for expenses that are neither duplicate nor recorded
// POST /groups/:id/import: records a list of expenses and payments for a group in one go, all of them or none.
// Same handler contract as lib/groups.mjs: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const MIN_ENTRIES = 1
const MAX_ENTRIES = 50
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Thrown while reviewing an entry: rule is the first import rule the entry breaks.
class BrokenRule extends Error {
  constructor(rule) {
    super(rule)
    this.rule = rule
  }
}

// Runs parse and returns its value, or throws BrokenRule(rule) when parse throws a ValidationError.
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new BrokenRule(rule)
    throw err
  }
}

// Two expenses are the same when payer, amount in cents and description (trimmed, lower case) match.
const expenseKey = ({ payer, amount, description }) =>
  JSON.stringify([payer, amount, description.trim().toLowerCase()])

// A boolean body flag: false when its key is absent, otherwise it must be true or false.
function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < MIN_ENTRIES || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of ${MIN_ENTRIES} to ${MAX_ENTRIES} items`)
  }
  return { entries, dryRun: parseFlag(body, 'dry_run'), skipRecorded: parseFlag(body, 'skip_recorded') }
}

// The fields of one entry as { kind, fields }, or throws BrokenRule with the first rule it breaks, from
// not-an-object to bad-split (bad-amount for a payment).
function parseEntry(entry, group) {
  if (!isObject(entry)) throw new BrokenRule('not-an-object')
  const kind = entry.type
  if (kind !== 'expense' && kind !== 'payment') throw new BrokenRule('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[kind].includes(key))) throw new BrokenRule('unknown-field')
  if (kind === 'expense') {
    const fields = {
      description: check('bad-description', () => parseDescription(entry.description)),
      payer: check('bad-payer', () => parseMember(entry.payer, group.members, 'bad payer')),
      amount: check('bad-amount', () => parseAmount(entry.amount)),
      split: check('bad-split', () => parseSplit(entry.split, group.members)),
    }
    return { kind, fields }
  }
  const from = check('bad-from', () => parseMember(entry.from, group.members, 'bad from'))
  const to = check('bad-to', () => parseMember(entry.to, group.members, 'bad to'))
  if (to === from) throw new BrokenRule('bad-to')
  return { kind, fields: { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) } }
}

// Sorts every entry into parsed (with its kind and fields), skipped indexes and problems, in entry order.
function review(entries, group, state, skipRecorded) {
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  const seen = new Set()
  const parsed = []
  const skipped = []
  const problems = []
  entries.forEach((entry, index) => {
    let result
    try {
      result = parseEntry(entry, group)
    } catch (err) {
      if (!(err instanceof BrokenRule)) throw err
      problems.push({ index, rule: err.rule })
      return
    }
    if (result.kind === 'expense') {
      const key = expenseKey(result.fields)
      const isDuplicate = seen.has(key)
      if (isDuplicate) return problems.push({ index, rule: 'duplicate' })
      if (recorded.has(key)) {
        if (skipRecorded) return skipped.push(index)
        return problems.push({ index, rule: 'already-recorded' })
      }
    }
    if (result.kind === 'expense') seen.add(expenseKey(result.fields))
    parsed.push(result)
  })
  return { parsed, skipped, problems }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)
  const { parsed, skipped, problems } = review(entries, group, state, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  const expenses = []
  const payments = []
  let { nextExpenseId, nextPaymentId } = state
  for (const { kind, fields } of parsed) {
    if (kind === 'expense') expenses.push({ id: nextExpenseId++, group: group.id, ...fields })
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
  // A dry run, or an import whose entries were all skipped, writes nothing.
  return dryRun || parsed.length === 0 ? reply : { ...reply, state: next }
}
