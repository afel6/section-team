import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { isTrusted, check } from '../scripts/trusted-source.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/trusted-source.mjs', import.meta.url))
const LIST = ['anthropics', 'vercel-labs', 'microsoft']
const VAR = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const ON = { [VAR]: '1' }
const cli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, [VAR]: undefined, ...env } })
const listFile = list => {
  const file = join(mkdtempSync(join(tmpdir(), 'trusted-')), 'list.json')
  writeFileSync(file, JSON.stringify(list))
  return file
}

test('exact owners match, case-insensitively', () => {
  assert.equal(isTrusted('anthropics', LIST), true)
  assert.equal(isTrusted('Vercel-Labs', LIST), true)
})

test('look-alike, empty, path and oversized owners are not trusted', () => {
  for (const owner of ['anthropic', 'vercel-lab', 'microsoft-x', '', '../x', 'K', 'a'.repeat(200), undefined, 5]) {
    assert.equal(isTrusted(owner, LIST), false, String(owner))
  }
})

test('a listed owner is trusted only when SECTION_TEAM_AUTO_INSTALL_SKILLS is exactly 1', () => {
  const file = listFile(LIST)
  assert.deepEqual(check('anthropics', file, ON), { code: 0 })
  assert.deepEqual(check('MICROSOFT', file, ON), { code: 0 })
  assert.equal(check('anthropic', file, ON).code, 1)
  for (const env of [{}, { [VAR]: '0' }, { [VAR]: 'true' }, { [VAR]: ' 1' }, { [VAR]: '' }]) {
    const r = check('anthropics', file, env)
    assert.equal(r.code, 1, JSON.stringify(env))
    assert.ok(r.message.includes(VAR) && !r.message.includes('\n'), JSON.stringify(env))
  }
})

test('CLI exits 1 for every owner with the shipped empty list, the variable on or off', () => {
  for (const env of [{}, ON]) {
    for (const owner of ['anthropics', 'MICROSOFT', 'anthropic', '', '../x']) assert.equal(cli([owner], env).status, 1, `${owner} ${JSON.stringify(env)}`)
  }
})

test('CLI exits 2 with one line when the owner argument is missing or doubled', () => {
  for (const args of [[], ['a', 'b']]) {
    const r = cli(args, ON)
    assert.equal(r.status, 2)
    assert.equal(r.stderr.trim().split('\n').length, 1)
  }
})

test('a missing or broken list exits 2 with one line and trusts no one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trusted-'))
  const broken = join(dir, 'broken.json'); writeFileSync(broken, '{nope')
  const wrong = join(dir, 'wrong.json'); writeFileSync(wrong, '{"a":1}')
  for (const file of [join(dir, 'missing.json'), broken, wrong]) {
    const r = check('anthropics', file, ON)
    assert.equal(r.code, 2)
    assert.equal(r.message.split('\n').length, 1)
  }
})

test('the shipped list is empty: no owner is trusted until the user adds one', () => {
  const list = JSON.parse(readFileSync(new URL('../skills/add-skill/trusted-sources.json', import.meta.url), 'utf8'))
  assert.deepEqual(list, [])
})

test('a Unicode look-alike never folds onto a listed owner', () => {
  assert.equal(isTrusted('\u212A', ['k']), false)
})

test('SKILL.md says a searched skill is never covered by the automatic-install sentence', () => {
  const skill = readFileSync(new URL('../skills/add-skill/SKILL.md', import.meta.url), 'utf8')
  assert.ok(skill.includes('is never covered by the automatic-install sentence above'))
})

test('SKILL.md says installs ask the user unless SECTION_TEAM_AUTO_INSTALL_SKILLS=1, and the owner list ships empty', () => {
  const skill = readFileSync(new URL('../skills/add-skill/SKILL.md', import.meta.url), 'utf8')
  const description = skill.split('\n').find(line => line.startsWith('description:'))
  assert.ok(description.includes("installs it after the user's OK, or without asking only when SECTION_TEAM_AUTO_INSTALL_SKILLS=1 and the review is clean"), description)
  assert.ok(skill.includes('empty when the plugin ships'))
  assert.ok(!skill.includes('`anthropics`, `vercel-labs`, `microsoft`'), 'no default owners named')
})

test("SKILL.md lets a searched skill install unattended only when the brief says installs are on, so a project's false holds", () => {
  const skill = readFileSync(new URL('../skills/add-skill/SKILL.md', import.meta.url), 'utf8')
  assert.ok(skill.includes("it installs unattended only if the brief's Mode section says automatic skill installs are on,"))
})
