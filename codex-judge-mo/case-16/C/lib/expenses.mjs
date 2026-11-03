// Expense and payment handlers, same contract as lib/groups.mjs: they return a new store instead of changing
// the one they get.
import { NOT_FOUND, findGroup } from './groups.mjs'
import { expenseView, paymentView } from './ledger.mjs'
import { parseAmount, parseDescription, parseMember, parseSplit, ValidationError } from './validate.mjs'

const byId = (a, b) => a.id - b.id

// The fields of a new expense in group, from a request body. Throws ValidationError on the first bad field.
export function parseExpense(group, body) {
  return {
    description: parseDescription(body.description),
    payer: parseMember(body.payer, group.members, 'payer must be a member of the group'),
    amount: parseAmount(body.amount),
    split: parseSplit(body.split, group.members),
  }
}

export function addExpense({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const expense = { id: state.nextExpenseId, group: group.id, ...parseExpense(group, body) }
  const next = { ...state, expenses: [...state.expenses, expense], nextExpenseId: state.nextExpenseId + 1 }
  return { status: 201, body: expenseView(expense), state: next }
}

export function listExpenses({ state, params }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const expenses = state.expenses.filter(e => e.group === group.id).sort(byId).map(expenseView)
  return { status: 200, body: { expenses } }
}

const findExpense = (state, [groupId, expenseId]) =>
  state.expenses.find(e => e.group === groupId && String(e.id) === expenseId)

// Changes the fields the body gives, each checked as on POST; fields left out keep their value.
export function editExpense({ state, params, body }) {
  const group = findGroup(state, params[0])
  const old = group && findExpense(state, params)
  if (!old) return NOT_FOUND
  const changes = {}
  if ('description' in body) changes.description = parseDescription(body.description)
  if ('payer' in body) changes.payer = parseMember(body.payer, group.members, 'payer must be a member of the group')
  if ('amount' in body) changes.amount = parseAmount(body.amount)
  if ('split' in body) changes.split = parseSplit(body.split, group.members)
  const edited = { ...old, ...changes }
  const next = { ...state, expenses: state.expenses.map(e => (e === old ? edited : e)) }
  return { status: 200, body: expenseView(edited), state: next }
}

export function deleteExpense({ state, params }) {
  const expense = findExpense(state, params)
  if (!expense) return NOT_FOUND
  return { status: 204, state: { ...state, expenses: state.expenses.filter(e => e !== expense) } }
}

export function addPayment({ state, params, body }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const message = 'from and to must be two different members of the group'
  const from = parseMember(body.from, group.members, message)
  const to = parseMember(body.to, group.members, message)
  if (from === to) throw new ValidationError(message)
  const payment = { id: state.nextPaymentId, group: group.id, from, to, amount: parseAmount(body.amount) }
  const next = { ...state, payments: [...state.payments, payment], nextPaymentId: state.nextPaymentId + 1 }
  return { status: 201, body: paymentView(payment), state: next }
}

export function listPayments({ state, params }) {
  const group = findGroup(state, params[0])
  if (!group) return NOT_FOUND
  const payments = state.payments.filter(p => p.group === group.id).sort(byId).map(paymentView)
  return { status: 200, body: { payments } }
}
