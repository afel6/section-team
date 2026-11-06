import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTrusted, check } from '../scripts/trusted-source.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/trusted-source.mjs', import.meta.url))
const LIST = ['anthropics', 'vercel-labs', 'microsoft']
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

test('exact owners match, case-insensitively', () => {
  assert.equal(isTrusted('anthropics', LIST), true)
  assert.equal(isTrusted('Vercel-Labs', LIST), true)
})

test('look-alike, empty, path and oversized owners are not trusted', () => {
  for (const owner of ['anthropic', 'vercel-lab', 'microsoft-x', '', '../x', 'a'.repeat(200), undefined, 5]) {
    assert.equal(isTrusted(owner, LIST), false, String(owner))
  }
})

test('CLI exits 0 for a trusted owner and 1 for an untrusted one', () => {
  assert.equal(cli('anthropics').status, 0)
  assert.equal(cli('MICROSOFT').status, 0)
  assert.equal(cli('anthropic').status, 1)
  assert.equal(cli('').status, 1)
  assert.equal(cli('../x').status, 1)
})

test('CLI exits 2 with one line when the owner argument is missing or doubled', () => {
  for (const args of [[], ['a', 'b']]) {
    const r = cli(...args)
    assert.equal(r.status, 2)
    assert.equal(r.stderr.trim().split('\n').length, 1)
  }
})

test('a missing or broken list exits 2 with one line and trusts no one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trusted-'))
  const broken = join(dir, 'broken.json'); writeFileSync(broken, '{nope')
  const wrong = join(dir, 'wrong.json'); writeFileSync(wrong, '{"a":1}')
  for (const file of [join(dir, 'missing.json'), broken, wrong]) {
    const r = check('anthropics', file)
    assert.equal(r.code, 2)
    assert.equal(r.message.split('\n').length, 1)
  }
})
