// What run.test.mjs, run-plugin.test.mjs and run-stages.test.mjs share: temp folders, git, and a fake of the pinned binary.
import { execFileSync } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { projectDirFor } from './run-attempts.mjs'

export const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()

// A temp folder removed after the test, even when the test fails.
export function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-run-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

// The fake children's pid: odd, so never a Windows PID, and above Linux's pid_max, so a regression that reached the
// real killTree would stop nothing.
export const FAKE_PID = 2147483647

// A stand-in for the pinned binary: it writes the session transcript where Claude Code would and streams an init and a result.
// With transcript false it writes no session file, as when the API fails before the first turn is saved. With hang
// true it streams only the init and runs until it is killed (its streams ended), then closes with code null. A null
// result writes the init alone and exits; reportedSession is the session id its init claims, for a resume that forks.
export function fakeClaude({ home, calls, init, result = { type: 'result', subtype: 'success', is_error: false, result: 'done' }, transcript = true, hang = false, reportedSession = null }) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    const sessionId = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1]
    const project = projectDirFor(options.cwd, home)
    mkdirSync(project, { recursive: true })
    if (transcript) writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5' } })}\n`)
    const child = Object.assign(new EventEmitter(), { pid: FAKE_PID, stdout: new PassThrough(), stderr: new PassThrough() })
    const started = { ...init, session_id: reportedSession ?? sessionId }
    const lines = hang || result === null ? [started] : [started, result]
    Promise.all([once(child.stdout, 'end'), once(child.stderr, 'end')]).then(() => child.emit('close', hang ? null : 0))
    const text = `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
    // A hanging child's init is written at once (the stream holds it until runOne pipes it): written from setImmediate,
    // a 50 ms stop sometimes came first under the full suite's load, and the run was void with no init.
    if (hang) child.stdout.write(text)
    else setImmediate(() => {
      child.stdout.end(text)
      child.stderr.end()
    })
    return child
  }
}

// A kill for fake children: it ends their streams, so they close with code null. The real killTree would run
// taskkill on the fake pid; tests never rely on it.
export const endStreams = child => {
  child.stdout.end()
  child.stderr.end()
}

// A solo run of task easy into a temp root, with a pin and an init that pass the init check. deps always carry a
// fake kill, a short time limit and a harmless stash, so no runOne test can hang, reach the real killTree or move the
// user's section memory: the real stashRunMemory empties ~/.claude/agent-memory, and a test's cleanup would then delete it.
export function soloAttempt(t) {
  t.mock.method(console, 'log', () => {})
  const root = tempRoot(t)
  const builtins = ['cc-plugin-agents-md@builtin']
  // A binary path under the temp root that never exists: a regression that dropped the injected spawn could start nothing.
  const pin = { binary: join(root, 'claude-2.1.296.exe'), version: '2.1.296', apiKeySource: 'none', builtins, setups: { solo: { agents: ['general-purpose'], skills: [] } } }
  const home = join(root, 'home')
  const dir = join(root, 'runs', 'easy-0123abcd')
  return {
    root, pin, home, dir, outDir: join(root, 'results', 'easy-solo-mo-r1'),
    ctx: { pin, installedKeys: ['a@market'], pluginDir: 'C:/Users/Asus/section-team-v0.2.1', pluginVersion: '0.2.1', pluginCommit: 'c0ffee1' },
    init: {
      type: 'system', subtype: 'init', model: 'claude-opus-5-5', claude_code_version: '2.1.296', apiKeySource: 'none', mcp_servers: [],
      plugins: [{ name: 'cc-plugin-agents-md', path: 'builtin', source: builtins[0] }], agents: ['general-purpose'], skills: [],
    },
    run: { id: 'easy-solo-mo-r1', task: 'easy', cond: 'solo-mo', base: 'solo', rep: 1 },
    deps: { kill: endStreams, timeoutMs: 5_000, home, dir, root: join(root, 'runs'), stash: () => [] },
  }
}
