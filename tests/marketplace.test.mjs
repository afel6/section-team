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

test('package.json, plugin.json and the marketplace entry agree on the version', () => {
  const pkg = read('../package.json')
  const plugin = read('../.claude-plugin/plugin.json')
  const [entry] = read('../.claude-plugin/marketplace.json').plugins
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.version, plugin.version)
  assert.ok(entry.version === undefined || entry.version === plugin.version, 'marketplace entry version must be absent or equal plugin.json')
})

test('the listing says what the plugin does, what it costs and how to turn it off, with keywords and a homepage', () => {
  const plugin = read('../.claude-plugin/plugin.json')
  const marketplace = read('../.claude-plugin/marketplace.json')
  for (const part of ['supervisor', 'specialist', 'code-review gate', 'Team Board', 'about 5x', '10x', '/team mode off']) assert.ok(plugin.description.includes(part), `plugin description lacks ${part}`)
  assert.ok(marketplace.description.includes('supervisor') && marketplace.description.includes('specialist'), marketplace.description)
  assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.includes('multi-agent') && plugin.keywords.includes('code-review'))
  assert.equal(plugin.homepage, 'https://github.com/afel6/section-team#readme')
})
