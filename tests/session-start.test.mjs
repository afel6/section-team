import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildContext, composeContext } from '../hooks/session-start.mjs'
import { assembleBrief } from '../hooks/lib/brief.mjs'
import { recordMode } from '../hooks/lib/mode-record.mjs'
import { MODES, parseModeFile, readMode } from '../hooks/lib/mode.mjs'
import { writeReport, excludeFile } from '../hooks/lib/paths.mjs'
import { PASS_RULE } from '../scripts/gen-agents.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url))
const SPIKES = fileURLToPath(new URL('../docs/v3-spikes.md', import.meta.url))
const FIXTURE = readFileSync(new URL('./fixtures/supervisor-v0.1.1.md', import.meta.url), 'utf8').trim()
const MARKER = '[section-team supervisor]'
const UNGRADED_LINE = 'A section REPORT with `Status: ungraded` could not run its reviewer gate: run `section-team:reviewer` on its changed files with this mode\'s gate before you call that work done.'
const { CLAUDE_PROJECT_DIR: _ignored, ...HOOK_ENV } = process.env
const tempHome = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-home-')))
const tempDir = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-cwd-')))
const repo = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}
const withModeFile = (dir, text) => {
  mkdirSync(join(dir, '.team'), { recursive: true })
  writeFileSync(join(dir, '.team', 'mode.json'), text)
  return dir
}
const run = (input, home = tempHome()) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env: { ...HOOK_ENV, HOME: home, USERPROFILE: home } })
const startInput = (cwd, extra = {}) => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd, session_id: 'test-session', ...extra })
const recordFile = (home, id) => join(home, '.claude', 'section-team', 'modes', `${id}.json`)
const ageFile = (file, days) => {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  utimesSync(file, when, when)
}
// old.json (8 days), fresh.json (1 day) and old.txt (8 days) in an existing folder.
const writeAgedFiles = dir => {
  for (const [name, days] of [['old.json', 8], ['fresh.json', 1], ['old.txt', 8]]) {
    writeFileSync(join(dir, name), '{}')
    ageFile(join(dir, name), days)
  }
}

test('brief starts with the marker and fits the limit', () => {
  const brief = assembleBrief('balanced')
  assert.ok(brief.startsWith('[section-team supervisor]'))
  assert.ok(brief.length < 10000, `brief is ${brief.length} chars`)
})

test('brief: single-area work up to about 600 lines is built by the supervisor and gated; multi-area work wakes builders plus testing', () => {
  const brief = assembleBrief('balanced')
  assert.ok(brief.includes('Single-area task'))
  assert.ok(brief.includes('about 600 lines'))
  assert.ok(brief.includes('build the code yourself'))
  assert.ok(brief.includes('wake only the testing section to write and run the tests'))
  assert.ok(brief.includes('then run the reviewer gate on your own changed files'))
  assert.ok(brief.includes('Multi-area work'))
  assert.ok(brief.includes('plus the testing section'))
  assert.ok(brief.includes('Small task: about 50 lines of new code or less (one or two small functions): build it and its tests yourself, then run the reviewer gate'))
  assert.ok(brief.includes('A feature with its own behaviour to test (a CLI, an endpoint, a module with storage or I/O) is never a small task; input checks that throw do not make a function a feature'))
  assert.ok(!brief.includes('Do not build bigger tasks yourself'))
  assert.ok(brief.includes('Where a spec line can be read two ways, build the stricter reading and say which one you chose.'))
  assert.ok(brief.includes('probe every spec line'))
  assert.ok(brief.includes('Map every OS error your code can hit (a data path that is a directory, a missing parent folder, a file you cannot write, a port in use) by err.code to one friendly line and a non-zero exit'))
  assert.ok(brief.includes('A crash path you notice in your own code is a fix before the gate, never a next step.'))
  assert.ok(brief.includes('A pass ends the gate: do not grade again after a pass.'))
  assert.ok(brief.includes('A REPORT may name a `Suggested skill:`.'))
  assert.ok(brief.includes('List it in your summary and ask the user whether to install it; on yes, install it with the `section-team:add-skill` skill'))
  assert.ok(!brief.includes('so do not ask'))
  assert.ok(!brief.includes("Never install a suggested skill without the user's yes."))
  assert.ok(brief.includes('Give each spec requirement a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples.'))
  assert.ok(brief.includes('After the final review, send a builder only failing items (a spec violation, a crash, a failing grade); list optional findings in your summary as next steps for the user.'))
  assert.ok(brief.includes("Treat every value the spec names as exact (a header value, status code, field, path or format): send exactly that value, never extend it (no `; charset=utf-8` after `application/json`) or normalize it (redirect to the stored URL as given), and add no rule the spec does not state (no extra reserved path, no accepted null)."))
  assert.ok(brief.includes('Its verdict and any optional findings come back to you in its REPORT; only failing fix lists go to the builders. Do not ask it to send builders a verdict or optional notes.'))
})

