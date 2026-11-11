// The running-balance rule.

// The on_date of the first move at which the running balance is below zero, or null.
export function firstDip(moves) {
  const total = moves.reduce((sum, move) => sum + move.qty, 0)
  return total < 0 ? moves.at(-1).on_date : null
}

// The moves in running-balance order with a new one added: it gets the highest id, so it comes last on its date.
export const withNewMove = (moves, added) => [...moves.filter(m => m.on_date <= added.on_date), added, ...moves.filter(m => m.on_date > added.on_date)]
