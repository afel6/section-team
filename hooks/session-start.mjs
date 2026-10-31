import { homedir } from 'node:os'
import { assembleBrief } from './lib/brief.mjs'
import { ensureExcluded, ensureNotes, excludeFile, isMainModule, latestSummary, projectRoot, pruneStatus, readStdinJson } from './lib/paths.mjs'
import { statusDir } from './sessions-model.mjs'

// Opt-in: by default the supervisor asks before installing a skill a section suggested.
export const AUTO_INSTALL_ENV = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const AUTO_INSTALL_NOTE = [
  '## Skill installs',
  `- Automatic skill installs are on (${AUTO_INSTALL_ENV}=1), which replaces asking first: install a section's \`Suggested skill:\` with \`section-team:add-skill\` without asking when the add-skill safety review finds no red flag. A red flag stops the install and you tell the user. List every skill you installed in your summary.`,
].join('\n')

// The brief must reach the session even when a side effect fails (EISDIR, ENOTDIR, EACCES): say so on stderr and go on.
function attempt(label, fn) {
  try {
    return fn()
  } catch (err) {
    process.stderr.write(`section-team session-start: ${label} failed: ${String(err?.message ?? err).replace(/\s+/g, ' ')}\n`)
    return null
  }
}

export function buildContext(cwd, home = homedir(), env = process.env) {
  const base = assembleBrief('balanced')
  const brief = env[AUTO_INSTALL_ENV] === '1' ? `${base}

${AUTO_INSTALL_NOTE}` : base
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
