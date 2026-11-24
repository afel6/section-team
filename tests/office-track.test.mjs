import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackOffice } from '../hooks/office-track.mjs'

const N = { backend: 'Moss' }
const first = (states, now = 0, names = N) => trackOffice(undefined, { states, names, now })
const step = (prev, states, now, names = N) => trackOffice(prev, { states, names, now })

test('the first track rebuilds and moves nobody', () => {
  const r = first({ backend: 'running' })
  assert.equal(r.rebuild, true)
  assert.deepEqual(r.track.moves, {})
})

test('a wake records an arrive at that tick', () => {
  const r = step(first({}).track, { backend: 'running' }, 1000)
  assert.deepEqual(r.track.moves.backend, { kind: 'arrive', at: 1000 })
  assert.equal(r.rebuild, true)
})

test('running to waiting mid-walk rebuilds but keeps the walk', () => {
  const woke = step(first({}).track, { backend: 'running' }, 1000)
  const r = step(woke.track, { backend: 'waiting' }, 2000)
  assert.equal(r.rebuild, true)
  assert.equal(r.track.moves.backend.at, 1000)
})

test('the first tick after the walk ends rebuilds once, then never again while nothing changes', () => {
  const woke = step(first({}).track, { backend: 'running' }, 1000)
  const mid = step(woke.track, { backend: 'waiting' }, 2000)
  const end = step(mid.track, { backend: 'waiting' }, 3300)
  assert.equal(end.rebuild, true)
  assert.equal(step(end.track, { backend: 'waiting' }, 4300).rebuild, false)
})

test('a clock that is not a number tracks as time zero', () => {
  const r = step(first({}, NaN).track, { backend: 'running' }, NaN)
  assert.deepEqual(r.track.moves.backend, { kind: 'arrive', at: 0 })
})

test('done is free, so finishing records a leave', () => {
  const run = first({ backend: 'running' })
  const r = step(run.track, { backend: 'done' }, 9000)
  assert.deepEqual(r.track.moves.backend, { kind: 'leave', at: 9000 })
})

test('a name change rebuilds', () => {
  const run = first({ backend: 'running' })
  const same = step(run.track, { backend: 'running' }, 5000)
  assert.equal(same.rebuild, false)
  assert.equal(step(same.track, { backend: 'running' }, 6000, { backend: 'Nova' }).rebuild, true)
})

test('prev is never mutated', () => {
  const prev = first({}).track
  const snap = JSON.stringify(prev)
  step(prev, { backend: 'running' }, 1000)
  assert.equal(JSON.stringify(prev), snap)
})

test('a look change rebuilds once', () => {
  const night = trackOffice(undefined, { states: {}, names: N, look: 'night', now: 0 })
  const same = trackOffice(night.track, { states: {}, names: N, look: 'night', now: 1000 })
  assert.equal(same.rebuild, false)
  const yellow = trackOffice(same.track, { states: {}, names: N, look: 'yellow', now: 2000 })
  assert.equal(yellow.rebuild, true)
  assert.equal(trackOffice(yellow.track, { states: {}, names: N, look: 'yellow', now: 3000 }).rebuild, false)
})
