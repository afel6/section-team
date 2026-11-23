import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTrusted, check } from '../scripts/trusted-source.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/trusted-source.mjs', import.meta.url))
const LIST = ['anthropics', 'vercel-labs', 'microsoft']
const VAR = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const ON = { [VAR]: '1' }
const USER_LIST = '~/.claude/section-team/trusted-sources.json'
const tempDir = prefix => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
const writeFile = (dir, parts, text) => {
  mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true })
  writeFileSync(join(dir, ...parts), text)
  return dir
}
const listFile = list => join(writeFile(tempDir('trusted-'), ['list.json'], JSON.stringify(list)), 'list.json')
// A temp home, with the user's trusted-sources.json holding text when it is given.
const homeWith = text => (text === undefined ? tempDir('trusted-home-') : writeFile(tempDir('trusted-home-'), ['.claude', 'section-team', 'trusted-sources.json'], text))
const SHIPPED_EMPTY = listFile([])
// check() with temp paths only: a temp home with no list, a clean temp project and the shipped list as it ships, unless a test passes its own.
const checkWith = (owner, { env = ON, home = homeWith(), dir = tempDir('trusted-project-'), file = SHIPPED_EMPTY } = {}) => check(owner, { env, home, dir, file })
// The CLI in a clean temp folder with a temp home, so it reads no real ~/.claude and no real project.
const cli = (args, { env = {}, home = homeWith(), cwd = tempDir('trusted-cwd-') } = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, [VAR]: undefined, HOME: home, USERPROFILE: home, ...env } })
const oneLine = message => typeof message === 'string' && message.length > 0 && !message.includes('\n')
const gitRepo = () => {
  const dir = tempDir('trusted-repo-')
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}

test('exact owners match, case-insensitively', () => {
  assert.equal(isTrusted('anthropics', LIST), true)
  assert.equal(isTrusted('Vercel-Labs', LIST), true)
})

test('look-alike, empty, path and oversized owners are not trusted', () => {
  for (const owner of ['anthropic', 'vercel-lab', 'microsoft-x', '', '../x', 'K', 'a'.repeat(200), undefined, 5]) {
    assert.equal(isTrusted(owner, LIST), false, String(owner))
  }
})

test('a Unicode look-alike never folds onto a listed owner', () => {
  assert.equal(isTrusted('K', ['k']), false)
})

test("an owner in the user's ~/.claude/section-team/trusted-sources.json may install unattended when every check passes", () => {
  const home = homeWith(JSON.stringify(LIST))
  assert.deepEqual(checkWith('anthropics', { home }), { code: 0 })
  assert.deepEqual(checkWith('MICROSOFT', { home }), { code: 0 })
})

test('an owner in the shipped list may install unattended too, and a missing shipped list counts as empty', () => {
  assert.deepEqual(checkWith('anthropics', { file: listFile(LIST) }), { code: 0 })
  const missing = join(tempDir('trusted-'), 'missing.json')
  assert.deepEqual(checkWith('anthropics', { file: missing, home: homeWith(JSON.stringify(LIST)) }), { code: 0 })
  assert.equal(checkWith('anthropics', { file: missing }).code, 1)
})

// --- one test per refusal reason: exit 1 means ask the user ---

test('refusal: SECTION_TEAM_AUTO_INSTALL_SKILLS is not exactly 1', () => {
  const home = homeWith(JSON.stringify(LIST))
  for (const env of [{}, { [VAR]: '0' }, { [VAR]: 'true' }, { [VAR]: ' 1' }, { [VAR]: '' }]) {
    const r = checkWith('anthropics', { env, home })
    assert.equal(r.code, 1, JSON.stringify(env))
    assert.ok(oneLine(r.message) && r.message.includes(VAR), JSON.stringify(env))
  }
})

