// Paid preflight before a round (about $0.10, needs the user's yes): one cheap `claude -p` per setup with exactly
// the settings run.mjs gives builders, to check from the CLI's own init message that section-team loads for team
// and not for solo (a --settings env block must not drop the user's plugin dir), and that automatic skill installs
// are off. Usage: node bench/preflight.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { builderArgs, builderEnv } from './run.mjs'

const MODEL = 'claude-haiku-5-5'
const PROMPT = "Reply with exactly one word: YES if your context contains the text 'Automatic skill installs are on', otherwise NO."
const TIMEOUT_MS = 180_000

// The problems found in one setup's output (claude -p --output-format json --verbose); empty when it passes.
export function preflightVerdict(base, stdout) {
  let messages
  try {
    messages = JSON.parse(stdout)
  } catch {
    return [`${base}: claude output is not JSON`]
  }
  const list = Array.isArray(messages) ? messages : [messages]
  const init = list.find(m => m?.type === 'system' && m.subtype === 'init' && Array.isArray(m.agents))
  if (!init) return [`${base}: no init message with an agents list`]
  const result = list.findLast(m => m?.type === 'result')
  if (!result || result.is_error) return [`${base}: claude ended on an error: ${result?.result ?? 'no result'}`]
  const loaded = init.agents.some(name => String(name).startsWith('section-team:'))
  return [
    ...(base === 'solo' && loaded ? ['solo: section-team loaded although it is turned off'] : []),
    ...(base !== 'solo' && !loaded ? [`${base}: section-team did not load`] : []),
    ...(/\bYES\b/i.test(String(result.result)) ? [`${base}: automatic skill installs are still on`] : []),
  ]
}

// The problems in one spawnSync result: a claude that did not start, or exited non-zero without JSON (with its first
// stderr line, such as a sign-in error), before the output itself is judged.
export function spawnProblems(base, r) {
  if (r.error) return [`${base}: could not run claude (${r.error.code ?? r.error.message})`]
  let json = true
  try { JSON.parse(r.stdout) } catch { json = false }
  if (r.status !== 0 && !json) {
    const exit = r.status === null ? `was stopped by ${r.signal}` : `exited ${r.status}`
    return [`${base}: claude ${exit}: ${String(r.stderr ?? '').split('\n')[0].trim() || '(no stderr)'}`]
  }
  return preflightVerdict(base, r.stdout)
}

function check(base) {
  const cwd = mkdtempSync(join(tmpdir(), 'bench-preflight-'))
  try {
    const args = [...builderArgs(base, PROMPT), '--model', MODEL, '--verbose']
    return spawnProblems(base, spawnSync('claude', args, { cwd, env: builderEnv(), encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true }))
  } finally {
    // A timed-out claude can leave a process holding the folder on Windows: say so, keep the verdict.
    try {
      rmSync(cwd, { recursive: true, force: true, maxRetries: 5 })
    } catch (err) {
      console.error(`preflight: could not delete ${cwd} (${err.code ?? err.message}); delete it by hand`)
    }
  }
}

if (isMainModule(import.meta.url)) {
  try {
    const problems = ['team', 'solo'].flatMap(check)
    for (const line of problems) console.error(`preflight: ${line}`)
    if (problems.length > 0) process.exitCode = 1
    else console.log('preflight ok: section-team loads for team only, automatic skill installs are off')
  } catch (err) {
    console.error(`preflight: ${err.code && err.path ? `${err.code} at ${err.path}` : err.message}`)
    process.exitCode = 1
  }
}
