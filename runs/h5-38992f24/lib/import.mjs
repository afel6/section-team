// Import handler: records a list of expenses and payments for a group in one go, all of them or none of them.
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

// A body field that is left out (key absent) is false; a present one must be a boolean, null included.
function parseFlag(body, name) {
  if (!Object.hasOwn(body, name)) return false
  if (typeof body[name] !== 'boolean') throw new ValidationError(`${name} must be true or false`)
  return body[name]
}

function parseImportBody(body) {
  const unknown = Object.keys(body).find(key => !BODY_FIELDS.includes(key))
  if (unknown !== undefined) throw new ValidationError(`unknown field ${unknown}`)
  const { entries } = body
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    throw new ValidationError(`entries must be an array of 1 to ${MAX_ENTRIES} items`)
  }
  return { entries, dryRun: parseFlag(body, 'dry_run'), skipRecorded: parseFlag(body, 'skip_recorded') }
}

// Runs parse and returns its value, or throws the rule name when parse throws a ValidationError.
function check(rule, parse) {
  try {
    return parse()
  } catch (err) {
    if (err instanceof ValidationError) throw rule
    throw err
  }
}

// Two expenses match when payer, amount in cents and trimmed, lower-cased description are the same.
const matchKey = ({ description, payer, amount }) => JSON.stringify([payer, amount, description.trim().toLowerCase()])

// The fields of one entry as { kind, fields }, or throws the name of the first field rule it breaks.
function parseEntry(entry, group) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw 'not-an-object'
  const kind = entry.type
  if (kind !== 'expense' && kind !== 'payment') throw 'bad-type'
  if (Object.keys(entry).some(key => !ENTRY_FIELDS[kind].includes(key))) throw 'unknown-field'
  if (kind === 'expense') {
    return {
      kind,
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
  if (to === from) throw 'bad-to'
  return { kind, fields: { from, to, amount: check('bad-amount', () => parseAmount(entry.amount)) } }
}

// Checks every entry. Returns { problems, parsed }: problems as [{index, rule}] by index, and for each entry
// its { kind, fields, recorded } when it broke no field rule (recorded: it matches an expense already saved).
function checkEntries(entries, group, state, skipRecorded) {
  const saved = new Set(state.expenses.filter(e => e.group === group.id).map(matchKey))
  const seen = new Set()
  const problems = []
  const parsed = entries.map((entry, index) => {
    let result
    try {
      result = parseEntry(entry, group)
    } catch (rule) {
      if (typeof rule !== 'string') throw rule
      problems.push({ index, rule })
      return null
    }
    if (result.kind === 'expense') {
      const key = matchKey(result.fields)
      if (seen.has(key)) problems.push({ index, rule: 'duplicate' })
      else if (saved.has(key)) {
        if (skipRecorded) result.skipped = true
        else problems.push({ index, rule: 'already-recorded' })
      }
      seen.add(key)
    }
    return result
  })
  return { problems, parsed }
}

export function importEntries({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const { entries, dryRun, skipRecorded } = parseImportBody(body)
  const { problems, parsed } = checkEntries(entries, group, state, skipRecorded)
  if (problems.length > 0) return { status: 422, body: { error: 'import rejected', problems } }

  const expenses = []
  const payments = []
  const skipped = []
  let nextExpenseId = state.nextExpenseId
  let nextPaymentId = state.nextPaymentId
  parsed.forEach(({ kind, fields, skipped: skip }, index) => {
    if (skip) skipped.push(index)
    else if (kind === 'expense') expenses.push({ id: nextExpenseId++, group: group.id, ...fields })
    else payments.push({ id: nextPaymentId++, group: group.id, ...fields })
  })
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
  if (dryRun || (expenses.length === 0 && payments.length === 0)) return reply
  return { ...reply, state: next }
}
