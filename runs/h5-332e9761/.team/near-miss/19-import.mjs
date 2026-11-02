// near-miss: payments also go through the duplicate check with key JSON.stringify([from, to, amount]) in the same seen set
// POST /groups/:id/import: records a list of expenses and payments for a group in one write, all or nothing.
// Same handler contract as lib/groups.mjs: it returns the new store as `state` instead of changing the old one.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const MAX_ENTRIES = 50
// parseMember wants a message; check() swaps it for the rule name, so these only keep the POST routes' wording.
const PAYER_MESSAGE = 'payer must be a member of the group'
const MEMBER_MESSAGE = 'from and to must be two different members of the group'
const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}

// Thrown by the entry checks with the name of the rule the entry breaks.
class RuleError extends Error {}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Runs parse and returns its value; a ValidationError becomes the given rule.
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new RuleError(rule)
    throw err
  }
}

// A flag that is false when its key is absent, and must be a boolean when present.
function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

// The body's checks, in the order the first failing one decides the 400 message.
function parseBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  return { entries, dryRun: parseFlag(body, 'dry_run'), skipRecorded: parseFlag(body, 'skip_recorded') }
}

// The clean { type, fields } of one entry, or a RuleError naming the first rule it breaks before `duplicate`.
function parseEntry(entry, group) {
  if (!isObject(entry)) throw new RuleError('not-an-object')
  const { type } = entry
  if (type !== 'expense' && type !== 'payment') throw new RuleError('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[type].includes(key))) throw new RuleError('unknown-field')
  if (type === 'expense') {
    return {
      type,
      fields: {
        description: check('bad-description', () => parseDescription(entry.description)),
        payer: check('bad-payer', () => parseMember(entry.payer, group.members, PAYER_MESSAGE)),
        amount: check('bad-amount', () => parseAmount(entry.amount)),
        split: check('bad-split', () => parseSplit(entry.split, group.members)),
      },
    }
  }
  const from = check('bad-from', () => parseMember(entry.from, group.members, MEMBER_MESSAGE))
  const to = check('bad-to', () => parseMember(entry.to, group.members, MEMBER_MESSAGE))
  if (to === from) throw new RuleError('bad-to')
  return { type, fields: { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) } }
}

// Two expenses are the same when payer, amount in cents and trimmed, lower-cased description match.
const expenseKey = ({ payer, amount, description }) =>
  JSON.stringify([payer, amount, description.trim().toLowerCase()])

// Sorts the entries into { problems, skipped, accepted }: one problem per entry that breaks a rule, the indexes
// of the already-recorded entries skip_recorded leaves out, and the parsed entries to import, all in entry order.
function sortEntries(state, group, entries, skipRecorded) {
  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  // Every expense that passed its field checks, so a later copy is a duplicate even of a skipped one.
  const seen = new Set()
  const problems = []
  const skipped = []
  const accepted = []
  for (const [index, entry] of entries.entries()) {
    let parsed
    try {
      parsed = parseEntry(entry, group)
    } catch (err) {
      if (!(err instanceof RuleError)) throw err
      problems.push({ index, rule: err.message })
      continue
    }
    if (parsed.type === 'payment') {
      const paymentKey = JSON.stringify([parsed.fields.from, parsed.fields.to, parsed.fields.amount])
      const isDuplicate = seen.has(paymentKey)
      seen.add(paymentKey)
      if (isDuplicate) {
        problems.push({ index, rule: 'duplicate' })
        continue
      }
    }
    if (parsed.type === 'expense') {
      const key = expenseKey(parsed.fields)
      const isDuplicate = seen.has(key)
      seen.add(key)
      if (isDuplicate) {
        problems.push({ index, rule: 'duplicate' })
        continue
      }
      if (recorded.has(key)) {
        if (skipRecorded) skipped.push(index)
        else problems.push({ index, rule: 'already-recorded' })
        continue
      }
    }
    accepted.push(parsed)
  }
  return { problems, skipped, accepted }
}

// The store with the accepted entries added, each kind numbered on from its next id in entry order.
function addEntries(state, group, accepted) {
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
  return { expenses, payments, next }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseBody(body)
  const { problems, skipped, accepted } = sortEntries(state, group, entries, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  const { expenses, payments, next } = addEntries(state, group, accepted)
  const reply = {
    expenses: expenses.map(expenseView),
    payments: payments.map(paymentView),
    skipped,
    balances: balances(next, group),
  }
  if (dryRun) return { status: 200, body: reply }
  // Nothing to record (every entry skipped): reply as a success but leave the data file alone.
  return { status: 201, body: reply, ...(accepted.length > 0 && { state: next }) }
}
