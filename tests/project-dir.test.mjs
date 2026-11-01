import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { recordMode } from '../hooks/session-start.mjs'

const { CLAUDE_PROJECT_DIR: _ignored, ...HOOK_ENV } = process.env
const hook = name => fileURLToPath(new URL(`../hooks/${name}.mjs`, import.meta.url))
const tempDir = prefix => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
// Spawned from an empty temp folder, so a hook that wrongly used its own working folder would not find a mode file.
const run = (script, input, home, extraEnv = {}) => spawnSync(process.execPath, [script], {
  input, encoding: 'utf8', cwd: tempDir('ct-run-'), env: { ...HOOK_ENV, HOME: home, USERPROFILE: home, ...extraEnv },
})
const recordFile = (home, id) => join(home, '.claude', 'section-team', 'modes', `${id}.json`)
const recordText = (home, id) => readFileSync(recordFile(home, id), 'utf8')
// A non-git project (its path has a space) set to Max, and a subfolder of it with no .team of its own.
const project = () => {
  const root = join(tempDir('ct-pd-'), 'with space')
  mkdirSync(join(root, '.team'), { recursive: true })
  writeFileSync(join(root, '.team', 'mode.json'), '{"mode":"max"}')
  const sub = join(root, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  return { root, sub }
}
const promptInput = cwd => JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, session_id: 's1', prompt: 'hi' })
const startInput = cwd => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd, session_id: 's1' })
const contextOf = r => JSON.parse(r.stdout).hookSpecificOutput.additionalContext

test('user-prompt-submit reads the mode of CLAUDE_PROJECT_DIR, not of a subfolder cwd', () => {
  const { root, sub } = project()
  const h = tempDir('ct-home-')
  recordMode(h, 's1', 'max')
  const withEnv = run(hook('user-prompt-submit'), promptInput(sub), h, { CLAUDE_PROJECT_DIR: root })
  assert.equal(withEnv.status, 0)
  assert.equal(withEnv.stderr, '')
  assert.equal(withEnv.stdout, '')
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
  // Control: the subfolder alone has no .team, so it reads as Balanced.
  const h2 = tempDir('ct-home-')
  recordMode(h2, 's1', 'max')
  const control = run(hook('user-prompt-submit'), promptInput(sub), h2)
  assert.equal(control.status, 0)
  assert.ok(contextOf(control).startsWith('Mode is now Balanced (was Max).'), control.stdout)
})

test('session-start reads the mode of CLAUDE_PROJECT_DIR, not of a subfolder cwd', () => {
  const { root, sub } = project()
  const h = tempDir('ct-home-')
  const withEnv = run(hook('session-start'), startInput(sub), h, { CLAUDE_PROJECT_DIR: root })
  assert.equal(withEnv.status, 0)
  assert.ok(contextOf(withEnv).includes('- This project runs in Max mode (from .team/mode.json).'), withEnv.stdout)
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
  // Control: the subfolder alone has no .team, so it reads as the default.
  const control = run(hook('session-start'), startInput(sub), tempDir('ct-home-'))
  assert.equal(control.status, 0)
  assert.ok(contextOf(control).includes('- This project runs in Balanced mode (default).'), control.stdout)
})

test('an empty CLAUDE_PROJECT_DIR falls back to the input cwd', () => {
  const { root } = project()
  const h = tempDir('ct-home-')
  recordMode(h, 's1', 'max')
  const r = run(hook('user-prompt-submit'), promptInput(root), h, { CLAUDE_PROJECT_DIR: '' })
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.equal(r.stdout, '')
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
})

test('with CLAUDE_PROJECT_DIR set, an input without a cwd still reads that project', () => {
  const { root } = project()
  const h = tempDir('ct-home-')
  recordMode(h, 's1', 'max')
  const env = { CLAUDE_PROJECT_DIR: root }
  const prompt = run(hook('user-prompt-submit'), JSON.stringify({ session_id: 's1' }), h, env)
  assert.equal(prompt.status, 0)
  assert.equal(prompt.stderr, '')
  assert.equal(prompt.stdout, '')
  const noId = 'mode switch check skipped: no usable session id (letters, digits, - and _ only)'
  assert.deepEqual(JSON.parse(run(hook('user-prompt-submit'), 'not json', h, env).stdout), { systemMessage: `section-team user-prompt-submit: ${noId}` })
  const start = run(hook('session-start'), 'not json', tempDir('ct-home-'), env)
  assert.equal(start.status, 0)
  const out = JSON.parse(start.stdout)
  assert.ok(out.hookSpecificOutput.additionalContext.includes('- This project runs in Max mode (from .team/mode.json).'))
  assert.match(out.systemMessage, /^section-team session-start: mode record failed: no usable session id[^\n]*$/)
})