test('brief: testing and docs do not count toward the 3-builder plan gate', () => {
  const brief = assembleBrief('balanced')
  assert.ok(brief.includes('testing, docs and advisors not counted'))
})

test('the injected brief hands per-job skills, uses notes, gates its own code and describes the board commands', () => {
  const brief = buildContext(repo(), tempHome())
  assert.ok(brief.startsWith('[section-team supervisor]'))
  assert.ok(brief.length < 10000, `brief is ${brief.length} chars`)
  for (const phrase of ['Skills for this job:', 'at most 4', '`.team/notes/`', 'Do not relay anything that belongs in a note.', '`section-team:reviewer`', '`section-team:reviewer` replaces `code-reviewer` for your own code.', PASS_RULE, '/chats', '/team']) {
    assert.ok(brief.includes(phrase), `brief lacks: ${phrase}`)
  }
  assert.ok(!brief.includes('opens automatically'))
  assert.ok(brief.includes("include the asker's agent id so the owner replies to it directly"))
  assert.ok(brief.includes("reply with the note's name"))
  assert.ok(!brief.includes('Sections cannot message each other'))
})

test('with S2 direct the brief tells the supervisor to list the awake agent ids in every job', () => {
  if (!/^S2: direct$/m.test(readFileSync(SPIKES, 'utf8'))) return
  const brief = buildContext(repo(), tempHome())
  assert.ok(brief.includes('the agent ids of the awake builder sections'))
  assert.ok(!brief.includes('the agent ids of the sections that are awake'))
})

test('context names the latest summary and excludes .team/', () => {
  const dir = repo()
  writeReport(dir, 'supervisor-summary', 'x', new Date(2026, 9, 12, 9, 0, 0))
  const context = buildContext(dir, tempHome())
  assert.ok(context.startsWith('[section-team supervisor]'))
  assert.ok(context.includes('\n\nLast team summary for this project: .team/reports/2026-10-12/090000-supervisor-summary.md. Read it before new team work.\n\n'))
  assert.ok(!context.includes(dir))
  assert.ok(readFileSync(excludeFile(dir), 'utf8').includes('.team/'))
})

test('a session in a subfolder names the summary relative to the project root', () => {
  const dir = repo()
  writeReport(dir, 'supervisor-summary', 'x', new Date(2026, 9, 12, 9, 0, 0))
  const sub = join(dir, 'src')
  mkdirSync(sub)
  assert.ok(buildContext(sub, tempHome(), {}).includes('Last team summary for this project: .team/reports/2026-10-12/090000-supervisor-summary.md.'))
})

test('hook prints SessionStart additionalContext', () => {
  const dir = repo()
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith('[section-team supervisor]'))
  assert.equal(out.systemMessage, undefined)
})

const SKIPPED_PREFIX = 'section-team session-start: skipped: '
const NOT_JSON_MESSAGE = `${SKIPPED_PREFIX}the hook input is not JSON, so the team brief was not added`
const NO_CWD_MESSAGE = `${SKIPPED_PREFIX}the hook input has no absolute cwd, so the team brief was not added`
const assertSkipped = (result, message, label = 'hook output') => {
  assert.equal(result.status, 0, label)
  assert.equal(result.stderr, '', label)
  assert.notEqual(result.stdout, '', `${label}: the hook printed nothing`)
  assert.doesNotMatch(result.stdout, /\n/, label)
  assert.deepEqual(JSON.parse(result.stdout), { systemMessage: message }, label)
}

test('hook input that is not JSON: exit 0 and one systemMessage line saying the brief was skipped', () => {
  for (const input of ['', 'not json']) assertSkipped(run(input), NOT_JSON_MESSAGE, JSON.stringify(input))
})

test('hook input with no absolute cwd: exit 0 and one systemMessage line saying the brief was skipped', () => {
  for (const input of ['{}', '{"cwd":"."}', '{"cwd":"rel/dir","session_id":"s"}', '{"session_id":"s"}', '5', '[]']) {
    assertSkipped(run(input), NO_CWD_MESSAGE, input)
  }
})

