// How loans are ordered and shown.

// By due date, earliest first, loans without a due date last; the same due date by loan number.
function byDueThenNumber(a, b) {
  if (a.due === b.due) return a.number - b.number
  if (a.due === null) return 1
  if (b.due === null) return -1
  return a.due < b.due ? -1 : 1
}

export const sortLoans = loans => loans.toSorted(byDueThenNumber)

// "#3 Drill -> Sam (due 2026-03-01) [returned]"; the due date and the returned mark only when they apply.
export function formatLoan(loan) {
  const due = loan.due === null ? '' : ` (due ${loan.due})`
  const returned = loan.returned ? ' [returned]' : ''
  return `#${loan.number} ${loan.item} -> ${loan.person}${due}${returned}`
}
