import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureExcluded, ensureNotes, excludeFile, isMainModule, latestSummary, projectRoot, pruneStatus, readStdinJson } from './lib/paths.mjs'
import { statusDir } from './sessions-model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// The brief must reach the session even when a side effect fails (EISDIR, ENOTDIR, EACCES): say so on stderr and go on.
function attempt(label, fn) {
  try {
    return fn()
  } catch (err) {
    process.stderr.write(`section-team session-start: ${label} failed: ${String(err?.message ?? err).replace(/\s+/g, ' ')}\n`)
    return null
  }
}

export function buildContext(cwd, home = homedir()) {
  const brief = readFileSync(join(HERE, '..', 'brief', 'supervisor.md'), 'utf8').trim()
  const root = projectRoot(cwd)
  attempt('git exclude update', () => ensureExcluded(cwd, root))
  if (excludeFile(cwd)) attempt('notes folder', () => ensureNotes(root)) // a plain folder gets no .team/ until a section writes a note
  attempt('status prune', () => pruneStatus(statusDir(home)))
  const summary = attempt('summary lookup', () => latestSummary(root))
  return summary ? `${brief}\n\nLast team summary for this project: ${summary}. Read it before new team work.` : brief
}

async function main() {
  const input = await readStdinJson()
  if (typeof input?.cwd !== 'string') return
  const additionalContext = buildContext(input.cwd)
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
}

if (isMainModule(import.meta.url)) {
  main().catch(err => process.stderr.write(`section-team session-start: ${err.message}\n`))
}
