import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flightFor, flingMarkup } from '../hooks/fling.mjs'
import { ORDER } from '../hooks/office.mjs'

// Every number in a path's y places (the second of each pair).
const ys = path => [...path.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(m => Number(m[2]))
const xs = path => [...path.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(m => Number(m[1]))

test('every section gets its style', () => {
  const style = id => flightFor(id, { x: 300, feet: 380 }).style
  for (const id of ['uiux', 'ai-llm']) assert.equal(style(id), 'float', id)
  for (const id of ['mobile', 'devops', 'frontend']) assert.equal(style(id), 'spin', id)
  for (const id of ['backend', 'database', 'testing', 'security', 'docs']) assert.equal(style(id), 'tumble', id)
})

test('flights head for the middle and come home', () => {
  for (const id of ORDER) {
    const left = flightFor(id, { x: 100, feet: 380 }).motion
    const right = flightFor(id, { x: 900, feet: 380 }).motion
    assert.ok(Math.max(...xs(left)) > 0 && Math.min(...xs(left)) >= 0, `${id} left ${left}`)
    assert.ok(Math.min(...xs(right)) < 0 && Math.max(...xs(right)) <= 0, `${id} right ${right}`)
    for (const path of [left, right]) {
      assert.ok(path.startsWith('M0 0'), path)
      assert.ok(path.endsWith('0 0'), path)
    }
  }
})

test('a top-row flight stays in the room', () => {
  for (const id of ORDER) {
    const { motion } = flightFor(id, { x: 300, feet: 202 })
    assert.ok(Math.min(...ys(motion)) >= -(202 - 100), `${id} ${motion}`)
  }
})

test('the markup is one clickable group with no script', () => {
  const markup = flingMarkup(3, 'testing', { x: 0, y: 0 }, '<path/>')
  assert.ok(markup.startsWith('<g id="fl3" class="grab">'), markup)
  assert.ok(markup.endsWith('</g>'))
  assert.ok(markup.includes('begin="fl3.click"'))
  assert.ok(markup.includes('<g class="squish"><path/></g>'))
  assert.doesNotMatch(markup, /\son\w+=|<script|href|url\(/)
})
