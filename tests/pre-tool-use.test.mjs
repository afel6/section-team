import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decide, gateReasons } from '../hooks/pre-tool-use.mjs'
import { GATES, MODES } from '../hooks/lib/mode.mjs'
import { projectRoot } from '../hooks/lib/paths.mjs'

// The tests pick the project through each event's cwd or an explicit env; this also keeps spawned hooks off the session's project.
delete process.env.CLAUDE_PROJECT_DIR

const SCRIPT = fileURLToPath(new URL('../hooks/pre-tool-use.mjs', import.meta.url))
// Absolute on every OS: C:UsersTester style on Windows, /Users/Tester on Linux and macOS.
const HOME = resolve('/', 'Users', 'Tester')
const PROJECT = resolve('/', 'work', 'my app')
const LOCAL = join(PROJECT, '.claude', 'agent-memory-local')
const ev = (agent_type, tool_name, tool_input = {}) => ({ agent_type, tool_name, tool_input, cwd: PROJECT })

test('builders and the main session are never blocked', () => {
  assert.equal(decide(ev('section-team:backend', 'Bash', { command: 'rm -rf x' })), null)
  assert.equal(decide(ev(undefined, 'Write', { file_path: 'a.txt' })), null)
})

test('advisors cannot use shell or notebook tools', () => {
  for (const tool of ['Bash', 'PowerShell', 'NotebookEdit']) assert.match(decide(ev('section-team:ai-engineer', tool)), /read-only/)
})

test('advisors may write only inside their own memory folder in the project', () => {
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(LOCAL, 'section-team-ai-engineer', 'x.md') })), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Edit', { file_path: join(LOCAL, 'ai-engineer', 'MEMORY.md') })), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'section-team-ai-engineer', 'x.md') })), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'ai-engineer', 'MEMORY.md') })), /memory folder/)
  assert.match(decide(ev('section-team:data-scientist', 'Edit', { file_path: `${LOCAL}/../settings.json` })), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(PROJECT, 'src', 'a.ts') })), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(LOCAL, 'section-team-data-scientist', 'x.md') })), /memory folder/)
  assert.match(decide(ev('section-team:data-scientist', 'Write', {})), /memory folder/)
})

test('advisors may only spawn read-only helper types', () => {
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'code-explorer', run_in_background: false })), null)
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'planner', run_in_background: false })), null)
  assert.match(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'Explore' })), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'Plan' })), /read-only helpers/)
  assert.equal(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'architect', run_in_background: false })), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'section-team:scout', run_in_background: false })), null)
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'section-team:scout', run_in_background: false })), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'section-team:coder' })), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'general-purpose' })), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', {})), /read-only helpers/)
})

test('hook prints a deny decision, and stays silent otherwise', () => {
  const deny = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'PreToolUse', ...ev('section-team:ai-engineer', 'Bash', { command: 'ls' }) }), encoding: 'utf8' })
  assert.equal(deny.status, 0)
  const out = JSON.parse(deny.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  const quiet = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(ev('section-team:backend', 'Bash')), encoding: 'utf8' })
  assert.equal(quiet.status, 0)
  assert.equal(quiet.stdout, '')
})

test('guard still runs when the script is reached through a junction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-junction-'))
  const link = join(dir, 'hooks-link')
  symlinkSync(fileURLToPath(new URL('../hooks', import.meta.url)), link, 'junction')
  try {
    const run = spawnSync(process.execPath, [join(link, 'pre-tool-use.mjs')], { input: JSON.stringify(ev('section-team:ai-engineer', 'Bash', { command: 'ls' })), encoding: 'utf8' })
    assert.equal(run.status, 0)
    assert.match(run.stdout, /"permissionDecision":"deny"/)
  } finally {
    // a junction is a directory on Windows; elsewhere the same call made a symlink, which unlink removes
    if (process.platform === 'win32') rmdirSync(link)
    else unlinkSync(link)
    rmdirSync(dir)
  }
})

test('bare-named agents are not advisors; only section-team: prefixed types are guarded', () => {
  assert.equal(decide(ev('ai-engineer', 'Bash')), null)
  assert.equal(decide(ev('data-scientist', 'Write', { file_path: join(PROJECT, 'src', 'a.ts') })), null)
})

test('memory folder must be exactly <id> or section-team-<id>', () => {
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(LOCAL, 'ai-engineer', 'x.md') })), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(LOCAL, 'section-team-ai-engineer', 'x.md') })), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(LOCAL, 'foo-ai-engineer', 'x.md') })), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(LOCAL, 'xai-engineer', 'x.md') })), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: `${LOCAL}/ai-engineer/../backend/x.md` })), /memory folder/)
})

