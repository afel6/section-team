import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { modeSwitch, promptCheck, saveRequest } from '../hooks/user-prompt-submit.mjs'
import { readBriefHash, recordBriefHash, recordMode } from '../hooks/lib/mode-record.mjs'
import { briefHash, modeRules } from '../hooks/lib/brief.mjs'
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
const REPLACES_LINE = "These sections replace the ones with the same headings in your brief; your next job message to a section states this mode's gate."
const notice = (from, to) => `Mode is now ${modeName(to)} (was ${modeName(from)}). From your next step on:\n${REPLACES_LINE}\n\n${modeRules(to)}`
const staysIn = (reason, mode) => `mode switch check skipped: .team/mode.json: ${reason}, so this session stays in ${modeName(mode)} mode`
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
  const text = modeSwitch(e, h)
  assert.equal(text, 'Mode is now Max (was Balanced). From your next step on:\nThese sections replace the ones with the same headings in your brief; your next job message to a section states this mode\'s gate.\n\n' + modeRules('max'))
  assert.equal(text.split('\n')[1], "These sections replace the ones with the same headings in your brief; your next job message to a section states this mode's gate.")
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
  assert.equal(modeSwitch(e, h), null)
  assert.deepEqual(promptCheck(e, h), { notice: null, warnings: [] })
})

test('two sessions on one project are each told once', () => {
  const h = tempHome()
  recordMode(h, 's-a', 'balanced')
  recordMode(h, 's-b', 'balanced')
  const dir = project('{"mode":"max"}')
  assert.equal(modeSwitch(event(dir, 's-a'), h), notice('balanced', 'max'))
  assert.equal(modeSwitch(event(dir, 's-b'), h), notice('balanced', 'max'))
  assert.equal(modeSwitch(event(dir, 's-a'), h), null)
  assert.equal(modeSwitch(event(dir, 's-b'), h), null)
  assert.equal(recordText(h, 's-a'), '{"mode":"max"}')
  assert.equal(recordText(h, 's-b'), '{"mode":"max"}')
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
    ['{not json', 'mode switch check skipped: .team/mode.json: not valid JSON, so this session stays in Max mode'],
    ['{"mode":"turbo"}', 'mode switch check skipped: .team/mode.json: unknown mode "turbo", so this session stays in Max mode'],
    ['[1]', 'mode switch check skipped: .team/mode.json: not a JSON object, so this session stays in Max mode'],
  ]
  for (const [text, warning] of cases) {
    setMode(dir, text)
    ageFile(file, 8)
    assert.deepEqual(promptCheck(e, h), { notice: null, warnings: [warning] }, text)
    assert.equal(recordText(h, 's1'), '{"mode":"max"}', text)
    assert.ok(isFresh(file), text)
  }
  setMode(dir, '{"mode":"balanced"}')
  assert.equal(modeSwitch(e, h), notice('max', 'balanced'))
  setMode(dir, '{not json')
  assert.deepEqual(promptCheck(event(dir, 'new'), h), { notice: null, warnings: ['mode switch check skipped: .team/mode.json: not valid JSON, so Balanced is used'] })
  assert.equal(existsSync(recordPath(h, 'new')), false)
})

test('a saved lean is Balanced: no notice for a Balanced session, one for a Max session, and never a warning', () => {
  const h = tempHome()
  recordMode(h, 's-a', 'balanced')
  recordMode(h, 's-b', 'max')
  const dir = project('{"mode":"lean"}')
  assert.deepEqual(promptCheck(event(dir, 's-a'), h), { notice: null, warnings: [] })
  assert.equal(modeSwitch(event(dir, 's-b'), h), notice('max', 'balanced'))
  assert.equal(recordText(h, 's-a'), '{"mode":"balanced"}')
  assert.equal(recordText(h, 's-b'), '{"mode":"balanced"}')
})

test('a Max record with .team as a file keeps the session in Max mode', () => {
  const h = tempHome()
  recordMode(h, 's1', 'max')
  const dir = join(tempDir('ct-ups-'), 'with space')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.team'), 'not a folder')
  assert.deepEqual(promptCheck(event(dir), h), { notice: null, warnings: [staysIn('.team is not a folder', 'max')] })
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
})

