import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, posix, resolve, win32 } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decide, ensureGuard, ensureScratch, gateReasons, isInMemory } from '../hooks/pre-tool-use.mjs'
import { GATES, MODES } from '../hooks/lib/mode.mjs'
import { recordMode } from '../hooks/lib/mode-record.mjs'

// The tests pick the project through each event's cwd or an explicit env; this also keeps spawned hooks off the session's project.
delete process.env.CLAUDE_PROJECT_DIR

const SCRIPT = fileURLToPath(new URL('../hooks/pre-tool-use.mjs', import.meta.url))
// Absolute on every OS: C:UsersTester style on Windows, /Users/Tester on Linux and macOS.
const HOME = resolve('/', 'Users', 'Tester')
const PROJECT = resolve('/', 'work', 'my app')
const LOCAL = join(PROJECT, '.claude', 'agent-memory-local')
const ev = (agent_type, tool_name, tool_input = {}) => ({ agent_type, tool_name, tool_input, cwd: PROJECT })

const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })
const tempDir = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-gate-')))
  made.push(dir)
  return dir
}
// Spawned hooks get a fresh temp home, so no real session record of the machine can decide a gate.
const hookEnv = home => ({ ...process.env, HOME: home, USERPROFILE: home })
const spawnHook = (input, home = tempDir()) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env: hookEnv(home) })

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

