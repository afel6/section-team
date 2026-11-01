import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { modeSwitch, promptCheck } from '../hooks/user-prompt-submit.mjs'
import { modeRecordFile, recordMode } from '../hooks/session-start.mjs'
import { modeRules } from '../hooks/lib/brief.mjs'
import { MODES, modeName } from '../hooks/lib/mode.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/user-prompt-submit.mjs', import.meta.url))
const HOOKS = fileURLToPath(new URL('../hooks/', import.meta.url))
const HOOKS_JSON = fileURLToPath(new URL('../hooks/hooks.json', import.meta.url))
const PREFIX = 'section-team user-prompt-submit: '
const BAD_SKILLS = '.team/mode.json: autoInstallSkills must be true or false, so it is ignored'
const NO_ID = 'mode switch check skipped: no usable session id (letters, digits, - and _ only)'
const { CLAUDE_PROJECT_DIR: _ignored, ...HOOK_ENV } = process.env
const tempDir = prefix => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
const tempHome = () => tempDir('ct-home-')
// A project folder (its path has a space) with .team/ and, when text is given, .team/mode.json.
const project = text => {
  const dir = join(tempDir('ct-ups-'), 'with space')
  mkdirSync(join(dir, '.team'), { recursive: true })
  if (text !== undefined) setMode(dir, text)
  return dir
}
const setMode = (dir, text) => writeFileSync(join(dir, '.team', 'mode.json'), text)
const recordPath = (home, id) => join(home, '.claude', 'section-team', 'modes', `${id}.json`)
const recordText = (home, id) => readFileSync(recordPath(home, id), 'utf8')
const notice = (from, to) => `Mode is now ${modeName(to)} (was ${modeName(from)}). From your next step on:\n\n${modeRules(to)}`
const run = (input, home, script = SCRIPT) => spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...HOOK_ENV, HOME: home, USERPROFILE: home } })
const promptInput = (cwd, extra = {}) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, session_id: 's1', prompt: 'hi', ...extra })
const ageFile = (file, days) => {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  utimesSync(file, when, when)
}
const isFresh = file => statSync(file).mtimeMs > Date.now() - 60_000
const event = (dir, id = 's1') => ({ cwd: dir, session_id: id })

test('a switch from Balanced to Max is announced once with the Max rules and recorded', () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const e = event(project('{"mode":"max"}'))
  assert.equal(modeSwitch(e, h), 'Mode is now Max (was Balanced). From your next step on:\n\n' + modeRules('max'))
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
  assert.equal(modeSwitch(e, h), null)
  assert.deepEqual(promptCheck(e, h), { notice: null, warnings: [] })
})

test('two sessions on one project are each told once', () => {
  const h = tempHome()
  recordMode(h, 's-a', 'balanced')
  recordMode(h, 's-b', 'balanced')
  const dir = project('{"mode":"lean"}')
  assert.equal(modeSwitch(event(dir, 's-a'), h), notice('balanced', 'lean'))
  assert.equal(modeSwitch(event(dir, 's-b'), h), notice('balanced', 'lean'))
  assert.equal(modeSwitch(event(dir, 's-a'), h), null)
  assert.equal(modeSwitch(event(dir, 's-b'), h), null)
  assert.equal(recordText(h, 's-a'), '{"mode":"lean"}')
  assert.equal(recordText(h, 's-b'), '{"mode":"lean"}')
})

test('a session with no record is recorded silently', () => {
  const h = tempHome()
  const dir = project('{"mode":"max"}')
  assert.deepEqual(promptCheck(event(dir, 'old'), h), { notice: null, warnings: [] })
  assert.equal(recordText(h, 'old'), '{"mode":"max"}')
  assert.equal(modeSwitch(event(dir, 'old'), h), null)
  assert.deepEqual(promptCheck(event(project(), 'old2'), h), { notice: null, warnings: [] })
  assert.equal(recordText(h, 'old2'), '{"mode":"balanced"}')
})