test('hook input with a relative cwd writes nothing into the hook process folder', () => {
  const folder = tempDir()
  const home = tempHome()
  const result = spawnSync(process.execPath, [SCRIPT], { input: '{"cwd":"."}', encoding: 'utf8', cwd: folder, env: { ...HOOK_ENV, HOME: home, USERPROFILE: home } })
  assertSkipped(result, NO_CWD_MESSAGE)
  assert.deepEqual(readdirSync(folder), [], 'something was written into the hook process folder')
})

const quietStderr = fn => {
  const lines = []
  const original = process.stderr.write
  process.stderr.write = chunk => { lines.push(String(chunk)); return true }
  try {
    return { value: fn(), lines }
  } finally {
    process.stderr.write = original
  }
}
const breakExclude = dir => {
  const file = excludeFile(dir)
  rmSync(file, { force: true })
  mkdirSync(file, { recursive: true })
}
const breakSummaryScan = dir => {
  mkdirSync(join(dir, '.team', 'reports'), { recursive: true })
  writeFileSync(join(dir, '.team', 'reports', '2026-01-01'), 'a file where a day folder should be')
}

test('a failing exclude update still returns the brief, with one line on stderr', () => {
  const dir = repo()
  breakExclude(dir)
  const { value, lines } = quietStderr(() => buildContext(dir, tempHome()))
  assert.ok(value.startsWith(MARKER))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^section-team session-start: [^\n]+\n$/)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('a failing summary scan still returns the brief, with one line on stderr', () => {
  const dir = repo()
  breakSummaryScan(dir)
  const { value, lines } = quietStderr(() => buildContext(dir, tempHome()))
  assert.ok(value.startsWith(MARKER))
  assert.ok(!value.includes('Last team summary'))
  assert.equal(lines.length, 1)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('the hook leaves .team/notes/INDEX.md behind', () => {
  const dir = repo()
  assert.equal(run(startInput(dir)).status, 0)
  assert.ok(readFileSync(join(dir, '.team', 'notes', 'INDEX.md'), 'utf8').startsWith('# Team notes'))
})

test('a notes folder that cannot be created still returns the brief, with one line on stderr', () => {
  const dir = repo()
  mkdirSync(join(dir, '.team'), { recursive: true })
  writeFileSync(join(dir, '.team', 'notes'), 'a file where the notes folder should be')
  const { value, lines } = quietStderr(() => buildContext(dir, tempHome()))
  assert.ok(value.startsWith(MARKER))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^section-team session-start: notes folder failed: [^\n]+\n$/)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('a healthy run writes nothing to stderr', () => {
  const dir = repo()
  assert.equal(run(startInput(dir)).stderr, '')
})

test('a folder outside any git repo gets no .team/ folder, but still gets the brief', () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-nogit-'))), 'plain')
  mkdirSync(dir, { recursive: true })
  assert.equal(excludeFile(dir), null, 'the temp folder is inside a git repo')
  assert.ok(buildContext(dir, tempHome()).startsWith(MARKER))
  assert.equal(existsSync(join(dir, '.team')), false)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(existsSync(join(dir, '.team')), false)
  assert.equal(result.stderr, '')
})

test('session start deletes status files older than 7 days and nothing else', () => {
  const home = tempHome()
  const dir = join(home, '.claude', 'section-team', 'sessions')
  mkdirSync(join(dir, 'old-dir.json'), { recursive: true })
  writeAgedFiles(dir)
  ageFile(join(dir, 'old-dir.json'), 8)
  assert.ok(buildContext(repo(), home).startsWith(MARKER))
  assert.equal(existsSync(join(dir, 'old.json')), false)
  for (const kept of ['fresh.json', 'old.txt', 'old-dir.json']) assert.ok(existsSync(join(dir, kept)), `${kept} was removed`)
  assert.ok(buildContext(repo(), join(home, 'no-such-home')).startsWith(MARKER))
})

test("suggested skills are installed only on the user's yes, unless SECTION_TEAM_AUTO_INSTALL_SKILLS=1 turns on automatic installs", () => {
  const home = tempHome()
  const off = buildContext(repo(), home, {})
  assert.ok(off.includes('ask the user whether to install it'))
  assert.ok(!off.includes('Automatic skill installs are on'))
  assert.ok(off.includes('- Automatic skill installs: off (default).'))
  for (const value of ['0', 'true', ' 1', '01', '']) {
    const ctx = buildContext(repo(), home, { SECTION_TEAM_AUTO_INSTALL_SKILLS: value })
    assert.ok(!ctx.includes('Automatic skill installs are on'), JSON.stringify(value))
    assert.ok(ctx.includes('- Automatic skill installs: off (from SECTION_TEAM_AUTO_INSTALL_SKILLS).'), JSON.stringify(value))
  }
  const on = buildContext(repo(), home, { SECTION_TEAM_AUTO_INSTALL_SKILLS: '1' })
  assert.ok(on.includes('- Automatic skill installs: on (from SECTION_TEAM_AUTO_INSTALL_SKILLS).'))
  assert.ok(on.includes('Automatic skill installs are on (SECTION_TEAM_AUTO_INSTALL_SKILLS=1)'))
  assert.ok(on.includes('without asking when the add-skill safety review finds no red flag'))
  assert.ok(on.includes('List every skill you installed in your summary.'))
  assert.ok(on.length < 10000, `brief is ${on.length} chars`)
})

// --- session modes ---

const ENV_ON = { SECTION_TEAM_AUTO_INSTALL_SKILLS: '1' }
const contextFor = (text, env) => buildContext(text === null ? repo() : withModeFile(repo(), text), tempHome(), env)
const hookOut = result => JSON.parse(result.stdout)

test('a Max mode file at the repo root applies to a session started in a subfolder', () => {
  const dir = withModeFile(repo(), '{"mode":"max"}')
  const sub = join(dir, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  const ctx = buildContext(sub, tempHome(), {})
  assert.ok(ctx.startsWith(`${assembleBrief('max')}\n\n`))
  assert.ok(ctx.includes('overall at least 9'))
  assert.ok(ctx.includes('## Mode\n- This project runs in Max mode (from .team/mode.json).'))
})

test('without a mode file the context is the v0.1.1 brief plus a Balanced mode section', () => {
  assert.equal(
    buildContext(repo(), tempHome(), {}),
    `${FIXTURE}\n\n## Mode\n- This project runs in Balanced mode (default).\n- Automatic skill installs: off (default).\n- ${UNGRADED_LINE}`,
  )
})

test('a Lean mode file gives the Lean brief and says where the mode came from', () => {
  const ctx = contextFor('{"mode":"lean"}', {})
  assert.ok(ctx.startsWith(`${assembleBrief('lean')}\n\n`))
  assert.ok(ctx.includes('- This project runs in Lean mode (from .team/mode.json).'))
  // Balanced is the default mode, so an explicit {"mode":"balanced"} reads the same as no file.
  assert.ok(contextFor('{"mode":"balanced"}', {}).includes('- This project runs in Balanced mode (default).'))
})

test('the skill setting: the mode file wins, then SECTION_TEAM_AUTO_INSTALL_SKILLS, then off', () => {
  const fileOff = contextFor('{"mode":"max","autoInstallSkills":false}', ENV_ON)
  assert.ok(!fileOff.includes('Automatic skill installs are on'))
  assert.ok(fileOff.includes('- Automatic skill installs: off (from .team/mode.json).'))
  const envOn = contextFor(null, ENV_ON)
  assert.ok(envOn.includes('- Automatic skill installs: on (from SECTION_TEAM_AUTO_INSTALL_SKILLS).'))
  assert.ok(envOn.includes('Automatic skill installs are on (SECTION_TEAM_AUTO_INSTALL_SKILLS=1)'))
  const fileOn = contextFor('{"autoInstallSkills":true}', {})
  assert.ok(fileOn.includes('Automatic skill installs are on (.team/mode.json), which replaces asking first'))
  assert.ok(fileOn.includes('- Automatic skill installs: on (from .team/mode.json).'))
  assert.ok(fileOn.includes('- This project runs in Balanced mode (default).'))
  assert.ok(contextFor('{"mode":"lean"}', ENV_ON).includes('- Automatic skill installs: on (from SECTION_TEAM_AUTO_INSTALL_SKILLS).'))
  assert.ok(contextFor(null, {}).includes('- Automatic skill installs: off (default).'))
  const fileOffEnvOn = contextFor('{"autoInstallSkills":false}', ENV_ON)
  assert.ok(fileOffEnvOn.includes('- Automatic skill installs: off (from .team/mode.json).'))
  assert.ok(!fileOffEnvOn.includes('Automatic skill installs are on'))
  const fileOnEnvOff = contextFor('{"autoInstallSkills":true}', { SECTION_TEAM_AUTO_INSTALL_SKILLS: '0' })
  assert.ok(fileOnEnvOff.includes('- Automatic skill installs: on (from .team/mode.json).'))
  assert.ok(fileOnEnvOff.includes('Automatic skill installs are on (.team/mode.json)'))
})

for (const [text, problem] of [
  ['{"mode":"turbo"}', '.team/mode.json: unknown mode "turbo", so Balanced is used'],
  ['{"mode":', '.team/mode.json: not valid JSON, so Balanced is used'],
]) {
  test(`a bad mode file (${text}) runs Balanced and names its problem once, last`, () => {
    const ctx = contextFor(text, {})
    assert.ok(ctx.startsWith(`${assembleBrief('balanced')}\n\n`))
    assert.ok(ctx.includes('- This project runs in Balanced mode (default).'))
    assert.equal(ctx.split(problem).length, 2, 'the problem line must appear exactly once')
    assert.ok(ctx.endsWith(`\n- ${problem}.`))
  })
}

test('an invalid autoInstallSkills is ignored with one problem line, and the environment decides', () => {
  const problem = '.team/mode.json: autoInstallSkills must be true or false, so it is ignored'
  const ctx = contextFor('{"mode":"max","autoInstallSkills":"yes"}', ENV_ON)
  assert.ok(ctx.startsWith(assembleBrief('max')))
  assert.equal(ctx.split(problem).length, 2, 'the problem line must appear exactly once')
  assert.ok(ctx.includes('- Automatic skill installs: on (from SECTION_TEAM_AUTO_INSTALL_SKILLS).'))
})

test('the mode is recorded per session, only when the hook knows the session id', () => {
  const h = tempHome()
  buildContext(withModeFile(repo(), '{"mode":"max"}'), h, {}, 'sess-1')
  assert.equal(readFileSync(recordFile(h, 'sess-1'), 'utf8'), '{"mode":"max"}')
  const h2 = tempHome()
  buildContext(repo(), h2, {})
  assert.equal(existsSync(join(h2, '.claude', 'section-team', 'modes')), false)
  recordMode(h, 's2', 'lean')
  assert.equal(readFileSync(recordFile(h, 's2'), 'utf8'), '{"mode":"lean"}')
  recordMode(h, 's2', 'max')
  assert.equal(readFileSync(recordFile(h, 's2'), 'utf8'), '{"mode":"max"}')
})

test('session start deletes mode records older than 7 days and nothing else', () => {
  const h = tempHome()
  const dir = join(h, '.claude', 'section-team', 'modes')
  mkdirSync(dir, { recursive: true })
  writeAgedFiles(dir)
  buildContext(repo(), h, {}, 'sess-3')
  assert.equal(existsSync(join(dir, 'old.json')), false)
  for (const kept of ['fresh.json', 'old.txt', 'sess-3.json']) assert.ok(existsSync(join(dir, kept)), `${kept} was removed`)
})

test('hook: a healthy run records the Balanced mode and prints no systemMessage', () => {
  const h = tempHome()
  const result = run(startInput(repo()), h)
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(hookOut(result).systemMessage, undefined)
  assert.equal(readFileSync(recordFile(h, 'test-session'), 'utf8'), '{"mode":"balanced"}')
})

test('hook: a failing exclude update shows up as a systemMessage and the brief still arrives', () => {
  const dir = repo()
  breakExclude(dir)
  const out = hookOut(run(startInput(dir)))
  assert.match(out.systemMessage, /^section-team session-start: git exclude update failed: [^\n]+$/)
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.ok(out.hookSpecificOutput.additionalContext.includes('\n## Mode\n'))
})

test('hook: a blocked mode record folder gives one systemMessage line and still returns the brief', () => {
  const h = tempHome()
  mkdirSync(join(h, '.claude', 'section-team'), { recursive: true })
  writeFileSync(join(h, '.claude', 'section-team', 'modes'), 'a file where the folder should be')
  const result = run(startInput(repo()), h)
  assert.equal(result.status, 0)
  const out = hookOut(result)
  assert.ok(!out.systemMessage.includes('\n'))
  assert.ok(out.systemMessage.startsWith('section-team session-start: '))
  assert.ok(out.systemMessage.includes('mode record prune failed: '))
  assert.ok(out.systemMessage.includes('; mode record failed: '))
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(MARKER))
})

test('hook: a bad mode file puts its problem line in the systemMessage', () => {
  const out = hookOut(run(startInput(withModeFile(repo(), '{"mode":"turbo"}'))))
  assert.equal(out.systemMessage, 'section-team session-start: .team/mode.json: unknown mode "turbo", so Balanced is used')
})

test('hook: the mode problem comes first in the systemMessage, side effects name only their error code, and stderr gets only the side effect', () => {
  const dir = withModeFile(repo(), '{"mode":"turbo"}')
  breakExclude(dir)
  const result = run(startInput(dir))
  assert.match(hookOut(result).systemMessage, /^section-team session-start: \.team\/mode\.json: unknown mode "turbo", so Balanced is used; git exclude update failed: E[A-Z]+$/)
  assert.match(result.stderr, /^section-team session-start: git exclude update failed: [^\n]+\n$/)
})

test('hook: input without a session id warns that the mode record failed, and still returns the brief', () => {
  const out = hookOut(run(startInput(repo(), { session_id: undefined })))
  assert.match(out.systemMessage, /^section-team session-start: mode record failed: [^\n]*session id[^\n]*$/)
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(MARKER))
})

test('hook: an error outside the side effects (no brief files) gives one systemMessage line and exits 0', () => {
  // A copy of the hooks folder with no brief/ folder next to it, so assembling the brief fails.
  const plugin = realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-nobrief-')))
  try {
    cpSync(fileURLToPath(new URL('../hooks', import.meta.url)), join(plugin, 'hooks'), { recursive: true })
    const home = tempHome()
    const result = spawnSync(process.execPath, [join(plugin, 'hooks', 'session-start.mjs')], { input: startInput(repo()), encoding: 'utf8', env: { ...HOOK_ENV, HOME: home, USERPROFILE: home } })
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    assert.doesNotMatch(result.stdout, /\n/)
    assert.deepEqual(JSON.parse(result.stdout), { systemMessage: 'section-team session-start: brief part core.md could not be read (ENOENT)' })
  } finally {
    rmSync(plugin, { recursive: true, force: true })
  }
})

test('composeContext builds the same text as buildContext, and puts the summary before the Mode section', () => {
  const dir = withModeFile(repo(), '{"mode":"lean","autoInstallSkills":true}')
  assert.equal(buildContext(dir, tempHome(), {}), composeContext(readMode(dir), {}, null))
  const withSummary = composeContext({ mode: 'max', autoInstallSkills: null, problem: null }, {}, 'S')
  assert.ok(withSummary.includes('\n\nLast team summary for this project: S. Read it before new team work.\n\n## Mode\n'))
})

for (const mode of MODES) {
  test(`${mode}: the Mode section tells the supervisor to grade an ungraded REPORT`, () => {
    const bullet = `- ${UNGRADED_LINE}`
    const ctx = contextFor(`{"mode":"${mode}"}`, {})
    const lines = ctx.split('\n')
    assert.equal(lines.filter(line => line === bullet).length, 1, 'the ungraded bullet must be one whole line')
    const at = lines.indexOf(bullet)
    assert.ok(lines.indexOf('## Mode') >= 0 && at > lines.indexOf('## Mode'), 'the bullet belongs under ## Mode')
    assert.ok(lines[at - 1]?.startsWith('- Automatic skill installs: '), `the line before it is: ${lines[at - 1]}`)
    assert.equal(ctx.split(UNGRADED_LINE).length, 2, 'the ungraded text must appear exactly once')
    const withProblem = contextFor(`{"mode":"${mode}","autoInstallSkills":"yes"}`, {})
    assert.ok(withProblem.endsWith('\n- .team/mode.json: autoInstallSkills must be true or false, so it is ignored.'))
    assert.ok(withProblem.includes(`\n${bullet}\n- .team/mode.json:`))
  })
}

for (const mode of MODES) {
  test(`${mode}: the worst-case session context stays within 10,000 characters`, () => {
    const { problem } = parseModeFile('{"mode":"abcdefghijklmnopqrst","autoInstallSkills":"yes"}')
    assert.ok(problem.length >= 130, `the longest problem line is only ${problem.length} characters`)
    // The longest relative path latestSummary can give: the latest time of day and the highest same-second suffix.
    const summary = '.team/reports/2026-10-12/235959-supervisor-summary-999.md'
    assert.equal(summary.length, 57)
    const ctx = composeContext({ mode, autoInstallSkills: null, problem }, ENV_ON, summary)
    for (const part of ['Automatic skill installs are on', summary, '## Mode', problem, UNGRADED_LINE]) assert.ok(ctx.includes(part), `lacks: ${part}`)
    assert.ok(ctx.length <= 10000, `${mode}: ${ctx.length} characters`)
  })
}
