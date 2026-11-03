// POST /groups/:id/import: records a list of expenses and payments for a group in one write, all or none.
// Same handler contract as lib/groups.mjs: it returns a new store instead of changing the one it gets.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { balances, expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const BODY_FIELDS = ['entries', 'dry_run', 'skip_recorded']
const MAX_ENTRIES = 50
const ENTRY_FIELDS = {
  expense: ['type', 'description', 'payer', 'amount', 'split'],
  payment: ['type', 'from', 'to', 'amount'],
}

// A rule broken by one entry; caught per entry and listed in the 422 reply.
class EntryProblem extends Error {
  constructor(rule) {
    super(rule)
    this.rule = rule
  }
}

// Runs parse, turning its ValidationError into the entry rule `rule`.
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw new EntryProblem(rule)
    throw err
  }
}

// Checks the body fields in the order the README lists them; throws ValidationError (400) on the first bad one.
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

// One entry as { type, fields }, the fields as the POST routes would store them; throws EntryProblem.
function parseEntry(entry, group) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new EntryProblem('not-an-object')
  const { type } = entry
  if (type !== 'expense' && type !== 'payment') throw new EntryProblem('bad-type')
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[type].includes(key))) throw new EntryProblem('unknown-field')
  const { members } = group
  if (type === 'expense') {
    // The same parsers, in the same order, as POST /groups/:id/expenses; a missing split means every member.
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

// Expenses match when payer, amount in cents and description (trimmed, lower case) are the same.
const expenseKey = ({ payer, amount, description }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseImportBody(body)

  const recorded = new Set(state.expenses.filter(e => e.group === group.id).map(expenseKey))
  const seen = new Set()
  const problems = []
  const accepted = []
  const skipped = []
  entries.forEach((entry, index) => {
    let parsed
    try {
      parsed = parseEntry(entry, group)
    } catch (err) {
      if (!(err instanceof EntryProblem)) throw err
      problems.push({ index, rule: err.rule })
      return
    }
    if (parsed.type === 'expense') {
      const key = expenseKey(parsed.fields)
      const isDuplicate = seen.has(key)
      seen.add(key)
      if (isDuplicate) {
        problems.push({ index, rule: 'duplicate' })
        return
      }
      if (recorded.has(key)) {
        if (skipRecorded) skipped.push(index)
        else problems.push({ index, rule: 'already-recorded' })
        return
      }
    }
    accepted.push(parsed)
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
    status: dryRun ? 200 : 201,
    body: {
      expenses: expenses.map(expenseView),
      payments: payments.map(paymentView),
      skipped,
      balances: balances(next, group),
    },
  }
  // Nothing to write on a dry run, or when every entry was skipped.
  return dryRun || accepted.length === 0 ? reply : { ...reply, state: next }
}