const handback = (agent_type, report) => ev(agent_type, 'SubagentHandback', { message: `work notes\n${report}` })
const REPORT_WITH = (status, changed, quality) => `## REPORT · backend · 2026-10-25 10:00\nStatus: ${status}\nJob: api\nChanged: ${changed}\n${quality ? `Quality: ${quality}\n` : ''}`

const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })
const tempDir = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-gate-')))
  made.push(dir)
  return dir
}
// A temp project with a .team folder, holding .team/mode.json when modeText is not null.
const projectWith = modeText => {
  const dir = tempDir()
  mkdirSync(join(dir, '.team'))
  if (modeText !== null) writeFileSync(join(dir, '.team', 'mode.json'), modeText)
  return dir
}
const handbackIn = (dir, report) => ({ ...handback('section-team:backend', report), cwd: dir })
const DONE_AT = quality => REPORT_WITH('done', 'src/api.mjs', quality)
const UNGRADED_DONE = REPORT_WITH('done', 'src/api.mjs', null)
const UNGRADED_WAY_OUT = 'If the gate truly cannot run, hand back with `Status: ungraded` and say why.'
const PARTIAL_ENDING = 'If it still fails, hand back with `Status: partial` and the grade; start the Quality line with the final grade.'
const NOT_OBJECT = { systemMessage: 'section-team pre-tool-use: the hook input is not a JSON object, so no rule was checked' }
const spawnHook = input => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })

test('the memory folder is at the project root: a session in a subfolder, CLAUDE_PROJECT_DIR, and no project at all', () => {
  const root = tempDir()
  execFileSync('git', ['-C', root, 'init', '-q'])
  const sub = join(root, 'src')
  mkdirSync(sub)
  const write = (file_path, extra) => ({ ...ev('section-team:ai-engineer', 'Write', { file_path }), ...extra })
  const memoryIn = (base, id = 'section-team-ai-engineer') => join(base, '.claude', 'agent-memory-local', id, 'x.md')
  assert.equal(decide(write(memoryIn(root), { cwd: sub }), {}), null)
  assert.match(decide(write(memoryIn(sub), { cwd: sub }), {}), /memory folder/)
  const other = tempDir()
  assert.equal(decide(write(memoryIn(other, 'ai-engineer'), { cwd: PROJECT }), { CLAUDE_PROJECT_DIR: other }), null)
  assert.match(decide(write(join(LOCAL, 'ai-engineer', 'x.md'), { cwd: PROJECT }), { CLAUDE_PROJECT_DIR: other }), /memory folder/)
  assert.match(decide(write(join(LOCAL, 'ai-engineer', 'x.md'), { cwd: undefined }), {}), /memory folder/)
  // An empty cwd is no project either; it must not fall back to the hook process's own folder.
  assert.match(decide(write(join(projectRoot(process.cwd()), '.claude', 'agent-memory-local', 'ai-engineer', 'x.md'), { cwd: '' }), {}), /memory folder/)
})

test('a builder cannot hand back changed code without a reviewer grade', () => {
  for (const reason of [
    decide(handback('section-team:backend', REPORT_WITH('done', 'src/api.mjs', 'n/a (no code)'))),
    decide(handback('section-team:testing', REPORT_WITH('done', 'test/api.test.mjs', null))),
  ]) {
    assert.match(reason, /no reviewer grade/)
    assert.match(reason, /run_in_background: false/)
    assert.doesNotMatch(reason, /under the pass mark/)
  }
})

test('a builder cannot hand back a failing grade as done', () => {
  const reason = decide(handback('section-team:frontend', REPORT_WITH('done', 'public/app.js', '7/10 (reviewer, 1 fix round)')))
  assert.match(reason, /under the pass mark/)
  assert.match(reason, /Never SendMessage the earlier reviewer/)
  assert.match(reason, /start the Quality line with the final grade/)
  assert.doesNotMatch(reason, /no reviewer grade/)
  assert.equal(decide(handback('section-team:frontend', REPORT_WITH('partial', 'public/app.js', '7/10 (reviewer, 2 fix rounds)'))), null)
  assert.equal(decide(handback('section-team:ai-engineer', REPORT_WITH('done', 'src/a.mjs', '7/10 (reviewer)'))), null)
})

