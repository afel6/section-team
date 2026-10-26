import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))

test('the repo is its own marketplace: one entry that points at the plugin at the repo root', () => {
  const marketplace = read('../.claude-plugin/marketplace.json')
  const plugin = read('../.claude-plugin/plugin.json')
  assert.equal(marketplace.name, 'section-team')
  assert.equal(typeof marketplace.owner?.name, 'string')
  assert.equal(marketplace.owner.email, undefined, 'no email: the owner keeps it private')
  assert.equal(marketplace.plugins.length, 1)
  const [entry] = marketplace.plugins
  assert.equal(entry.name, plugin.name)
  assert.equal(entry.source, './')
  assert.equal(entry.description, plugin.description)
})
