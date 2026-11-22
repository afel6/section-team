import { ORDER, SEATED, WALK_MS } from './office.mjs';

const seatsOf = states => Object.fromEntries(ORDER.map(id => [id, SEATED.has(states[id] ?? 'asleep')]));
const keyOf = (states, names, moves, now) => JSON.stringify({
  states, names, walking: ORDER.filter(id => moves[id] && now - moves[id].at < WALK_MS),
});

// Decides who just started walking and whether the office picture must be rebuilt. A clock that is not finite counts as 0.
export function trackOffice(prev, { states, names, now: clock }) {
  const now = Number.isFinite(clock) ? clock : 0;
  const seats = seatsOf(states);
  const moves = { ...(prev?.moves ?? {}) };
  if (prev) {
    for (const id of ORDER) {
      if (seats[id] !== !!prev.seats[id]) moves[id] = { kind: seats[id] ? 'arrive' : 'leave', at: now };
    }
  }
  const key = keyOf(states, names, moves, now);
  return { track: { key, seats, moves }, rebuild: !prev || key !== prev.key };
}