test('plan-advisor is read-only: Bash refused, Write only inside its memory folder', () => {
  assert.match(decide(ev('section-team:plan-advisor', 'Bash')), /read-only/)
  assert.equal(decide(ev('section-team:plan-advisor', 'Write', { file_path: join(LOCAL, 'section-team-plan-advisor', 'x.md') })), null)
  assert.match(decide(ev('section-team:plan-advisor', 'Write', { file_path: join(PROJECT, '.team', 'notes', 'foundation.md') })), /memory folder/)
  assert.match(decide(ev('section-team:plan-advisor', 'Write', { file_path: join(LOCAL, 'section-team-ai-engineer', 'x.md') })), /memory folder/)
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
  const deny = spawnHook(JSON.stringify({ hook_event_name: 'PreToolUse', ...ev('section-team:ai-engineer', 'Bash', { command: 'ls' }) }))
  assert.equal(deny.status, 0)
  const out = JSON.parse(deny.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  // A builder's call makes its scratch folder under the event's cwd, so that cwd is a temp folder here.
  const quiet = spawnHook(JSON.stringify({ ...ev('section-team:backend', 'Bash'), cwd: tempDir() }))
  assert.equal(quiet.status, 0)
  assert.equal(quiet.stdout, '')
})

test('guard still runs when the script is reached through a junction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-junction-'))
  const link = join(dir, 'hooks-link')
  symlinkSync(fileURLToPath(new URL('../hooks', import.meta.url)), link, 'junction')
  try {
    const run = spawnSync(process.execPath, [join(link, 'pre-tool-use.mjs')], { input: JSON.stringify(ev('section-team:ai-engineer', 'Bash', { command: 'ls' })), encoding: 'utf8', env: hookEnv(tempDir()) })
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

const write = (file_path, extra) => ({ ...ev('section-team:ai-engineer', 'Write', { file_path }), ...extra })
const memoryIn = (base, id = 'section-team-ai-engineer') => join(base, '.claude', 'agent-memory-local', id, 'x.md')

test('the memory folder is under the session cwd or CLAUDE_PROJECT_DIR, never the git main root', () => {
  const root = tempDir()
  execFileSync('git', ['-C', root, 'init', '-q'])
  const sub = join(root, 'src')
  mkdirSync(sub)
  // the git root alone no longer counts
  assert.equal(decide(write(memoryIn(sub), { cwd: sub }), {}), null)
  assert.match(decide(write(memoryIn(root), { cwd: sub }), {}), /memory folder/)
  // either root works
  assert.equal(decide(write(memoryIn(root), { cwd: sub }), { CLAUDE_PROJECT_DIR: root }), null)
  assert.equal(decide(write(memoryIn(sub), { cwd: sub }), { CLAUDE_PROJECT_DIR: root }), null)
  const other = tempDir()
  const third = tempDir()
  assert.equal(decide(write(memoryIn(other, 'ai-engineer'), { cwd: PROJECT }), { CLAUDE_PROJECT_DIR: other }), null)
  assert.equal(decide(write(join(LOCAL, 'ai-engineer', 'x.md'), { cwd: PROJECT }), { CLAUDE_PROJECT_DIR: other }), null)
  assert.match(decide(write(memoryIn(third, 'ai-engineer'), { cwd: PROJECT }), { CLAUDE_PROJECT_DIR: other }), /memory folder/)
  assert.match(decide(write(join(LOCAL, 'ai-engineer', 'x.md'), { cwd: undefined }), {}), /memory folder/)
  // a bad cwd is no root, but it does not knock out the project-dir root
  assert.equal(decide(write(memoryIn(other, 'ai-engineer'), { cwd: undefined }), { CLAUDE_PROJECT_DIR: other }), null)
  assert.equal(decide(write(memoryIn(other, 'ai-engineer'), { cwd: '' }), { CLAUDE_PROJECT_DIR: other }), null)
  // An empty cwd is no project either; it must not fall back to the hook process's own folder.
  assert.match(decide(write(join(process.cwd(), '.claude', 'agent-memory-local', 'ai-engineer', 'x.md'), { cwd: '' }), {}), /memory folder/)
})

test('an advisor in a git worktree keeps its memory under the worktree, not the main repo', () => {
  const main = tempDir()
  execFileSync('git', ['-C', main, 'init', '-q'])
  execFileSync('git', ['-C', main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  const wt = join(tempDir(), 'wt')
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt])
  assert.equal(decide(write(memoryIn(wt), { cwd: wt }), {}), null)
  // neither the cwd nor CLAUDE_PROJECT_DIR is the main root
  assert.match(decide(write(memoryIn(main), { cwd: wt }), {}), /memory folder/)
  const deep = join(wt, 'src')
  mkdirSync(deep)
  assert.equal(decide(write(memoryIn(wt), { cwd: deep }), { CLAUDE_PROJECT_DIR: wt }), null)
  assert.match(decide(write(memoryIn(main), { cwd: deep }), { CLAUDE_PROJECT_DIR: wt }), /memory folder/)
  // the existing refusals still hold from the worktree
  assert.match(decide(write(join(wt, '.claude', 'agent-memory-local') + '/../settings.json', { cwd: wt }), {}), /memory folder/)
  assert.match(decide(write(memoryIn(wt, 'section-team-data-scientist'), { cwd: wt }), {}), /memory folder/)
  assert.match(decide(write(join(HOME, '.claude', 'agent-memory', 'section-team-ai-engineer', 'x.md'), { cwd: wt }), {}), /memory folder/)
})

test('isInMemory splits on the platform separator: a backslash is part of a POSIX file name', () => {
  assert.equal(isInMemory('/p/.claude/agent-memory-local/ai-engineer/x.md', 'ai-engineer', '/p', posix), true)
  // one backslash in the string: on POSIX that write lands as a sibling file in agent-memory-local/
  assert.equal(isInMemory('/p/.claude/agent-memory-local/ai-engineer\\x', 'ai-engineer', '/p', posix), false)
  assert.equal(isInMemory('/p/.claude/agent-memory-local/section-team-ai-engineer/notes/x.md', 'ai-engineer', '/p', posix), true)
  // win32 resolve turns / into \
  assert.equal(isInMemory('C:\\p\\.claude\\agent-memory-local\\ai-engineer/x.md', 'ai-engineer', 'C:\\p', win32), true)
  assert.equal(isInMemory('C:\\p\\.claude\\agent-memory-local\\ai-engineer\\x.md', 'ai-engineer', 'C:\\p', win32), true)
})

test('the memory folder needs a file inside it, a separator after its name, and an absolute root', () => {
  // one segment is a file where the folder belongs
  assert.match(decide(write(join(LOCAL, 'ai-engineer'), { cwd: PROJECT }), {}), /memory folder/)
  assert.match(decide(write(join(LOCAL, 'section-team-ai-engineer'), { cwd: PROJECT }), {}), /memory folder/)
  // a sibling without a separator
  assert.match(decide(write(join(PROJECT, '.claude', 'agent-memory-localai-engineer', 'x.md'), { cwd: PROJECT }), {}), /memory folder/)
  // control: a file inside the folder
  assert.equal(decide(write(join(LOCAL, 'ai-engineer', 'x.md'), { cwd: PROJECT }), {}), null)
  // a relative root is no root
  const inHookFolder = join(process.cwd(), '.claude', 'agent-memory-local', 'ai-engineer', 'x.md')
  assert.match(decide(write(inHookFolder, { cwd: '.' }), {}), /memory folder/)
  assert.match(decide(write(inHookFolder, { cwd: undefined }), { CLAUDE_PROJECT_DIR: '.' }), /memory folder/)
  // targets that would land inside the folder, so only the absolute-root check refuses them
  const relativeTarget = join('.claude', 'agent-memory-local', 'ai-engineer', 'x.md')
  assert.equal(isInMemory(relativeTarget, 'ai-engineer', '.'), false)
  assert.equal(isInMemory(relativeTarget, 'ai-engineer', 'work'), false)
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

// The 2026-11-09 p1 round: 1.6–7.2K-character narratives above the REPORT filled the supervisor's context.
const LONG_HEAD = 'section-team: your hand-back has more than 1200 characters above its REPORT block. Move the long part (probe logs, spec readings, flow output) to `.team/reports/<date>/<time>-<your id>-details.md`, name that file on the Next line, and hand back again with at most 5 short lines above the block.'
const withHead = (agent_type, head, report) => ev(agent_type, 'SubagentHandback', { message: `${head}\n${report}` })
const GRADED = REPORT_WITH('done', 'src/api.mjs', '8.5/10 (reviewer, 1 fix rounds)')

test('a builder hand-back that claims done with more than 1200 characters above its REPORT is refused, before the grade checks', () => {
  assert.equal(decide(withHead('section-team:testing', 'x'.repeat(1201), GRADED)), LONG_HEAD)
  assert.equal(decide(withHead('section-team:backend', 'x'.repeat(1201), UNGRADED_DONE)), LONG_HEAD)
  // partial, blocked and ungraded stay the honest ways out, so a long head never keeps a section from handing back
  for (const status of ['partial', 'blocked', 'ungraded']) {
    assert.equal(decide(withHead('section-team:backend', 'x'.repeat(5000), REPORT_WITH(status, 'src/api.mjs', null))), null, status)
  }
  assert.equal(decide(withHead('section-team:testing', 'x'.repeat(1200), GRADED)), null)
  // Measured on LF text, trimmed: CRLF line ends and blank space around the head do not count.
  assert.equal(decide(withHead('section-team:testing', `\r\n  ${'x'.repeat(600)}\r\n${'y'.repeat(599)}  \r\n`, GRADED)), null)
  assert.equal(decide(withHead('section-team:ai-engineer', 'x'.repeat(5000), REPORT_WITH('done', 'none', 'n/a (no code)'))), null)
  assert.equal(decide(ev('section-team:backend', 'SubagentHandback', { message: 'x'.repeat(5000) })), null)
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

test('in a Max project a done 8/10 handback is refused with 9/10 and 2 fix rounds; Balanced and no mode file let it through', () => {
  const max = projectWith('{"mode":"max"}')
  const reason = decide(handbackIn(max, DONE_AT('8/10 (reviewer, 1 fix round)')), {})
  assert.match(reason, /under the pass mark \(9\/10\)/)
  assert.ok(reason.includes('at most 2 fix rounds'), reason)
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
  assert.ok(max.includes('at most 2 fix rounds'), max)
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
  assert.ok(reason.includes('(8/10)'), reason)
  assert.ok(reason.includes('at most 2 fix rounds in all'), reason)
  assert.doesNotMatch(reason, /sonnet/)
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
  const run = spawnSync(process.execPath, ['--import', PLANT, SCRIPT], { input: '{"agent_type":"section-team:ai-engineer","tool_name":"Write","cwd":"x"}', encoding: 'utf8', env: hookEnv(tempDir()) })
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

// The handback gate with a session record: the project's mode file decides when usable, else the session's record, else Balanced.
const has = (text, part) => typeof text === 'string' && text.includes(part)
const sessionEvent = (e, session_id = 's1') => ({ ...e, session_id })
const homeWith = mode => {
  const home = tempDir()
  recordMode(home, 's1', mode)
  return home
}
// Every kind of unusable mode file: three bad texts via projectWith, and a project whose .team is a file.
const brokenProjects = () => {
  const teamIsFile = tempDir()
  writeFileSync(join(teamIsFile, '.team'), 'not a folder')
  return ['{not json', '{"mode":"turbo"}', '[1]'].map(text => projectWith(text)).concat(teamIsFile)
}
const gateWith = (dir, report, home, sessionId = 's1') => {
  let reason
  assert.doesNotThrow(() => { reason = decide(sessionEvent(handbackIn(dir, report), sessionId), {}, home) })
  return reason
}
const writeRecordText = (home, text) => {
  const file = join(home, '.claude', 'section-team', 'modes', 's1.json')
  mkdirSync(join(home, '.claude', 'section-team', 'modes'), { recursive: true })
  writeFileSync(file, text)
}

test('a project turned off mid-session keeps the gate of the mode the session started in', () => {
  const reason = gateWith(projectWith('{"mode":"off"}'), DONE_AT('8/10 (reviewer, 1 fix round)'), homeWith('max'))
  assert.ok(has(reason, '(9/10)'), reason)
})

test('a Max record keeps the Max gate when the project mode file is unusable', () => {
  const home = homeWith('max')
  for (const dir of brokenProjects()) {
    const reason = gateWith(dir, DONE_AT('8/10 (reviewer, 1 fix round)'), home)
    assert.ok(has(reason, '(9/10)'), reason)
    assert.ok(has(reason, 'at most 2 fix rounds'), reason)
    assert.equal(gateWith(dir, DONE_AT('9/10 (reviewer, 1 fix round)'), home), null)
  }
})

test('a record from before 0.3.0 that says lean gets the Balanced gate when the project mode file is unusable', () => {
  const home = homeWith('balanced')
  writeFileSync(join(home, '.claude', 'section-team', 'modes', 's1.json'), '{"mode":"lean"}')
  for (const dir of brokenProjects()) {
    const reason = gateWith(dir, UNGRADED_DONE, home)
    assert.ok(has(reason, 'Pass: overall at least 8 and no item under 6.'), reason)
    assert.ok(has(reason, 'at most 2 fix rounds'), reason)
    assert.ok(!has(reason, 'sonnet'), reason)
  }
})

test('with no record and an unusable mode file the gate is Balanced', () => {
  const home = tempDir()
  for (const dir of brokenProjects()) {
    assert.equal(gateWith(dir, DONE_AT('8/10 (reviewer)'), home), null)
    const failing = gateWith(dir, DONE_AT('7/10 (reviewer)'), home)
    assert.ok(has(failing, '(8/10)'), failing)
    assert.ok(has(failing, 'at most 2 fix rounds'), failing)
  }
})

test('a bad or missing session id gives Balanced without throwing, even with a record for another session', () => {
  const home = homeWith('max')
  // The event is built here, not through gateWith: its default id would turn undefined back into 's1'.
  const gateFor = (dir, report, id) => {
    let reason
    assert.doesNotThrow(() => { reason = decide({ ...handbackIn(dir, report), session_id: id }, {}, home) })
    return reason
  }
  for (const id of ['../x', undefined, null, 42]) {
    for (const dir of brokenProjects()) {
      assert.equal(gateFor(dir, DONE_AT('8/10 (reviewer)'), id), null, String(id))
      const failing = gateFor(dir, DONE_AT('7/10 (reviewer)'), id)
      assert.ok(has(failing, '(8/10)'), `${String(id)}: ${failing}`)
    }
  }
})

test('a broken session record gives Balanced without throwing', () => {
  for (const text of ['{bad', '{"mode":"turbo"}']) {
    const home = tempDir()
    writeRecordText(home, text)
    for (const dir of brokenProjects()) {
      assert.equal(gateWith(dir, DONE_AT('8/10 (reviewer)'), home), null, text)
      const failing = gateWith(dir, DONE_AT('7/10 (reviewer)'), home)
      assert.ok(has(failing, '(8/10)'), `${text}: ${failing}`)
    }
  }
})

test('a usable project mode wins over the session record, and a missing mode file counts as Balanced', () => {
  const refused = gateWith(projectWith('{"mode":"max"}'), DONE_AT('8/10 (reviewer)'), homeWith('balanced'))
  assert.ok(has(refused, '(9/10)'), refused)
  assert.equal(gateWith(projectWith('{"mode":"balanced"}'), DONE_AT('8/10 (reviewer)'), homeWith('max')), null)
  assert.equal(gateWith(projectWith(null), DONE_AT('8/10 (reviewer)'), homeWith('max')), null)
})

test('with no project dir at all the session record decides, else Balanced', () => {
  const nowhere = quality => sessionEvent({ ...handback('section-team:backend', DONE_AT(quality)), cwd: undefined })
  const refused = decide(nowhere('8/10 (reviewer)'), {}, homeWith('max'))
  assert.ok(has(refused, '(9/10)'), refused)
  assert.equal(decide(nowhere('8/10 (reviewer)'), {}, tempDir()), null)
})

test('the spawned hook gates on the session record when the project mode file is unusable', () => {
  const home = homeWith('max')
  const e = sessionEvent(handbackIn(projectWith('{not json'), DONE_AT('8/10 (reviewer, 1 fix round)')))
  const run = spawnHook(JSON.stringify(e), home)
  assert.equal(run.status, 0)
  const out = JSON.parse(run.stdout)
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.ok(has(out.hookSpecificOutput.permissionDecisionReason, '(9/10)'), out.hookSpecificOutput.permissionDecisionReason)
})

// The resume guard: a supervisor's SendMessage has no agent_type, so decide must check it first.
const OVER_USAGE = { input_tokens: 1, cache_read_input_tokens: 450000, cache_creation_input_tokens: 0 }
const finalText = [{ type: 'text', text: 'All done.' }]
const OVER_LIMIT = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: finalText, usage: OVER_USAGE } })
const UNDER_LIMIT = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: finalText, usage: { input_tokens: 5000 } } })
const OVER_LIMIT_WORKING = [
  JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_w', name: 'Read', input: {} }], usage: OVER_USAGE } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_w', content: 'ok' }] } }),
].join('\n')
const sendMessageTo = (agentType, jsonl) => {
  const dir = tempDir()
  const subagents = join(dir, 'sid-1', 'subagents')
  mkdirSync(subagents, { recursive: true })
  writeFileSync(join(subagents, 'agent-a1.jsonl'), `${jsonl}\n`)
  writeFileSync(join(subagents, 'agent-a1.meta.json'), JSON.stringify({ agentType }))
  return { tool_name: 'SendMessage', tool_input: { to: 'a1', message: 'next job' }, session_id: 'sid-1', transcript_path: join(dir, 'sid-1.jsonl') }
}