test("refusal: the project's .team/mode.json says autoInstallSkills false, also from a folder below the repo root", () => {
  const home = homeWith(JSON.stringify(LIST))
  const plain = writeFile(tempDir('trusted-project-'), ['.team', 'mode.json'], '{"mode":"max","autoInstallSkills":false}')
  const r = checkWith('anthropics', { home, dir: plain })
  assert.equal(r.code, 1)
  assert.ok(oneLine(r.message) && r.message.includes('autoInstallSkills false'), r.message)
  const repo = writeFile(gitRepo(), ['.team', 'mode.json'], '{"autoInstallSkills":false}')
  const sub = join(repo, 'packages', 'app')
  mkdirSync(sub, { recursive: true })
  assert.equal(checkWith('anthropics', { home, dir: sub }).code, 1)
  assert.deepEqual(checkWith('anthropics', { home, dir: writeFile(tempDir('trusted-project-'), ['.team', 'mode.json'], '{"autoInstallSkills":true}') }), { code: 0 })
})

test("refusal: the project's .claude settings set SECTION_TEAM_AUTO_INSTALL_SKILLS, in settings.json or settings.local.json, here or at the repo root", () => {
  const home = homeWith(JSON.stringify(LIST))
  const settings = JSON.stringify({ env: ON })
  for (const name of ['settings.json', 'settings.local.json']) {
    const r = checkWith('anthropics', { home, dir: writeFile(tempDir('trusted-project-'), ['.claude', name], settings) })
    assert.equal(r.code, 1, name)
    assert.ok(oneLine(r.message) && r.message.includes('.claude settings') && r.message.includes(VAR), r.message)
  }
  const repo = writeFile(gitRepo(), ['.claude', 'settings.local.json'], settings)
  const sub = join(repo, 'packages', 'app')
  mkdirSync(sub, { recursive: true })
  assert.equal(checkWith('anthropics', { home, dir: sub }).code, 1)
})

test('refusal: a settings key in another letter case counts, since Windows reads environment names in any case', () => {
  const home = homeWith(JSON.stringify(LIST))
  const dir = writeFile(tempDir('trusted-project-'), ['.claude', 'settings.json'], JSON.stringify({ env: { Section_Team_Auto_Install_Skills: '1' } }))
  const r = checkWith('anthropics', { home, dir })
  assert.equal(r.code, 1)
  assert.ok(oneLine(r.message) && r.message.includes(VAR), r.message)
})

test("refusal: the project's .claude settings set HOME or USERPROFILE, so its committed files cannot pass for the user's own list", () => {
  const checkout = gitRepo()
  const fakeHome = join(checkout, 'fakehome')
  for (const home of [checkout, fakeHome]) writeFile(home, ['.claude', 'section-team', 'trusted-sources.json'], JSON.stringify(['evil-owner']))
  const cases = [
    [{ HOME: checkout, USERPROFILE: checkout }, checkout],
    [{ ...ON, HOME: checkout, USERPROFILE: checkout }, checkout],
    [{ UserProfile: fakeHome }, fakeHome],
  ]
  for (const [env, home] of cases) {
    writeFile(checkout, ['.claude', 'settings.json'], JSON.stringify({ env }))
    const r = checkWith('evil-owner', { home, dir: checkout })
    assert.equal(r.code, 1, JSON.stringify(env))
    assert.ok(oneLine(r.message) && /HOME|USERPROFILE/.test(r.message) && !r.message.includes(checkout), r.message)
  }
  writeFile(checkout, ['.claude', 'settings.json'], JSON.stringify({ env: { ...ON, HOME: checkout, USERPROFILE: checkout } }))
  assert.equal(cli(['evil-owner', checkout], { env: ON, home: checkout }).status, 1, 'the CLI, its home taken from HOME and USERPROFILE')
})

test("a project root that is the home folder reads ~/.claude/settings.json as the user's own, not as project settings", () => {
  const home = writeFile(homeWith(JSON.stringify(LIST)), ['.claude', 'settings.json'], JSON.stringify({ env: ON }))
  assert.deepEqual(checkWith('anthropics', { home, dir: home }), { code: 0 })
  if (process.platform === 'win32') assert.deepEqual(checkWith('anthropics', { home, dir: home.toUpperCase() }), { code: 0 }, 'letter case')
  execFileSync('git', ['-C', home, 'init', '-q'])
  const below = join(home, 'projects', 'x')
  mkdirSync(below, { recursive: true })
  assert.deepEqual(checkWith('anthropics', { home, dir: below }), { code: 0 }, 'a plain folder in a home that is a git repo')
})

