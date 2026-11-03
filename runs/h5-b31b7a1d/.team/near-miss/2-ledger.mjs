// near-miss: remainder to the last people
// Money maths on whole cents: how an expense is shared, what each member is owed or owes, and how to settle up.
// Amounts are stored as cents and shown by the API as numbers (435 cents is 4.35).

const CENTS_PER_UNIT = 100

export const toAmount = cents => cents / CENTS_PER_UNIT

// Each person's part of an amount in cents, as [name, cents] pairs in the order of people. When the amount does
// not divide evenly, the first people pay one cent more each, so the parts always add up to the amount.
export function splitEvenly(cents, people) {
  const share = Math.floor(cents / people.length)
  const extra = cents % people.length
  return people.map((name, i) => [name, share + (i >= people.length - extra ? 1 : 0)])
}

// An expense as the API shows it: amounts as numbers, plus each person's share keyed by name.
export function expenseView({ id, description, payer, amount, split }) {
  const shares = Object.fromEntries(splitEvenly(amount, split).map(([name, cents]) => [name, toAmount(cents)]))
  return { id, description, payer, amount: toAmount(amount), split, shares }
}

export const paymentView = ({ id, from, to, amount }) => ({ id, from, to, amount: toAmount(amount) })

// Each member's balance in cents, as a Map in the group's member order. A payer is owed the whole expense
// minus their own share; a payment from A to B moves A up and B down.
function balanceCents(state, group) {
  const cents = new Map(group.members.map(name => [name, 0]))
  const add = (name, delta) => cents.set(name, cents.get(name) + delta)
  for (const expense of state.expenses.filter(e => e.group === group.id)) {
    add(expense.payer, expense.amount)
    for (const [name, share] of splitEvenly(expense.amount, expense.split)) add(name, -share)
  }
  for (const payment of state.payments.filter(p => p.group === group.id)) {
    add(payment.from, payment.amount)
    add(payment.to, -payment.amount)
  }
  return cents
}

// What each member of the group is owed (positive) or owes (negative), in the group's member order.
export function balances(state, group) {
  return Object.fromEntries([...balanceCents(state, group)].map(([name, cents]) => [name, toAmount(cents)]))
}

// The member furthest on one side: sign 1 is owed the most, sign -1 owes the most. Ties go to the member who
// comes first in the map; null when nobody is on that side.
function furthest(cents, sign) {
  let best = null
  for (const [name, value] of cents) {
    if (value * sign > 0 && (best === null || value * sign > cents.get(best) * sign)) best = name
  }
  return best
}

// Payments that would bring every balance to 0, as [{from, to, amount}]: the member who owes the most pays the
// member who is owed the most whichever is smaller of the two, until nobody owes anything.
export function settleUp(state, group) {
  const left = balanceCents(state, group)
  const payments = []
  let from = furthest(left, -1)
  let to = furthest(left, 1)
  while (from && to) {
    const cents = Math.min(-left.get(from), left.get(to))
    payments.push({ from, to, amount: toAmount(cents) })
    left.set(from, left.get(from) + cents)
    left.set(to, left.get(to) - cents)
    from = furthest(left, -1)
    to = furthest(left, 1)
  }
  return payments
}
