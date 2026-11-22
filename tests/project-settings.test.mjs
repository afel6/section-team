import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectEnvSets, projectFoldersSet } from '../hooks/lib/project-settings.mjs'

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