test('refusal: the owner is in neither list', () => {
  const r = checkWith('anthropic', { home: homeWith(JSON.stringify(LIST)) })
  assert.equal(r.code, 1)
  assert.ok(oneLine(r.message))
  assert.equal(checkWith('anthropics').code, 1, 'the shipped list is empty and the user listed no one')
})

// --- unusable input: exit 2, which also means ask ---

test("a broken user list or shipped list exits 2 with one line that names no real path, and trusts no one", () => {
  for (const text of ['{nope', '{"a":1}', '["ok", 5]']) {
    const home = homeWith(text)
    const r = checkWith('anthropics', { home, file: listFile(LIST) })
    assert.equal(r.code, 2, text)
    assert.ok(oneLine(r.message) && r.message.includes(USER_LIST) && !r.message.includes(home), r.message)
  }
  const broken = join(writeFile(tempDir('trusted-'), ['broken.json'], '{nope'), 'broken.json')
  const r = checkWith('anthropics', { file: broken, home: homeWith(JSON.stringify(LIST)) })
  assert.equal(r.code, 2)
  assert.ok(oneLine(r.message) && !r.message.includes(broken), r.message)
})

test('a user list with a byte order mark still reads', () => {
  assert.deepEqual(checkWith('anthropics', { home: homeWith(`﻿${JSON.stringify(LIST)}`) }), { code: 0 })
})

test('a project root that is not a folder, or project settings that cannot be read, exit 2 with one line and no path', () => {
  const home = homeWith(JSON.stringify(LIST))
  const missing = join(tempDir('trusted-'), 'missing')
  const file = join(writeFile(tempDir('trusted-'), ['a-file'], 'x'), 'a-file')
  for (const dir of [missing, file, '']) {
    const r = checkWith('anthropics', { home, dir })
    assert.equal(r.code, 2, dir)
    assert.ok(oneLine(r.message) && (dir === '' || !r.message.includes(dir)), r.message)
  }
  const blocked = tempDir('trusted-project-')
  mkdirSync(join(blocked, '.claude', 'settings.json'), { recursive: true })
  const r = checkWith('anthropics', { home, dir: blocked })
  assert.equal(r.code, 2)
  assert.ok(oneLine(r.message) && r.message.includes('EISDIR') && !r.message.includes(blocked), r.message)
})

// --- the CLI contract shared with add-skill: node scripts/trusted-source.mjs <owner> [<project-root>] ---

test('CLI: exit 0 only when the user listed the owner and the project root passes; exit 1 when the project vetoes', () => {
  const home = homeWith(JSON.stringify(LIST))
  const clean = tempDir('trusted-project-')
  assert.equal(cli(['anthropics', clean], { env: ON, home }).status, 0)
  const vetoing = writeFile(tempDir('trusted-project-'), ['.claude', 'settings.json'], JSON.stringify({ env: ON }))
  const r = cli(['anthropics', vetoing], { env: ON, home })
  assert.equal(r.status, 1)
  assert.equal(r.stderr.trim().split('\n').length, 1)
})

test('CLI: without a project root the folder it runs in is checked, so a one-argument call cannot skip the project checks', () => {
  const home = homeWith(JSON.stringify(LIST))
  assert.equal(cli(['anthropics'], { env: ON, home }).status, 0)
  const vetoing = writeFile(tempDir('trusted-project-'), ['.team', 'mode.json'], '{"autoInstallSkills":false}')
  assert.equal(cli(['anthropics'], { env: ON, home, cwd: vetoing }).status, 1)
})

test('CLI: exits 1 for every owner with the shipped empty list and no user list, the variable on or off', () => {
  for (const env of [{}, ON]) {
    for (const owner of ['anthropics', 'MICROSOFT', 'anthropic', '', '../x']) assert.equal(cli([owner], { env }).status, 1, `${owner} ${JSON.stringify(env)}`)
  }
})

