// POST /groups/:id/import: records a list of expenses and payments in one go, all of them or none of them.
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

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Runs parse(); on a ValidationError throws the import rule instead, so an entry stops at its first broken rule.
class RuleBroken extends Error {}
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new RuleBroken(rule)
    throw err
  }
}

// Two expenses are the same when payer, amount in cents and trimmed lower-cased description match.
const sameKey = ({ description, payer, amount }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  for (const flag of ['dry_run', 'skip_recorded']) {
    if (flag in body && typeof body[flag] !== 'boolean') throw new ValidationError(`${flag} must be true or false`)
  }
  return { entries, dryRun: body.dry_run === true, skipRecorded: body.skip_recorded === true }
}

// The fields of one entry as { type, fields }, or throws RuleBroken with the first rule it breaks before the
// duplicate checks.
function parseEntry(group, entry) {
  if (!isObject(entry)) throw new RuleBroken('not-an-object')
  if (entry.type !== 'expense' && entry.type !== 'payment') throw new RuleBroken('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[entry.type].includes(key))) throw new RuleBroken('unknown-field')
  if (entry.type === 'expense') {
    return {
      type: 'expense',
      fields: {
        description: check('bad-description', () => parseDescription(entry.description)),
        payer: check('bad-payer', () => parseMember(entry.payer, group.members, 'payer must be a member of the group')),
        amount: check('bad-amount', () => parseAmount(entry.amount)),
        split: check('bad-split', () => parseSplit(entry.split, group.members)),
      },
    }
  }
  const from = check('bad-from', () => parseMember(entry.from, group.members, 'from must be a member of the group'))
  const to = check('bad-to', () => parseMember(entry.to, group.members, 'to must be a member of the group'))
  if (to === from) throw new RuleBroken('bad-to')
  return { type: 'payment', fields: { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) } }
}

// Sorts the entries into new expenses and payments (with their ids), skipped indexes and problems.
function sortEntries(state, group, entries, skipRecorded) {
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(sameKey))
  const seen = new Set()
  const problems = []
  const skipped = []
  const expenses = []
  const payments = []
  entries.forEach((entry, index) => {
    let parsed
    try {
      parsed = parseEntry(group, entry)
    } catch (err) {
      if (!(err instanceof RuleBroken)) throw err
      problems.push({ index, rule: err.message })
      return
    }
    const { type, fields } = parsed
    if (type === 'payment') {
      payments.push({ id: state.nextPaymentId + payments.length, group: group.id, ...fields })
      return
    }
    const key = sameKey(fields)
    const isDuplicate = seen.has(key)
    seen.add(key)
    if (isDuplicate) problems.push({ index, rule: 'duplicate' })
    else if (recorded.has(key) && skipRecorded) skipped.push(index)
    else if (recorded.has(key)) problems.push({ index, rule: 'already-recorded' })
    else expenses.push({ id: state.nextExpenseId + expenses.length, group: group.id, ...fields })
  })
  return { problems, skipped, expenses, payments }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)
  const { problems, skipped, expenses, payments } = sortEntries(state, group, entries, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

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
  const changed = expenses.length > 0 || payments.length > 0
  return dryRun || !changed ? reply : { ...reply, state: next }
}
