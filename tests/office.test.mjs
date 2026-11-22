import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORDER, SEATED, WALK_MS, officeSvg, officeAlt, creatureSvg } from '../hooks/office.mjs'

const NOW = 100000
const WALK = '.wk1{animation:wk1 2.2s ease-in-out -1s both}'
const worst = (state = 'running') => officeSvg({
  states: Object.fromEntries(ORDER.map(id => [id, state])),
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

test('the office fits the Svg limit at its worst: every builder arriving at its desk with a problem', () => {
  assert.ok(worst('problem').length < 131072)
})

test('the office holds only plain vector', () => {
  for (const src of [worst(), officeSvg({})]) {
    assert.doesNotMatch(src, /url\(|href|data:|<image|\\|NaN|undefined/)
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
  assert.ok(svg('asleep', 'leave', 70000).includes('.rm1{animation:rm1 22s ease-in-out -5.8s infinite}'))
  assert.ok(svg('running', 'arrive', 99000).includes('.wk1 .of-step{animation-delay:-1s}'))
})

test('a creature that never moved strolls on the clock', () => {
  assert.ok(officeSvg({ now: 0 }).includes('.rm1{animation:rm1 22s ease-in-out -1.9s infinite}'))
})

test('a name outside the rules falls back to the default', () => {
  const bad = officeSvg({ names: { backend: '<&">' } })
  assert.ok(bad.includes('>Moss</text>') && !bad.includes('<&">'))
  const evil = officeSvg({ names: { backend: 'a\\b url(x)' } })
  assert.ok(evil.includes('>Moss</text>') && !evil.includes('\\') &&!evil.includes('url('))
  assert.match(officeAlt({ states: { backend: 'running' }, names: { backend: '<&">' } }), /Moss \(backend\)/)
  const href = officeSvg({ names: { backend: 'Href' } })
  assert.ok(href.includes('>Moss</text>') && !/href/i.test(href))
  assert.match(officeAlt({ states: { backend: 'running' }, names: { backend: 'xHREFx' } }), /^The office: Moss \(backend\) running/)
})

test('a clock that is not a number draws as time zero', () => {
  for (const now of [NaN, Infinity, -Infinity]) {
    assert.ok(!officeSvg({ now }).includes('NaN'))
    assert.equal(officeSvg({ now }), officeSvg({ now: 0 }))
  }
})

test('the clock hand keeps the real seconds across rebuilds', () => {
  const hand = (now) => /\.of-hand\{[^}]*animation-delay:(-[\d.]+s)\}/.exec(officeSvg({ now }))?.[1]
  assert.equal(hand(5000), '-5s')
  assert.equal(hand(65000), '-5s')
  assert.notEqual(hand(5000), hand(20000))
})

test('in-walk and walk-over strolls line up', () => {
  const delay = (svg) => Number(/\.rm1\{animation:rm1 22s ease-in-out (-?[\d.]+)s infinite\}/.exec(svg)[1])
  const build = (now) => officeSvg({ states: { backend: 'asleep' }, moves: { backend: { kind: 'leave', at: 100000 } }, now })
  const startMs = 101000 + delay(build(101000)) * 1000 // mid-walk build: the stroll starts when the walk ends
  const later = 107000
  assert.equal(startMs, 102200)
  assert.equal(-delay(build(later)), (later - startMs) / 1000)
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
