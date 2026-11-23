import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectEnvSets, projectFoldersSet, projectHomeVar, settingsFolders, settingsVeto } from '../hooks/lib/project-settings.mjs'

const VAR = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const tempRoot = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-settings-')))
const withSettings = (root, name, text) => {
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude', name), text)
  return root
}
const settingsJson = env => JSON.stringify({ env })

test('settings.json or settings.local.json setting the variable, to any value, counts', () => {
  for (const name of ['settings.json', 'settings.local.json']) {
    for (const value of ['1', '0', '']) {
      assert.equal(projectEnvSets(withSettings(tempRoot(), name, settingsJson({ [VAR]: value })), VAR), true, `${name} ${value}`)
    }
  }
})

test('no .claude folder, no env, another variable or a non-object env does not count', () => {
  assert.equal(projectEnvSets(tempRoot(), VAR), false)
  assert.equal(projectEnvSets(join(tempRoot(), 'missing'), VAR), false)
  for (const text of ['{}', settingsJson({ OTHER: '1' }), '{"env":["SECTION_TEAM_AUTO_INSTALL_SKILLS"]}', '{"env":null}', '{"env":"SECTION_TEAM_AUTO_INSTALL_SKILLS"}', '[]', 'null']) {
    assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.json', text), VAR), false, text)
  }
})

test('an inherited name does not count: only the env object\'s own key', () => {
  assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.json', settingsJson({})), 'toString'), false)
})

test('a byte order mark before the JSON still counts', () => {
  assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.json', `﻿${settingsJson({ [VAR]: '1' })}`), VAR), true)
})

test('a file that is not JSON counts when it names the variable, so the hook refuses rather than guesses', () => {
  assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.json', `{ // a comment\n "env": { "${VAR}": "1" } }`), VAR), true)
  assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.json', '{not json'), VAR), false)
})

test('a key in another letter case counts on every platform, since Windows reads environment names in any case', () => {
  for (const key of ['Section_Team_Auto_Install_Skills', 'section_team_auto_install_skills']) {
    assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.json', settingsJson({ [key]: '1' })), VAR), true, key)
    assert.equal(projectEnvSets(withSettings(tempRoot(), 'settings.local.json', `{ // a comment\n "env": { "${key}": "1" } }`), VAR), true, `${key}, not JSON`)
  }
})

test('a .claude that is a file is no settings; a settings path that is a folder throws its code', () => {
  const root = tempRoot()
  writeFileSync(join(root, '.claude'), 'a file where the folder should be')
  assert.equal(projectEnvSets(root, VAR), false)
  const folder = tempRoot()
  mkdirSync(join(folder, '.claude', 'settings.json'), { recursive: true })
  assert.throws(() => projectEnvSets(folder, VAR), err => err?.code === 'EISDIR')
})

test('projectFoldersSet checks every folder but the home folder, whose .claude/settings.json is the user\'s own', () => {
  const home = withSettings(tempRoot(), 'settings.json', settingsJson({ [VAR]: '1' }))
  const project = withSettings(tempRoot(), 'settings.local.json', settingsJson({ [VAR]: '1' }))
  const clean = tempRoot()
  assert.equal(projectFoldersSet([home], VAR, home), false)
  assert.equal(projectFoldersSet([join(home, '.'), clean], VAR, home), false, 'the same folder written another way')
  assert.equal(projectFoldersSet([clean, project], VAR, home), true)
  assert.equal(projectFoldersSet([home, project], VAR, home), true)
  if (process.platform === 'win32') assert.equal(projectFoldersSet([home.toUpperCase()], VAR, home), false, 'letter case')
})

test('projectHomeVar names HOME or USERPROFILE when any folder\'s settings set it, in any letter case, and null otherwise', () => {
  const clean = tempRoot()
  assert.equal(projectHomeVar([clean, withSettings(tempRoot(), 'settings.json', settingsJson({ [VAR]: '1' }))]), null)
  for (const [key, shown] of [['HOME', 'HOME'], ['USERPROFILE', 'USERPROFILE'], ['UserProfile', 'USERPROFILE']]) {
    assert.equal(projectHomeVar([clean, withSettings(tempRoot(), 'settings.local.json', settingsJson({ [key]: clean }))]), shown, key)
  }
})

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', ...args])
const sameList = (actual, expected) => assert.deepEqual(actual.map(f => f.toLowerCase()), expected.map(f => f.toLowerCase()))

test('settingsFolders: the folder, its git top folder and the main checkout, each once', () => {
  const plain = tempRoot()
  sameList(settingsFolders(plain), [plain])
  const main = tempRoot()
  git(main, 'init', '-q')
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
  sameList(settingsFolders(main), [main])
  const sub = join(main, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  sameList(settingsFolders(sub), [sub, main])
  const worktree = join(tempRoot(), 'wt')
  git(main, 'worktree', 'add', '-q', worktree)
  const below = join(worktree, 'packages', 'app')
  mkdirSync(below, { recursive: true })
  sameList(settingsFolders(below), [below, worktree, main])
})

test("settingsFolders: a GIT_DIR from the hook's env, naming another repo, still gives the real worktree's top folder", () => {
  const main = tempRoot()
  git(main, 'init', '-q')
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
  const worktree = join(tempRoot(), 'wt')
  git(main, 'worktree', 'add', '-q', worktree)
  const below = join(worktree, 'packages', 'app')
  mkdirSync(below, { recursive: true })
  const other = tempRoot()
  git(other, 'init', '-q')
  const before = process.env.GIT_DIR
  process.env.GIT_DIR = join(other, '.git')
  try {
    const folders = settingsFolders(below).map(f => f.toLowerCase())
    assert.ok(folders.includes(worktree.toLowerCase()), folders.join(' | '))
  } finally {
    if (before === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = before
  }
})

test('settingsFolders throws, naming no path, when a .git is there but git cannot name the top folder', () => {
  const dir = withSettings(tempRoot(), 'settings.json', '{}')
  writeFileSync(join(dir, '.git'), 'gitdir: ./nowhere\n')
  assert.throws(() => settingsFolders(dir), err => !String(err.message).includes(dir))
  assert.throws(() => settingsVeto(dir, VAR, tempRoot()))
})

test('settingsVeto names HOME or USERPROFILE first, then the variable, else null', () => {
  const home = tempRoot()
  assert.equal(settingsVeto(tempRoot(), VAR, home), null)
  assert.equal(settingsVeto(withSettings(tempRoot(), 'settings.json', settingsJson({ [VAR]: '1' })), VAR, home), VAR)
  assert.equal(settingsVeto(withSettings(tempRoot(), 'settings.json', settingsJson({ [VAR]: '1', UserProfile: home })), VAR, home), 'USERPROFILE')
  assert.equal(settingsVeto(withSettings(home, 'settings.json', settingsJson({ [VAR]: '1' })), VAR, home), null, "the home folder's settings are the user's own")
})
