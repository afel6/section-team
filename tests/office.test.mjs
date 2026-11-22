import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORDER, SEATED, WALK_MS, officeSvg, officeAlt, creatureSvg } from '../hooks/office.mjs'

const NOW = 100000
const WALK = '.wk1{animation:wk1 2.2s ease-in-out -1s both}'
const allRunning = Object.fromEntries(ORDER.map(id => [id, 'running']))
const worst = () => officeSvg({
  states: allRunning,
  names: Object.fromEntries(ORDER.map(id => [id, 'ABCDEFGHIJKL'])),
  moves: Object.fromEntries(ORDER.map(id => [id, { kind: 'arrive', at: NOW - 1000 }])),
  now: NOW,
})

test('exports', () => {
  assert.equal(ORDER.length, 10)
  assert.deepEqual([...SEATED], ['running', 'waiting', 'problem'])
  assert.equal(WALK_MS, 2200)
  assert.match(creatureSvg('backend', 'idle'), /^<svg /)
})

test('the office fits the Svg limit at its worst', () => {
  assert.ok(worst().length < 131072)
})

test('the office holds only plain vector', () => {
  for (const src of [worst(), officeSvg({})]) {
    assert.doesNotMatch(src, /url\(|href|data:|<image|\|NaN|undefined/)
    assert.doesNotMatch(src, /&(?!amp;|lt;|gt;|quot;)/)
  }
})

test('same input, same source; now moves only delays', () => {
  assert.equal(worst(), worst())
  const strip = s => s.replace(/-?[\d.]+s\b/g, 's')
  assert.equal(strip(officeSvg({ now: 0 })), strip(officeSvg({ now: 5000 })))
})

test('a move that disagrees with the state is ignored', () => {
  assert.equal(
    officeSvg({ states: { backend: 'asleep' }, moves: { backend: { kind: 'arrive', at: 0 } }, now: 0 }),
    officeSvg({ states: { backend: 'asleep' }, now: 0 }))
  assert.equal(
    officeSvg({ states: { backend: 'running' }, moves: { backend: { kind: 'leave', at: 0 } }, now: 0 }),
    officeSvg({ states: { backend: 'running' }, now: 0 }))
})

test('seats: running, waiting and problem sit; done and asleep stroll', () => {
  for (const s of ['running', 'waiting', 'problem']) assert.ok(!officeSvg({ states: { backend: s } }).includes('.rm1{'))
  const done = officeSvg({ states: { backend: 'done' } })
  assert.ok(done.includes('.rm1{') && done.includes('class="st-done"'))
  const asleep = officeSvg({ states: { backend: 'asleep' } })
  assert.ok(asleep.includes('.rm1{') && !asleep.includes('class="st-done"'))
})

test('walk timing', () => {
  const svg = (state, kind, at) => officeSvg({ states: { backend: state }, moves: { backend: { kind, at } }, now: NOW })
  assert.ok(svg('running', 'arrive', 99000).includes(WALK))
  assert.ok(!svg('running', 'arrive', 97000).includes('.wk1{'))
  const leaving = svg('asleep', 'leave', 99000)
  assert.ok(leaving.includes(WALK))
  assert.ok(leaving.includes('.rm1{animation:rm1 22s ease-in-out 1.2s infinite}'))
  assert.ok(svg('asleep', 'leave', 70000).includes('.rm1{animation:rm1 22s ease-in-out -7.7s infinite}'))
})

test('a creature that never moved strolls on the clock', () => {
  assert.ok(officeSvg({ now: 0 }).includes('.rm1{animation:rm1 22s ease-in-out -1.9s infinite}'))
})

test('names are escaped', () => {
  const svg = officeSvg({ names: { backend: '<&">' } })
  assert.ok(svg.includes('&lt;&amp;&quot;&gt;'))
  assert.ok(!svg.includes('<&">'))
})

test('default and custom nameplates', () => {
  const svg = officeSvg({ names: { backend: 'Nova' } })
  assert.ok(svg.includes('>Nova</text>') && svg.includes('>Iris</text>'))
  assert.ok(!svg.includes('>Moss</text>'))
})

test('alt text', () => {
  assert.equal(officeAlt({}), 'The office: all ten builders are free, strolling the corridor.')
  assert.equal(officeAlt({ states: { backend: 'running', frontend: 'done' }, names: { backend: 'Nova' } }),
    'The office: Nova (backend) running at their desks; 9 free in the corridor.')
})