test('the handback gate lets graded, partial, blocked, docs-only, advisor and report-less handbacks through', () => {
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('done', 'src/api.mjs', '8.5/10 (reviewer, 1 fix rounds)'))), null)
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('partial', 'src/api.mjs', 'not graded: reviewer unavailable'))), null)
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('blocked', 'src/api.mjs', null))), null)
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('ungraded — no Agent tool', 'src/api.mjs', null))), null)
  assert.equal(decide(handback('section-team:docs', REPORT_WITH('done', 'README.md', 'n/a (no code)'))), null)
  assert.equal(decide(handback('section-team:ai-engineer', REPORT_WITH('done', 'src/api.mjs', null))), null)
  assert.equal(decide(ev('section-team:backend', 'SubagentHandback', { message: 'no report here' })), null)
  assert.equal(decide(ev(undefined, 'SubagentHandback', { message: REPORT_WITH('done', 'src/api.mjs', null) })), null)
})

test('a section may not start a helper in the background on purpose, and an Agent tool without that option is never blocked', () => {
  for (const who of ['section-team:testing', 'section-team:backend', 'section-team:ai-engineer']) {
    const helper = who === 'section-team:ai-engineer' ? 'section-team:scout' : 'section-team:coder'
    // the desktop app's Agent tool has no run_in_background option and strips it, so an absent flag must pass
    assert.equal(decide(ev(who, 'Agent', { subagent_type: helper })), null)
    assert.equal(decide(ev(who, 'Agent', { subagent_type: helper, run_in_background: false })), null)
    assert.match(decide(ev(who, 'Agent', { subagent_type: helper, run_in_background: true })), /run helpers in the foreground/)
  }
  assert.equal(decide(ev('section-team:frontend', 'Agent', { subagent_type: 'react-reviewer', model: 'sonnet' })), null)
  assert.equal(decide(ev(undefined, 'Agent', { subagent_type: 'section-team:backend', run_in_background: true })), null)
  for (const helper of ['section-team:coder', 'section-team:reviewer', 'section-team:scout']) assert.equal(decide(ev(helper, 'Agent', { subagent_type: 'Explore', run_in_background: true })), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'section-team:coder' })), /read-only helpers/)
})

test('in a Max project a done 8/10 handback is refused with 9/10 and 3 fix rounds; Balanced and no mode file let it through', () => {
  const max = projectWith('{"mode":"max"}')
  const reason = decide(handbackIn(max, DONE_AT('8/10 (reviewer, 1 fix round)')), {})
  assert.match(reason, /under the pass mark \(9\/10\)/)
  assert.ok(reason.includes('at most 3 fix rounds'), reason)
  assert.equal(decide(handbackIn(max, DONE_AT('9/10 (reviewer, 1 fix round)')), {}), null)
  assert.equal(decide(handbackIn(projectWith('{"mode":"balanced"}'), DONE_AT('8/10 (reviewer, 1 fix round)')), {}), null)
  assert.equal(decide(handbackIn(projectWith(null), DONE_AT('8/10 (reviewer, 1 fix round)')), {}), null)
})

test('CLAUDE_PROJECT_DIR picks the project; no project dir means Balanced', () => {
  const balanced = projectWith('{"mode":"balanced"}')
  const max = projectWith('{"mode":"max"}')
  const viaEnv = decide(handbackIn(balanced, DONE_AT('8/10 (reviewer)')), { CLAUDE_PROJECT_DIR: max })
  assert.ok(viaEnv.includes('(9/10)'), viaEnv)
  const nowhere = quality => ({ ...handback('section-team:backend', DONE_AT(quality)), cwd: undefined })
  assert.equal(decide(nowhere('8/10 (reviewer)'), {}), null)
  const failing = decide(nowhere('7/10 (reviewer)'), {})
  assert.ok(failing.includes('(8/10)'), failing)
  assert.ok(failing.includes('at most 2 fix rounds'), failing)
})

test('the ungraded reason follows the mode', () => {
  const ungradedIn = mode => decide(handbackIn(projectWith(`{"mode":"${mode}"}`), UNGRADED_DONE), {})
  const lean = ungradedIn('lean')
  assert.match(lean, /no reviewer grade/)
  assert.ok(lean.includes('Pass: overall at least 8.'), lean)
  assert.ok(lean.includes('model: "sonnet"'), lean)
  assert.ok(lean.includes('at most 1 fix round'), lean)
  assert.ok(!lean.includes('at most 1 fix rounds'), lean)
  assert.ok(!lean.includes('do not pass `model`'), lean)
  const balanced = ungradedIn('balanced')
  assert.match(balanced, /no reviewer grade/)
  assert.ok(balanced.includes('Pass: overall at least 8 and no item under 6.'), balanced)
  assert.ok(balanced.includes('do not pass `model`'), balanced)
  assert.doesNotMatch(balanced, /sonnet/)
  assert.ok(balanced.includes('at most 2 fix rounds'), balanced)
  const max = ungradedIn('max')
  assert.match(max, /no reviewer grade/)
  assert.ok(max.includes('Pass: overall at least 9 and no item under 7.'), max)
  assert.ok(max.includes('do not pass `model`'), max)
  assert.doesNotMatch(max, /sonnet/)
  assert.ok(max.includes('at most 3 fix rounds'), max)
})