test('hooks.json runs the guard on SendMessage and keeps the tools it already matched', () => {
  const [entry] = JSON.parse(readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8')).hooks.PreToolUse
  const matcher = new RegExp(`^(${entry.matcher})$`)
  for (const tool of ['SendMessage', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Agent', 'SubagentHandback']) assert.match(tool, matcher)
})

test('a SendMessage to a finished oversized builder head is refused, in the words each caller needs', () => {
  const e = sendMessageTo('section-team:backend', OVER_LIMIT)
  const fromSupervisor = decide(e)
  assert.match(fromSupervisor, /the backend section has finished at 450K tokens/)
  assert.match(fromSupervisor, /Start a fresh Agent call for this work/)
  const fromSection = decide({ ...e, agent_type: 'section-team:frontend' })
  assert.match(fromSection, /the backend section has finished at 450K tokens/)
  assert.match(fromSection, /SendMessage `main` with your request/)
  assert.doesNotMatch(fromSection, /Start a fresh Agent call/)
})

test('a SendMessage to an oversized head still working is allowed, from the supervisor and from a section', () => {
  const e = sendMessageTo('section-team:backend', OVER_LIMIT_WORKING)
  assert.equal(decide(e), null)
  assert.equal(decide({ ...e, agent_type: 'section-team:frontend' }), null)
})

test('a SendMessage to a reviewer, or to a head under the limit, is allowed', () => {
  const reviewer = sendMessageTo('section-team:reviewer', OVER_LIMIT)
  assert.equal(decide(reviewer), null)
  assert.equal(decide({ ...reviewer, agent_type: 'section-team:ai-engineer' }), null)
  assert.equal(decide(sendMessageTo('section-team:backend', UNDER_LIMIT)), null)
})

// The grade check: a section's REPORT against the reviewer's answer in its own transcript.
const reviewerCall = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_r', name: 'Agent', input: { subagent_type: 'section-team:reviewer', prompt: 'grade it' } }] } }
const readCall = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_x', name: 'Read', input: { file_path: 'a.mjs' } }] } }
const resultOf = text => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_r', content: [{ type: 'text', text }] }] } })
const gradeSaid = n => `  ## GRADE\n  Overall: ${n}/10\n  Verdict: pass\n`
const REVIEW_FORMS = {
  tool_result: n => [reviewerCall, resultOf(`${gradeSaid(n)}agentId: ar1 (use SendMessage)`)],
  attachment: n => [reviewerCall, resultOf('The report was delivered as a message.\nagentId: ar1 (use SendMessage)'), { type: 'attachment', attachment: { type: 'queued_command', prompt: `<agent-message from="ar1">\n${gradeSaid(n)}</agent-message>` } }],
}
const gradedHandback = (entries, report, agent_type = 'section-team:backend') => {
  const dir = tempDir()
  const subagents = join(dir, 'sid-1', 'subagents')
  mkdirSync(subagents, { recursive: true })
  writeFileSync(join(subagents, 'agent-s1.jsonl'), `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`)
  return { ...handbackIn(projectWith(null), report), agent_type, agent_id: 's1', session_id: 'sid-1', transcript_path: join(dir, 'sid-1.jsonl') }
}

for (const [form, said] of Object.entries(REVIEW_FORMS)) {
  test(`the handback gate checks the REPORT's grade against a reviewer answer in a ${form}`, () => {
    assert.equal(decide(gradedHandback(said(9), DONE_AT('9/10 (reviewer, 0 fix rounds)')), {}, tempDir()), null)
    assert.equal(decide(gradedHandback(said(9), DONE_AT('8.5/10 (reviewer, 0 fix rounds)')), {}, tempDir()), null)
    assert.equal(decide(gradedHandback(said(8), DONE_AT('9/10 (reviewer, 0 fix rounds)')), {}, tempDir()), "section-team: your REPORT says 9/10, but the reviewer said 8/10. Report the reviewer's grade.")
  })
}

test('a graded REPORT with no reviewer call in the transcript is refused', () => {
  assert.equal(decide(gradedHandback([readCall], DONE_AT('9/10 (reviewer)')), {}, tempDir()), 'section-team: your REPORT gives a grade, but no reviewer call is in your transcript. Run section-team:reviewer on your changed files.')
})

test('the existing gate checks come first, so a low or missing grade keeps its own refusal', () => {
  assert.match(decide(gradedHandback([readCall], DONE_AT('7/10 (reviewer)')), {}, tempDir()), /under the pass mark/)
  assert.match(decide(gradedHandback([readCall], UNGRADED_DONE), {}, tempDir()), /no reviewer grade/)
})

test('partial, blocked, ungraded, docs-only and advisor handbacks are not checked against the transcript', () => {
  const lying = '9/10 (reviewer, 0 fix rounds)'
  for (const entries of [[readCall], REVIEW_FORMS.tool_result(5), REVIEW_FORMS.attachment(5)]) {
    for (const status of ['partial', 'blocked', 'ungraded — no Agent tool']) assert.equal(decide(gradedHandback(entries, REPORT_WITH(status, 'src/api.mjs', lying)), {}, tempDir()), null, status)
    assert.equal(decide(gradedHandback(entries, REPORT_WITH('done', 'README.md', lying)), {}, tempDir()), null, 'docs only')
    assert.equal(decide(gradedHandback(entries, DONE_AT(lying), 'section-team:ai-engineer'), {}, tempDir()), null, 'advisor')
  }
})

test('a graded handback whose transcript cannot be found allows', () => {
  const e = gradedHandback([readCall], DONE_AT('9/10 (reviewer)'))
  assert.equal(decide({ ...e, agent_id: undefined }, {}, tempDir()), null)
  assert.equal(decide({ ...e, agent_id: 'nobody' }, {}, tempDir()), null)
})

test('the spawned hook denies a grade above the reviewer and stays silent on an honest one', () => {
  const refused = spawnHook(JSON.stringify(gradedHandback(REVIEW_FORMS.attachment(8), DONE_AT('9/10 (reviewer)'))))
  assert.equal(refused.status, 0)
  const out = JSON.parse(refused.stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /your REPORT says 9\/10, but the reviewer said 8\/10/)
  const honest = spawnHook(JSON.stringify(gradedHandback(REVIEW_FORMS.attachment(9), DONE_AT('9/10 (reviewer)'))))
  assert.equal(honest.status, 0)
  assert.equal(honest.stdout, '')
})

test('the spawned hook denies resuming a finished oversized head and stays silent otherwise', () => {
  const refused = spawnHook(JSON.stringify(sendMessageTo('section-team:backend', OVER_LIMIT)))
  assert.equal(refused.status, 0)
  const out = JSON.parse(refused.stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /the backend section has finished at 450K tokens/)
  for (const input of [sendMessageTo('section-team:backend', '{not json'), sendMessageTo('section-team:backend', OVER_LIMIT_WORKING), { tool_name: 'SendMessage', tool_input: { to: 'main' } }]) {
    const allowed = spawnHook(JSON.stringify(input))
    assert.equal(allowed.status, 0)
    assert.equal(allowed.stdout, '')
  }
})

const DOCS_ONLY = (status, quality) => REPORT_WITH(status, 'README.md', quality)

test('in Max a done docs-only handback without a grade is refused with the ungraded text; Balanced lets it through', () => {
  const max = projectWith('{"mode":"max"}')
  const refused = decide(handbackIn(max, DOCS_ONLY('done', 'n/a (no code)')), {})
  assert.equal(refused, gateReasons(GATES.max).ungraded)
  assert.equal(decide(handbackIn(projectWith('{"mode":"balanced"}'), DOCS_ONLY('done', 'n/a (no code)')), {}), null)
  assert.equal(decide(handbackIn(projectWith(null), DOCS_ONLY('done', null)), {}), null)
})

test('in Max a done handback naming only an extensionless file or dotfile without a grade is refused', () => {
  const max = projectWith('{"mode":"max"}')
  for (const changed of ['Dockerfile', 'LICENSE', 'Makefile', '.gitignore', 'bin/run', 'edited Dockerfile and LICENSE', '`Dockerfile`', '`.gitignore`', 'AUTHORS', 'configure', '`AUTHORS`, `configure`',
    'AUTHORS (added)', '`configure` (updated)', 'AUTHORS - added', '"configure": rewritten', 'updated the docs', 'no code changes; Dockerfile updated']) {
    assert.equal(decide(handbackIn(max, REPORT_WITH('done', changed, null)), {}), gateReasons(GATES.max).ungraded, changed)
  }
})

test('in Max a graded docs handback passes at the pass mark and fails under it', () => {
  const max = projectWith('{"mode":"max"}')
  assert.equal(decide(handbackIn(max, DOCS_ONLY('done', '9/10 (reviewer, 0 fix rounds)')), {}), null)
  assert.match(decide(handbackIn(max, DOCS_ONLY('done', '8/10 (reviewer, 1 fix round)')), {}), /under the pass mark \(9\/10\)/)
})

test('in Max partial, blocked and ungraded docs handbacks stay open, and a REPORT that changed no file needs no grade', () => {
  const max = projectWith('{"mode":"max"}')
  for (const status of ['partial', 'blocked', 'ungraded']) assert.equal(decide(handbackIn(max, DOCS_ONLY(status, null)), {}), null, status)
  assert.equal(decide(handbackIn(max, REPORT_WITH('done', 'none', 'n/a (no code)')), {}), null)
  for (const changed of ['n/a', 'N/A (no code)', 'nothing', 'no files', 'no changes', '`none`', 'None.', '(none)', 'none (read-only)', 'unchanged', '-', '—']) {
    assert.equal(decide(handbackIn(max, REPORT_WITH('done', changed, null)), {}), null, changed)
  }
})

// The session memory guard: the hook starts one detached runner per session. Every effect is a fake here: no real listing, spawn or stop.
const GUARD_MB = 1024 * 1024
const GUARD_GB = 1024 * GUARD_MB
// claude.exe 100 -> bash.exe 200 -> node.exe 300 (the hook).
const GUARD_TABLE = [
  { pid: 100, ppid: 50, started: 1000, bytes: GUARD_GB, name: 'claude.exe', command: 'claude.exe --session' },
  { pid: 200, ppid: 100, started: 2000, bytes: GUARD_MB, name: 'bash.exe', command: 'bash -c node hook' },
  { pid: 300, ppid: 200, started: 3000, bytes: GUARD_MB, name: 'node.exe', command: 'node pre-tool-use.mjs' },
]
// The guard is opt-in: these tests turn it on with a 12 GB limit.
const GUARD_ON = Object.freeze({ SECTION_TEAM_MEMORY_LIMIT_MB: '12288' })
const guardEvent = (over = {}) => ({ agent_type: 'section-team:backend', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: 'sess-1', cwd: tempDir(), ...over })
function guardDeps(over = {}) {
  const spawned = []
  const listed = []
  const deps = {
    home: tempDir(), platform: 'win32', totalBytes: 16 * GUARD_GB, now: () => Date.now(), pid: 300,
    list: () => { listed.push(1); return GUARD_TABLE },
    spawn: file => { spawned.push(file) },
    ...over,
  }
  return { deps, spawned, listed }
}
const guardRecord = home => join(home, '.claude', 'section-team', 'modes', 'sess-1.guard.json')
const readGuardRecord = home => JSON.parse(readFileSync(guardRecord(home), 'utf8'))
const writeGuardRecord = (home, data, ageMs) => {
  mkdirSync(join(home, '.claude', 'section-team', 'modes'), { recursive: true })
  writeFileSync(guardRecord(home), JSON.stringify(data))
  const at = new Date(Date.now() - ageMs)
  utimesSync(guardRecord(home), at, at)
}

test("a builder's Bash call starts one guard, with the root, the limit and the log in its record", () => {
  const { deps, spawned } = guardDeps()
  const e = guardEvent()
  assert.equal(ensureGuard(e, GUARD_ON, deps), null)
  assert.deepEqual(spawned, [guardRecord(deps.home)])
  const record = readGuardRecord(deps.home)
  assert.deepEqual(record.root, { pid: 100, started: 1000, name: 'claude.exe', command: 'claude.exe --session' })
  assert.equal(record.limit, 12 * GUARD_GB)
  assert.equal(record.log, join(e.cwd, '.team', 'tmp', 'memory-guard.log'))
  assert.match(record.claim, /^[0-9a-f-]{36}$/, 'the record names the guard it started')
  for (const tool of ['Bash', 'PowerShell']) ensureGuard(guardEvent({ tool_name: tool, cwd: e.cwd }), GUARD_ON, deps)
  assert.equal(spawned.length, 1, 'a running guard is not started again')
})

test('two calls at the same moment on one empty record folder give exactly one spawn', () => {
  const holder = {}
  const { deps, spawned } = guardDeps({ list: () => { holder.inner = ensureGuard(guardEvent(), GUARD_ON, deps); return GUARD_TABLE } })
  ensureGuard(guardEvent(), GUARD_ON, deps)
  assert.equal(holder.inner, null)
  assert.equal(spawned.length, 1)
})

test('a fresh record starts nothing; a stale one is taken over by one caller only', () => {
  const fresh = guardDeps()
  writeGuardRecord(fresh.deps.home, { root: {} }, 1000)
  assert.equal(ensureGuard(guardEvent(), GUARD_ON, fresh.deps), null)
  assert.equal(fresh.spawned.length, 0)
  assert.equal(fresh.listed.length, 0)

  const stale = guardDeps()
  writeGuardRecord(stale.deps.home, { root: {}, claim: 'old-guard' }, 60 * 1000)
  ensureGuard(guardEvent(), GUARD_ON, stale.deps)
  ensureGuard(guardEvent(), GUARD_ON, stale.deps)
  assert.equal(stale.spawned.length, 1)
  const taken = readGuardRecord(stale.deps.home).claim
  assert.ok(typeof taken === 'string' && taken !== 'old-guard', 'a takeover names the new guard, so the old one exits')

  // A second caller arrives while the first is taking over the same stale record: it does nothing.
  const raced = guardDeps()
  const holder = {}
  raced.deps.list = () => { holder.inner = ensureGuard(guardEvent(), GUARD_ON, raced.deps); return GUARD_TABLE }
  writeGuardRecord(raced.deps.home, { root: {} }, 60 * 1000)
  ensureGuard(guardEvent(), GUARD_ON, raced.deps)
  assert.equal(holder.inner, null)
  assert.equal(raced.spawned.length, 1)
})

test('the supervisor, an advisor, a Write call, a bad session id, limit 0 and an unset limit on any platform start nothing', () => {
  const VAR = 'SECTION_TEAM_MEMORY_LIMIT_MB'
  const cases = [
    [guardEvent({ agent_type: undefined }), GUARD_ON, {}],
    [guardEvent({ agent_type: 'section-team:ai-engineer' }), GUARD_ON, {}],
    [guardEvent({ agent_type: 'section-team:plan-advisor' }), GUARD_ON, {}],
    [guardEvent({ agent_type: 'backend' }), GUARD_ON, {}],
    [guardEvent({ tool_name: 'Write' }), GUARD_ON, {}],
    [guardEvent({ session_id: '../x' }), GUARD_ON, {}],
    [guardEvent({ session_id: undefined }), GUARD_ON, {}],
    [guardEvent(), { [VAR]: '0' }, {}],
    [guardEvent(), {}, {}],
    [guardEvent(), {}, { platform: 'linux' }],
  ]
  for (const [e, env, over] of cases) {
    const { deps, spawned, listed } = guardDeps(over)
    assert.equal(ensureGuard(e, env, deps), null, JSON.stringify({ e, env, over }))
    assert.equal(spawned.length + listed.length, 0)
    assert.deepEqual(readdirSync(deps.home), [], 'nothing written')
  }
  // The variable turns it on outside Windows.
  const linux = guardDeps({ platform: 'linux' })
  ensureGuard(guardEvent(), { [VAR]: '300' }, linux.deps)
  assert.equal(linux.spawned.length, 1)
  assert.equal(readGuardRecord(linux.deps.home).limit, 300 * GUARD_MB)
})

test('a failed listing and an unknown host write the failure, say so once, and are not retried within 10 minutes', () => {
  const unknownHost = GUARD_TABLE.map(r => r.pid === 100 ? { ...r, name: 'Code.exe' } : r)
  for (const list of [() => { throw new Error('powershell timed out') }, () => unknownHost]) {
    let now = Date.now()
    const { deps, spawned, listed } = guardDeps({ now: () => now })
    deps.list = () => { listed.push(1); return list() }
    const first = ensureGuard(guardEvent(), GUARD_ON, deps)
    assert.match(first, /memory guard/)
    assert.ok(!first.includes('\n'))
    assert.ok(readGuardRecord(deps.home).failed, 'the failure is in the record')
    assert.equal(spawned.length, 0)
    // Later calls in the next 10 minutes neither retry nor repeat the notice, even once the record looks stale.
    assert.equal(ensureGuard(guardEvent(), GUARD_ON, deps), null)
    const old = new Date(now - 60 * 1000)
    utimesSync(guardRecord(deps.home), old, old)
    now += 9 * 60 * 1000
    assert.equal(ensureGuard(guardEvent(), GUARD_ON, deps), null)
    assert.equal(listed.length, 1)
    now += 2 * 60 * 1000
    ensureGuard(guardEvent(), GUARD_ON, deps)
    assert.equal(listed.length, 2, 'retried after 10 minutes')
  }
})

test('a spawn error is a failed start', () => {
  const broken = guardDeps({ spawn: () => { throw Object.assign(new Error('spawn failed'), { code: 'EPERM' }) } })
  assert.match(ensureGuard(guardEvent(), GUARD_ON, broken.deps), /memory guard.*EPERM/)
  assert.ok(readGuardRecord(broken.deps.home).failed)
})

// The 0.5.1 regression: the guard became opt-in, and a bad value then returned before its problem line, so a user's typo turned the guard off in silence.
test('a bad limit value is said once per session, starts no guard, and unset or 0 stay silent', () => {
  const VAR = 'SECTION_TEAM_MEMORY_LIMIT_MB'
  for (const bad of ['12GB', '12288 ', '12,288']) {
    const { deps, spawned, listed } = guardDeps()
    const env = { [VAR]: bad }
    const first = ensureGuard(guardEvent(), env, deps)
    assert.match(first ?? '', new RegExp(`^${VAR} is not a whole number of MB`), JSON.stringify(bad))
    assert.ok(!first.includes('\n'))
    assert.equal(ensureGuard(guardEvent(), env, deps), null, `${JSON.stringify(bad)} is said once`)
    assert.equal(ensureGuard(guardEvent({ tool_name: 'PowerShell' }), env, deps), null)
    assert.equal(spawned.length + listed.length, 0, 'no guard starts on a bad value')
    // Another session is told too.
    assert.match(ensureGuard(guardEvent({ session_id: 'sess-2' }), env, deps) ?? '', new RegExp(VAR))
  }
  for (const env of [{}, { [VAR]: '' }, { [VAR]: '0' }]) {
    const { deps } = guardDeps()
    assert.equal(ensureGuard(guardEvent(), env, deps), null, JSON.stringify(env))
    assert.equal(ensureGuard(guardEvent(), env, deps), null, JSON.stringify(env))
  }
})

test('the said-once marker ends in .json, so the weekly prune of the modes folder removes it', () => {
  const { deps } = guardDeps()
  ensureGuard(guardEvent(), { SECTION_TEAM_MEMORY_LIMIT_MB: '12GB' }, deps)
  const names = readdirSync(join(deps.home, '.claude', 'section-team', 'modes'))
  assert.deepEqual(names, ['sess-1.limit-said.json'])
})

test("decide gives the same answers with a session id on a builder's Bash call", () => {
  assert.equal(decide(guardEvent()), null)
  assert.match(decide(guardEvent({ agent_type: 'section-team:ai-engineer' })), /read-only/)
})

// A builder's scratch folder: made where a relative `.team/tmp/<id>/` in its command resolves (the event's cwd, else CLAUDE_PROJECT_DIR).
const scratchOf = (dir, id = 'backend') => join(dir, '.team', 'tmp', id)
const isFolder = dir => existsSync(dir) && statSync(dir).isDirectory()
const scratchEvent = (cwd, agent_type = 'section-team:backend', tool_name = 'Bash') => ({ agent_type, tool_name, tool_input: { command: 'npm test > .team/tmp/backend/run1.log' }, cwd })
// The hook run with its own process folder set, so a path wrongly resolved against that folder lands in a temp folder the test checks.
const spawnIn = (input, cwd, env = {}) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', cwd, env: { ...hookEnv(tempDir()), ...env } })

test("a builder's Bash or Agent call makes its .team/tmp/<id>/ folder under the event's cwd", () => {
  const bash = tempDir()
  assert.equal(ensureScratch(scratchEvent(bash), {}), null)
  assert.ok(isFolder(scratchOf(bash)))
  const agent = tempDir()
  assert.equal(ensureScratch(scratchEvent(agent, 'section-team:ai-llm', 'Agent'), {}), null)
  assert.deepEqual(readdirSync(join(agent, '.team', 'tmp')), ['ai-llm'])
})

test('the folder goes under the cwd when it differs from CLAUDE_PROJECT_DIR, and under CLAUDE_PROJECT_DIR when there is no cwd', () => {
  const cwd = tempDir()
  const project = tempDir()
  assert.equal(ensureScratch(scratchEvent(cwd), { CLAUDE_PROJECT_DIR: project }), null)
  assert.ok(isFolder(scratchOf(cwd)))
  assert.deepEqual(readdirSync(project), [])
  assert.equal(ensureScratch(scratchEvent(undefined), { CLAUDE_PROJECT_DIR: project }), null)
  assert.ok(isFolder(scratchOf(project)))
  assert.equal(ensureScratch(scratchEvent(undefined), {}), null)
})

test("an advisor's, a helper's and the supervisor's calls make no scratch folder", () => {
  for (const agent_type of ['section-team:ai-engineer', 'section-team:plan-advisor', 'section-team:coder', 'section-team:reviewer', 'section-team:scout', 'backend', undefined]) {
    const dir = tempDir()
    // Spread, not the agent_type argument: an undefined argument would take its default, a builder.
    for (const tool of ['Bash', 'PowerShell', 'Agent', 'Write']) assert.equal(ensureScratch({ ...scratchEvent(dir, 'x', tool), agent_type }, {}), null)
    assert.deepEqual(readdirSync(dir), [], String(agent_type))
  }
})

test('a folder that already exists gives null, and so does a second call', () => {
  const dir = tempDir()
  mkdirSync(scratchOf(dir), { recursive: true })
  writeFileSync(join(scratchOf(dir), 'run1.log'), 'kept')
  assert.equal(ensureScratch(scratchEvent(dir), {}), null)
  assert.equal(ensureScratch(scratchEvent(dir), {}), null)
  assert.equal(readFileSync(join(scratchOf(dir), 'run1.log'), 'utf8'), 'kept')
})

test('a .team that is a file gives one notice line and does not throw', () => {
  const dir = tempDir()
  writeFileSync(join(dir, '.team'), 'not a folder')
  let notice
  assert.doesNotThrow(() => { notice = ensureScratch(scratchEvent(dir), {}) })
  assert.match(notice, /^scratch folder not made: \S+$/)
})

test("the spawned hook makes a builder's folder silently and never resolves a relative or missing cwd against its own folder", () => {
  const project = tempDir()
  const quiet = spawnHook(JSON.stringify(scratchEvent(project, 'section-team:testing', 'Agent')))
  assert.equal(quiet.status, 0)
  assert.equal(quiet.stdout, '')
  assert.ok(isFolder(scratchOf(project, 'testing')))
  for (const cwd of [undefined, '', '.', 'sub']) {
    const here = tempDir()
    const alone = spawnIn(JSON.stringify(scratchEvent(cwd)), here)
    assert.equal(alone.status, 0)
    assert.equal(alone.stdout, '')
    assert.deepEqual(readdirSync(here), [], String(cwd))
    const fallback = tempDir()
    assert.equal(spawnIn(JSON.stringify(scratchEvent(cwd)), here, { CLAUDE_PROJECT_DIR: fallback }).status, 0)
    assert.ok(isFolder(scratchOf(fallback)), String(cwd))
    assert.deepEqual(readdirSync(here), [], String(cwd))
  }
})

test('the spawned hook says in its one systemMessage when the folder cannot be made, and denies nothing', () => {
  const dir = tempDir()
  writeFileSync(join(dir, '.team'), 'not a folder')
  const run = spawnHook(JSON.stringify(scratchEvent(dir)))
  assert.equal(run.status, 0)
  assert.equal(run.stderr, '')
  const out = JSON.parse(run.stdout)
  assert.match(out.systemMessage, /^section-team pre-tool-use: scratch folder not made: \S+$/)
  assert.equal(out.hookSpecificOutput, undefined)
})