test('every prompt rewrites the record, so a quiet session is not pruned', () => {
  const h = tempHome()
  recordMode(h, 's1', 'max')
  ageFile(recordPath(h, 's1'), 8)
  assert.equal(modeSwitch(event(project('{"mode":"max"}')), h), null)
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
  assert.ok(isFresh(recordPath(h, 's1')))
})

test('an unusable mode announces nothing, keeps and refreshes the record, and the fixed file is announced against it', () => {
  const h = tempHome()
  const file = recordPath(h, 's1')
  recordMode(h, 's1', 'max')
  const dir = project('{not json')
  const e = event(dir)
  const cases = [
    ['{not json', 'mode switch check skipped: .team/mode.json: not valid JSON, so Balanced is used'],
    ['{"mode":"turbo"}', 'mode switch check skipped: .team/mode.json: unknown mode "turbo", so Balanced is used'],
    ['[1]', 'mode switch check skipped: .team/mode.json: not a JSON object, so Balanced is used'],
  ]
  for (const [text, warning] of cases) {
    setMode(dir, text)
    ageFile(file, 8)
    assert.deepEqual(promptCheck(e, h), { notice: null, warnings: [warning] }, text)
    assert.equal(recordText(h, 's1'), '{"mode":"max"}', text)
    assert.ok(isFresh(file), text)
  }
  setMode(dir, '{"mode":"lean"}')
  assert.equal(modeSwitch(e, h), notice('max', 'lean'))
  setMode(dir, '{not json')
  assert.equal(promptCheck(event(dir, 'new'), h).notice, null)
  assert.equal(existsSync(recordPath(h, 'new')), false)
})

test('a valid mode with a bad autoInstallSkills is announced and still warned', () => {
  const h = tempHome()
  recordMode(h, 's1', 'max')
  const dir = project('{"mode":"lean","autoInstallSkills":"yes"}')
  assert.deepEqual(promptCheck(event(dir), h), { notice: notice('max', 'lean'), warnings: [BAD_SKILLS] })
  assert.equal(recordText(h, 's1'), '{"mode":"lean"}')
  assert.deepEqual(promptCheck(event(dir), h), { notice: null, warnings: [BAD_SKILLS] })
  assert.deepEqual(promptCheck(event(dir, 'fresh'), h), { notice: null, warnings: [BAD_SKILLS] })
  assert.equal(recordText(h, 'fresh'), '{"mode":"lean"}')
})

test('hook: a valid mode with a bad autoInstallSkills prints the notice and the warning', () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const r = run(promptInput(project('{"mode":"max","autoInstallSkills":"yes"}')), h)
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.deepEqual(JSON.parse(r.stdout), {
    systemMessage: PREFIX + BAD_SKILLS,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notice('balanced', 'max') },
  })
})

test('hook: a bad mode file gives one systemMessage line and no context', () => {
  const h = tempHome()
  recordMode(h, 's1', 'max')
  const r = run(promptInput(project('{not json')), h)
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.deepEqual(JSON.parse(r.stdout), { systemMessage: PREFIX + 'mode switch check skipped: .team/mode.json: not valid JSON, so Balanced is used' })
})

test('an unwritable record folder announces nothing and says so in one systemMessage line', () => {
  const h = tempHome()
  mkdirSync(join(h, '.claude', 'section-team'), { recursive: true })
  writeFileSync(join(h, '.claude', 'section-team', 'modes'), 'not a folder')
  const dir = project('{"mode":"max"}')
  assert.equal(modeSwitch(event(dir), h), null)
  const r = run(promptInput(dir), h)
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  const out = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(out), ['systemMessage'])
  // Windows reports ENOENT for a path under a file, so the read part is optional.
  assert.match(out.systemMessage, /^section-team user-prompt-submit: (mode record read failed: E[A-Z]+; )?mode record failed: E[A-Z]+$/)
})