test('every gate reason offers Status: ungraded; the failing reason keeps its partial ending', () => {
  for (const mode of MODES) {
    const { ungraded, failing } = gateReasons(GATES[mode])
    assert.ok(ungraded.includes(UNGRADED_WAY_OUT), `${mode}: ${ungraded}`)
    assert.ok(failing.includes(UNGRADED_WAY_OUT), `${mode}: ${failing}`)
    assert.doesNotMatch(ungraded, /`Status: partial`/)
    assert.ok(failing.endsWith(PARTIAL_ENDING), `${mode}: ${failing}`)
    assert.ok(failing.includes(`(${GATES[mode].passOverall}/10)`), `${mode}: ${failing}`)
    assert.match(failing, /in all/)
  }
  const reason = decide(handbackIn(projectWith('{"mode":"lean"}'), DONE_AT('7/10 (reviewer)')), {})
  assert.ok(reason.includes('model: "sonnet"'), reason)
  assert.ok(reason.includes('at most 1 fix round in all'), reason)
})

test('a bad mode file gives Balanced thresholds without throwing', () => {
  const teamIsFile = tempDir()
  writeFileSync(join(teamIsFile, '.team'), 'not a folder')
  const gateIn = (dir, quality) => {
    let reason
    assert.doesNotThrow(() => { reason = decide(handbackIn(dir, DONE_AT(quality)), {}) })
    return reason
  }
  for (const dir of ['{not json', '{"mode":"turbo"}', '[1]', ''].map(text => projectWith(text)).concat(teamIsFile)) {
    assert.equal(gateIn(dir, '8/10 (reviewer)'), null)
    const failing = gateIn(dir, '7/10 (reviewer)')
    assert.ok(failing.includes('(8/10)'), failing)
    assert.ok(failing.includes('at most 2 fix rounds'), failing)
  }
})

test('a hook input that is not a JSON object gives one systemMessage line and denies nothing', () => {
  for (const input of ['', 'not json', 'null', '5', '"text"', '[]', '[1]']) {
    const run = spawnHook(input)
    assert.equal(run.status, 0, input)
    assert.equal(run.stderr, '', input)
    assert.doesNotMatch(run.stdout, /\n/)
    assert.deepEqual(JSON.parse(run.stdout), NOT_OBJECT)
  }
})

test('a rule that throws gives one systemMessage line and denies nothing', () => {
  // Reading tool_input throws inside the advisor rule (a getter planted by --import); any rule that throws would do.
  const PLANT = "data:text/javascript,Object.defineProperty(Object.prototype,'tool_input',{get(){throw Object.assign(new Error('planted'),{code:'EPLANTED'})}})"
  const run = spawnSync(process.execPath, ['--import', PLANT, SCRIPT], { input: '{"agent_type":"section-team:ai-engineer","tool_name":"Write","cwd":"x"}', encoding: 'utf8' })
  assert.equal(run.status, 0)
  assert.equal(run.stderr, '')
  assert.deepEqual(JSON.parse(run.stdout), { systemMessage: 'section-team pre-tool-use: no rule was checked: EPLANTED' })
  // A numeric cwd is ignored now, so it no longer throws: the write is denied as outside the memory folder.
  const numeric = spawnHook('{"agent_type":"section-team:ai-engineer","tool_name":"Write","tool_input":{"file_path":"x.md"},"cwd":5}')
  assert.equal(numeric.status, 0)
  const out = JSON.parse(numeric.stdout)
  assert.equal(out.hookSpecificOutput?.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput?.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput?.permissionDecisionReason, /memory folder/)
})

test("the spawned hook reads the event project's mode", () => {
  const max = projectWith('{"mode":"max"}')
  const out = JSON.parse(spawnHook(JSON.stringify(handbackIn(max, DONE_AT('8/10 (reviewer, 1 fix round)')))).stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('(9/10)'), out.hookSpecificOutput.permissionDecisionReason)
})
