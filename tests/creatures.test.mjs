import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREW, buildCreature } from '../hooks/creatures.mjs'
import { BUILDER_IDS } from '../hooks/lib/report.mjs'

const STATES = ['idle', 'running', 'waiting', 'done', 'problem', 'asleep']

test('CREW has one creature per builder id', () => {
  assert.deepEqual(new Set(Object.keys(CREW)), new Set(BUILDER_IDS))
})

test('default names', () => {
  assert.deepEqual(Object.fromEntries(BUILDER_IDS.map(id => [id, CREW[id].name])),
    { frontend: 'Iris', backend: 'Moss', database: 'Atlas', testing: 'Pico', security: 'Ward', devops: 'Rigg', uiux: 'Lumi', docs: 'Page', 'ai-llm': 'Echo', mobile: 'Zip' })
})

test('every builder in every state builds', () => {
  for (const id of BUILDER_IDS) for (const state of STATES) {
    const c = buildCreature(id, state)
    for (const [slot, layer] of Object.entries(c.layers)) {
      assert.equal(typeof layer.d, 'string', `${id}/${state}/${slot}`)
      assert.doesNotMatch(layer.d, /NaN|undefined/, `${id}/${state}/${slot}`)
    }
    assert.ok(Number.isFinite(c.zx) && Number.isFinite(c.zy), `${id}/${state}`)
  }
})

test('an unknown state draws idle', () => {
  assert.equal(buildCreature('backend', 'nope').mood, 'idle')
})