test('a Balanced record with an unknown mode and a bad autoInstallSkills names both problems', () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const dir = project('{"mode":"turbo","autoInstallSkills":"yes"}')
  assert.deepEqual(promptCheck(event(dir), h), {
    notice: null,
    warnings: ['mode switch check skipped: .team/mode.json: unknown mode "turbo", so this session stays in Balanced mode; autoInstallSkills must be true or false, so it is ignored'],
  })
  assert.equal(recordText(h, 's1'), '{"mode":"balanced"}')
})

test('a broken record plus a broken mode file falls back to Balanced and reports both', () => {
  const h = tempHome()
  mkdirSync(dirname(recordPath(h, 's1')), { recursive: true })
  writeFileSync(recordPath(h, 's1'), 'not json')
  const dir = project('{not json')
  assert.deepEqual(promptCheck(event(dir), h), {
    notice: null,
    warnings: ['mode record read failed: mode record is not valid', 'mode switch check skipped: .team/mode.json: not valid JSON, so Balanced is used'],
  })
})

test('a valid mode with a bad autoInstallSkills is announced and still warned', () => {
  const h = tempHome()
  recordMode(h, 's1', 'max')
  const dir = project('{"mode":"balanced","autoInstallSkills":"yes"}')
  assert.deepEqual(promptCheck(event(dir), h), { notice: notice('max', 'balanced'), warnings: [BAD_SKILLS] })
  assert.equal(recordText(h, 's1'), '{"mode":"balanced"}')
  assert.deepEqual(promptCheck(event(dir), h), { notice: null, warnings: [BAD_SKILLS] })
  assert.deepEqual(promptCheck(event(dir, 'fresh'), h), { notice: null, warnings: [BAD_SKILLS] })
  assert.equal(recordText(h, 'fresh'), '{"mode":"balanced"}')
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
  assert.deepEqual(JSON.parse(r.stdout), { systemMessage: PREFIX + 'mode switch check skipped: .team/mode.json: not valid JSON, so this session stays in Max mode' })
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

test('hook: input without an absolute cwd says so in one line', () => {
  const h = tempHome()
  for (const input of ['{}', 'not json', JSON.stringify({ session_id: 's1' }), JSON.stringify({ session_id: 's1', cwd: '.' })]) {
    const r = run(input, h)
    assert.equal(r.status, 0, input)
    assert.deepEqual(JSON.parse(r.stdout), { systemMessage: PREFIX + 'mode switch check skipped: the hook input has no absolute cwd' }, input)
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

// --- a long pasted request is saved, so the supervisor points sections to it instead of re-typing it ---

const LONG = `${'a'.repeat(2998)}é\n` // 3000 characters
const POINTER = path => `The user's message is saved word for word in \`${path}\`: point sections to that file instead of re-typing it, and quote only the lines a job needs.`
const SAVED_PATH = /`(\.team\/reports\/\d{4}-\d{2}-\d{2}\/\d{6}-user-request\.md)`/
const gitInit = dir => {
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}
// session-start adds .team/ to .git/info/exclude; a saved request needs git to ignore it
const excludeTeam = (dir, line = '.team/') => {
  writeFileSync(join(dir, '.git', 'info', 'exclude'), `${line}
`)
  return dir
}
const gitProject = text => excludeTeam(gitInit(project(text)))
const withPrompt = (dir, prompt, id = 's1') => ({ ...event(dir, id), prompt })
const reportsOf = dir => join(dir, '.team', 'reports')

test('a 3000-character prompt in a git repo with .team/ is saved word for word and pointed to', () => {
  const dir = gitProject()
  const r = promptCheck(withPrompt(dir, LONG), tempHome())
  assert.deepEqual(r.warnings, [])
  const path = SAVED_PATH.exec(r.notice)?.[1]
  assert.ok(path, r.notice)
  assert.equal(r.notice, POINTER(path))
  assert.equal(readFileSync(join(dir, path), 'utf8'), LONG)
  assert.equal(saveRequest(dir, LONG, true, new Date(2026, 10, 10, 12, 0, 0)), '.team/reports/2026-11-10/120000-user-request.md')
  assert.equal(saveRequest(dir, LONG, true, new Date(2026, 10, 10, 12, 0, 0)), '.team/reports/2026-11-10/120000-user-request-2.md')
})

test('a prompt under 3000 characters, or not a string, is not saved', () => {
  const dir = gitProject()
  assert.deepEqual(promptCheck(withPrompt(dir, LONG.slice(1)), tempHome()), { notice: null, warnings: [] })
  for (const prompt of [undefined, null, 42, ['x'.repeat(3000)]]) assert.equal(saveRequest(dir, prompt, true), null, String(prompt))
  assert.equal(existsSync(reportsOf(dir)), false)
})

test('a long prompt is not saved without .team/, with .team/keep-in-git, or outside git', () => {
  const noTeam = gitInit(tempDir('ct-ups-'))
  assert.deepEqual(promptCheck(withPrompt(noTeam, LONG), tempHome()), { notice: null, warnings: [] })
  assert.equal(existsSync(join(noTeam, '.team')), false)
  const kept = excludeTeam(gitInit(project()), '.team/near-miss/')
  writeFileSync(join(kept, '.team', 'keep-in-git'), '')
  assert.deepEqual(promptCheck(withPrompt(kept, LONG), tempHome()), { notice: null, warnings: [] })
  assert.equal(existsSync(reportsOf(kept)), false)
  const plain = project()
  assert.deepEqual(promptCheck(withPrompt(plain, LONG), tempHome()), { notice: null, warnings: [] })
  assert.equal(existsSync(reportsOf(plain)), false)
  assert.equal(saveRequest(gitProject(), LONG, false), null)
})

test('a long prompt is not saved in a git repo that does not ignore .team/', () => {
  const open = gitInit(project())
  assert.deepEqual(promptCheck(withPrompt(open, LONG), tempHome()), { notice: null, warnings: [] })
  assert.equal(existsSync(reportsOf(open)), false)
})

test("a mode notice records the new mode's brief hash, so a later resume in that mode leaves the brief out", () => {
  const h = tempHome()
  recordMode(h, 's1', 'max')
  recordBriefHash(h, 's1', briefHash('max'))
  const r = promptCheck(event(project('{"mode":"balanced"}'), 's1'), h)
  assert.ok(r.notice.startsWith('Mode is now Balanced (was Max)'), r.notice)
  assert.equal(readBriefHash(h, 's1'), briefHash('balanced'))
})

test('after a mode change the notice comes first, then a blank line and the pointer', () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const r = promptCheck(withPrompt(gitProject('{"mode":"max"}'), LONG), h)
  assert.deepEqual(r.warnings, [])
  assert.equal(r.notice, `${notice('balanced', 'max')}\n\n${POINTER(SAVED_PATH.exec(r.notice)[1])}`)
})

test('an unwritable .team/reports gives one request save warning and the mode check still works', () => {
  const h = tempHome()
  recordMode(h, 's1', 'balanced')
  const dir = gitProject('{"mode":"max"}')
  writeFileSync(reportsOf(dir), 'a file where the reports folder should be')
  const r = promptCheck(withPrompt(dir, LONG), h)
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /^request save failed: E[A-Z]+$/)
  assert.equal(r.notice, notice('balanced', 'max'))
  assert.equal(recordText(h, 's1'), '{"mode":"max"}')
})

test('hook: the prompt from the hook input is saved and pointed to', () => {
  const h = tempHome()
  const dir = gitProject()
  const r = run(promptInput(dir, { prompt: LONG }), h)
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
  const out = JSON.parse(r.stdout)
  const path = SAVED_PATH.exec(out.hookSpecificOutput.additionalContext)[1]
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: POINTER(path) } })
  assert.equal(readFileSync(join(dir, path), 'utf8'), LONG)
})

test('hooks.json runs the hook on UserPromptSubmit like the other hooks', () => {
  const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).hooks
  assert.deepEqual(hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.mjs"' }] }])
})
