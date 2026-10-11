import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureExcluded, isMainModule, latestSummary, projectRoot, readStdinJson } from './lib/paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export function buildContext(cwd) {
  const brief = readFileSync(join(HERE, '..', 'brief', 'supervisor.md'), 'utf8').trim()
  const root = projectRoot(cwd)
  ensureExcluded(cwd, root)
  const summary = latestSummary(root)
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
