// Bulk import handler: records a list of expenses and payments for a group, all of them or none of them. Same
// contract as the other handlers: it returns a new store instead of changing the one it gets.
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

// Two expenses are the same when payer, amount in cents and description (trimmed, lower case) match.
const sameKey = ({ description, payer, amount }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

// Wraps a parser so that its ValidationError becomes a rule name, thrown as a RuleBroken.
class RuleBroken extends Error {}
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new RuleBroken(rule)
    throw err
  }
}

function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  const flag = name => {
    if (!(name in body)) return false
    if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
    return body[name]
  }
  return { entries, dryRun: flag('dry_run'), skipRecorded: flag('skip_recorded') }
}

// The clean fields of one entry as { type, fields }, or a thrown RuleBroken naming the first rule it breaks
// before the duplicate checks.
function parseEntry(group, entry) {
  if (!isObject(entry)) throw new RuleBroken('not-an-object')
  if (typeof entry.type !== 'string' || !Object.hasOwn(ENTRY_FIELDS, entry.type)) throw new RuleBroken('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[entry.type].includes(key))) throw new RuleBroken('unknown-field')
  if (entry.type === 'expense') {
    return {
      type: 'expense',
      fields: {
        description: check('bad-description', () => parseDescription(entry.description)),
        payer: check('bad-payer', () => parseMember(entry.payer, group.members, 'bad payer')),
        amount: check('bad-amount', () => parseAmount(entry.amount)),
        split: check('bad-split', () => parseSplit(entry.split, group.members)),
      },
    }
  }
  const from = check('bad-from', () => parseMember(entry.from, group.members, 'bad from'))
  const to = check('bad-to', () => parseMember(entry.to, group.members, 'bad to'))
  if (to === from) throw new RuleBroken('bad-to')
  return { type: 'payment', fields: { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) } }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)

  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(sameKey))
  const seen = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  entries.forEach((entry, index) => {
    let parsed
    try {
      parsed = parseEntry(group, entry)
    } catch (err) {
      if (!(err instanceof RuleBroken)) throw err
      problems.push({ index, rule: err.message })
      return
    }
    if (parsed.type === 'expense') {
      const key = sameKey(parsed.fields)
      const duplicate = seen.has(key)
      seen.add(key)
      if (duplicate) return problems.push({ index, rule: 'duplicate' })
      if (recorded.has(key)) return skipRecorded ? skipped.push(index) : problems.push({ index, rule: 'already-recorded' })
    }
    accepted.push(parsed)
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
  // A dry run, or an import whose entries were all skipped, writes nothing.
  if (dryRun || accepted.length === 0) return reply
  return { ...reply, state: next }
}
