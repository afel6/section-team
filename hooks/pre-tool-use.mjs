import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ADVISOR_HELPERS, ADVISOR_IDS, PREFIX, sectionIdFromType } from './lib/report.mjs'
import { isMainModule, readStdinJson } from './lib/paths.mjs'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const READ_ONLY_HELPERS = new Set(ADVISOR_HELPERS)

export function isInMemory(target, id, cwd, home) {
  if (typeof target !== 'string' || target === '') return false
  const rel = relative(join(home, '.claude', 'agent-memory'), resolve(cwd ?? '.', target))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false
  const folder = rel.split(/[\\/]/)[0]
  return folder === id || folder === `section-team-${id}`
}

export function decide(e, home = homedir()) {
  if (typeof e?.agent_type !== 'string' || !e.agent_type.startsWith(PREFIX)) return null
  const id = sectionIdFromType(e.agent_type)
  if (!id || !ADVISOR_IDS.includes(id)) return null
  const tool = e.tool_name
  if (SHELL_TOOLS.has(tool)) return `section-team: the ${id} advisor is read-only; ${tool} is not allowed.`
  if (WRITE_TOOLS.has(tool)) {
    return isInMemory(e.tool_input?.file_path, id, e.cwd, home) ? null : `section-team: the ${id} advisor may only write inside its memory folder.`
  }
  if (tool === 'Agent') {
    return READ_ONLY_HELPERS.has(e.tool_input?.subagent_type) ? null : `section-team: the ${id} advisor may only use read-only helpers (${ADVISOR_HELPERS.join(', ')}).`
  }
  return null
}

if (isMainModule(import.meta.url)) {
  readStdinJson()
    .then(e => {
      const reason = decide(e)
      if (reason) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
      }
    })
    .catch(err => process.stderr.write(`section-team pre-tool-use: ${err.message}\n`))
}