test('a record that cannot be rewritten holds the notice back, so it is not repeated', { skip: process.getuid?.() === 0 && 'root ignores file permissions' }, () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const file = recordPath(h, 's1')
  const e = event(project('{"mode":"max"}'))
  chmodSync(file, 0o444)
  try {
    const r = promptCheck(e, h)
    assert.equal(r.notice, null)
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0], /^mode record failed: E[A-Z]+$/)
    assert.equal(recordText(h, 's1'), '{"mode":"balanced"}')
  } finally {
    chmodSync(file, 0o644)
  }
  assert.equal(modeSwitch(e, h), notice('balanced', 'max'))
})

test('a broken record is replaced by the current mode without a notice', () => {
  const h = tempHome()
  const e = event(project('{"mode":"max"}'))
  mkdirSync(dirname(recordPath(h, 's1')), { recursive: true })
  for (const broken of ['not json', '{"mode":"turbo"}']) {
    writeFileSync(recordPath(h, 's1'), broken)
    assert.deepEqual(promptCheck(e, h), { notice: null, warnings: ['mode record read failed: mode record is not valid'] }, broken)
    assert.equal(recordText(h, 's1'), '{"mode":"max"}', broken)
  }
})

test('a missing or unusable session id writes nothing and says so', () => {
  const h = tempHome()
  const dir = project('{"mode":"max"}')
  for (const id of [undefined, null, '../x', 'a/b', '', 42]) {
    assert.deepEqual(promptCheck({ cwd: dir, session_id: id }, h), { notice: null, warnings: [NO_ID] }, String(id))
  }
  assert.equal(existsSync(join(h, '.claude')), false)
  const r = run(promptInput(dir, { session_id: undefined }), h)
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.deepEqual(JSON.parse(r.stdout), { systemMessage: PREFIX + NO_ID })
})

test('hook: a switch prints only the notice as UserPromptSubmit context; no switch prints nothing', () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const input = promptInput(project('{"mode":"max"}'))
  const first = run(input, h)
  assert.equal(first.status, 0)
  assert.equal(first.stderr, '')
  assert.deepEqual(JSON.parse(first.stdout), {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notice('balanced', 'max') },
  })
  const second = run(input, h)
  assert.equal(second.status, 0)
  assert.equal(second.stdout, '')
})

test('hook: input without a cwd says so in one line', () => {
  const h = tempHome()
  for (const input of ['{}', 'not json', JSON.stringify({ session_id: 's1' })]) {
    const r = run(input, h)
    assert.equal(r.status, 0, input)
    assert.deepEqual(JSON.parse(r.stdout), { systemMessage: PREFIX + 'mode switch check skipped: the hook input has no cwd' }, input)
  }
})

test('hook: a brief part that cannot be read keeps the old record and says so in one line', () => {
  const copyDir = tempDir('ct-copy-')
  cpSync(HOOKS, join(copyDir, 'hooks'), { recursive: true })
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const r = run(promptInput(project('{"mode":"max"}')), h, join(copyDir, 'hooks', 'user-prompt-submit.mjs'))
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  assert.deepEqual(JSON.parse(r.stdout), { systemMessage: PREFIX + 'mode switch check failed: brief part core.md could not be read (ENOENT)' })
  assert.equal(recordText(h, 's1'), '{"mode":"balanced"}')
})

for (const to of MODES) {
  for (const from of MODES.filter(mode => mode !== to)) {
    test(`${from} → ${to}: the notice stays under 10,000 characters`, () => {
      const h = tempHome()
      recordMode(h, 's1', from)
      const text = modeSwitch(event(project(`{"mode":"${to}"}`)), h)
      assert.equal(text, notice(from, to))
      assert.ok(text.length < 10000, `${text.length} characters`)
    })
  }
}

test('hooks.json runs the hook on UserPromptSubmit like the other hooks', () => {
  const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).hooks
  assert.deepEqual(hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.mjs"' }] }])
})

test('modeRecordFile names the session file and refuses a bad id', () => {
  assert.equal(modeRecordFile('H', 's1'), 'H/.claude/section-team/modes/s1.json')
  assert.throws(() => modeRecordFile('H', '../x'), /session id/)
})
