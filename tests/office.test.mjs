import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORDER, SEATED, WALK_MS, LOOKS, officeSvg, officeAlt, creatureSvg } from '../hooks/office.mjs'
import { CREW } from '../hooks/creatures.mjs'

// WCAG contrast ratio between two #RRGGBB colours.
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

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

// The look: night (the default) or yellow, chosen per user.
test('night is the default and matches no look', () => {
  assert.deepEqual(LOOKS, ['night', 'yellow'])
  const night = officeSvg({ now: 0 })
  assert.equal(officeSvg({ now: 0, look: 'night' }), night)
  assert.equal(officeSvg({ now: 0, look: 'pink' }), night)
})

test('the yellow look paints the room yellow and keeps the desks', () => {
  const yellow = officeSvg({ now: 0, look: 'yellow' })
  assert.ok(yellow.includes('fill="#FFE9A3"'))
  assert.ok(yellow.includes('fill="#B8691C"'))
  for (const night of ['#2C3454', '#3B4677']) assert.ok(!yellow.includes(night), night)
  for (const src of [yellow, officeSvg({ now: 0 })]) assert.ok(src.includes('fill="#D9A877"'))
})

test('Riva stays easy to see on the yellow rug', () => {
  assert.equal(CREW.testing.fill.body[0], '#FACC15')
  assert.ok(contrast('#FACC15', '#B8691C') >= 2, String(contrast('#FACC15', '#B8691C')))
})
