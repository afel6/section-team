// Route table. `takesBody` marks the routes whose JSON body the server reads and passes on as `body`.
import { addExpense, addPayment, deleteExpense, editExpense, listExpenses, listPayments } from './expenses.mjs'
import { createGroup, getBalances, getGroup, getSettleUp } from './groups.mjs'

// Checked in order; the first match wins.
const ROUTES = [
  { method: 'POST', path: /^\/groups$/, handler: createGroup, takesBody: true },
  { method: 'GET', path: /^\/groups\/([^/]+)$/, handler: getGroup },
  { method: 'GET', path: /^\/groups\/([^/]+)\/balances$/, handler: getBalances },
  { method: 'GET', path: /^\/groups\/([^/]+)\/settle-up$/, handler: getSettleUp },
  { method: 'POST', path: /^\/groups\/([^/]+)\/expenses$/, handler: addExpense, takesBody: true },
  { method: 'GET', path: /^\/groups\/([^/]+)\/expenses$/, handler: listExpenses },
  { method: 'PATCH', path: /^\/groups\/([^/]+)\/expenses\/([^/]+)$/, handler: editExpense, takesBody: true },
  { method: 'DELETE', path: /^\/groups\/([^/]+)\/expenses\/([^/]+)$/, handler: deleteExpense },
  { method: 'POST', path: /^\/groups\/([^/]+)\/payments$/, handler: addPayment, takesBody: true },
  { method: 'GET', path: /^\/groups\/([^/]+)\/payments$/, handler: listPayments },
]

// Returns { handler, params, takesBody } for the first route matching method and pathname, or null.
export function findRoute(method, pathname) {
  for (const { method: m, path, handler, takesBody = false } of ROUTES) {
    const match = m === method && path.exec(pathname)
    if (match) return { handler, params: match.slice(1), takesBody }
  }
  return null
}
