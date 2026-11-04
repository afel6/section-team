// The running-balance rule.

// The on_date of the first move at which the running balance is below zero, or null.
export function firstDip(moves) {
  let balance = 0
  for (const move of moves) {
    balance += move.qty
    if (balance < 0) return move.on_date
  }
  return null
}

// The moves in running-balance order with a new one added: it gets the highest id, so it comes last on its date.
export const withNewMove = (moves, added) => [...moves.filter(m => m.on_date <= added.on_date), added, ...moves.filter(m => m.on_date > added.on_date)]