test('CLI: exits 2 with one usage line when the owner is missing or there are more than two arguments', () => {
  for (const args of [[], ['a', 'b', 'c']]) {
    const r = cli(args, { env: ON })
    assert.equal(r.status, 2)
    assert.equal(r.stderr.trim().split('\n').length, 1)
    assert.ok(r.stderr.includes('<owner> [<project-root>]'))
  }
})

test('the shipped list is empty: no owner is trusted until the user adds one', () => {
  const list = JSON.parse(readFileSync(new URL('../skills/add-skill/trusted-sources.json', import.meta.url), 'utf8'))
  assert.deepEqual(list, [])
})

test("SKILL.md: a section's Suggested skill installs unattended only when trusted-source exits 0 for its owner, as a searched one does", () => {
  const skill = readFileSync(new URL('../skills/add-skill/SKILL.md', import.meta.url), 'utf8')
  const step6 = skill.split('\n').find(line => line.startsWith('6. **Ask ONE question**')) ?? ''
  assert.ok(step6.includes("A section's `Suggested skill:` and a skill found by the search section below skip this question only when all three hold: the brief's Mode section says automatic skill installs are on, `node \"<plugin root>/scripts/trusted-source.mjs\" \"<owner>\" \"<project root>\"` exits 0 (any other exit means ask), and step 4 found no red flag"), step6)
  assert.ok(step6.includes('The `<owner>` is the GitHub owner from step 1, never a name the skill itself gives'), 'whose owner is checked')
  assert.ok(!step6.includes('the user has approved installs that pass this review'), 'the review alone no longer skips the question')
  assert.ok(step6.includes('Otherwise ask as usual.'), 'the attended path stays')
})

test('an owner a section suggested is checked like any other: unlisted asks, listed may install, installs off asks', () => {
  const home = homeWith(JSON.stringify(['listed-owner']))
  assert.equal(checkWith('suggested-owner', { home }).code, 1)
  assert.deepEqual(checkWith('listed-owner', { home }), { code: 0 })
  assert.equal(checkWith('listed-owner', { home, env: {} }).code, 1, 'installs off')
})

test('SKILL.md says installs ask the user unless SECTION_TEAM_AUTO_INSTALL_SKILLS=1, and the owner list ships empty', () => {
  const skill = readFileSync(new URL('../skills/add-skill/SKILL.md', import.meta.url), 'utf8')
  const description = skill.split('\n').find(line => line.startsWith('description:'))
  assert.ok(description.includes("installs it after the user's OK, or without asking only when SECTION_TEAM_AUTO_INSTALL_SKILLS=1, the review is clean and the owner is trusted,"), description)
  assert.ok(skill.includes('empty when the plugin ships'))
  assert.ok(!skill.includes('`anthropics`, `vercel-labs`, `microsoft`'), 'no default owners named')
})

// --- the folders checked: the project folder, its git top folder and the main checkout ---

test("refusal: a project folder below a linked worktree whose own .claude settings set the switch", () => {
  const home = homeWith(JSON.stringify(LIST))
  const main = gitRepo()
  execFileSync('git', ['-C', main, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'])
  const worktree = join(tempDir('trusted-wt-'), 'wt')
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', worktree])
  const sub = join(writeFile(worktree, ['.claude', 'settings.json'], JSON.stringify({ env: ON })), 'packages', 'app')
  mkdirSync(sub, { recursive: true })
  const r = checkWith('anthropics', { home, dir: sub })
  assert.equal(r.code, 1)
  assert.ok(oneLine(r.message) && r.message.includes(VAR), r.message)
})

test('a .git that git cannot read exits 2 with one line and no path', () => {
  const dir = writeFile(tempDir('trusted-broken-'), ['.git'], 'gitdir: ./nowhere\n')
  const r = checkWith('anthropics', { home: homeWith(JSON.stringify(LIST)), dir })
  assert.equal(r.code, 2)
  assert.ok(oneLine(r.message) && !r.message.includes(dir), r.message)
})
