import { existsSync, readFileSync } from 'node:fs'
import { extractReport, sectionIdFromType } from './lib/report.mjs'
import { OFF_MODE, readMode } from './lib/mode.mjs'
import { isIgnored, isMainModule, lineOf, projectDirOf, projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'

const MESSAGE_PREFIX = 'section-team subagent-stop'
const PLUGIN_FILE = new URL('../.claude-plugin/plugin.json', import.meta.url)

// Session start excludes .team/ from git only in a project that is not off, so a file saved in an off project can land in the user's tree.
export const OFF_UNIGNORED = 'section-team: this project is off and git does not ignore .team/, so no report was saved.'

// Whether nothing may be saved under root's .team/: the project is off and git does not ignore the folder. Outside git counts as not ignored,
// as for a saved request. git is asked only for an off project.
export const keepsOut = (root, setting = readMode(root)) => setting.off === true && !isIgnored(root, '.team/')

// The plugin's version, or 'unknown': the stamp is a label, so a file it cannot read must not cost the REPORT.
export function pluginVersion(file = PLUGIN_FILE) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// A saved REPORT ends with what produced it, so a later audit can tell. parseReport ignores the field.
function stamped(block, setting) {
  const mode = setting.off ? OFF_MODE : setting.mode
  return `${block}Plugin:       section-team ${pluginVersion()}, mode ${setting.modeUsable ? mode : 'unknown'}\n`
}

// A job starts at a coordinator message (even though the harness flags it isMeta) or at a real user row.
// Harness rows (isMeta: skill loads, hook feedback, system reminders) and tool results arrive mid-job and never start one.
const isToolResultOnly = content => Array.isArray(content) && content.every(part => part == null || part.type === 'tool_result')
const startsJob = row => row?.type === 'user' && (row.origin?.kind === 'coordinator' || (row.isMeta !== true && !isToolResultOnly(row.message?.content)))

// The current job's last handback, else its last assistant text, else ''. Never reaches back past the job's first row.
export function finalAgentText(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !existsSync(transcriptPath)) return ''
  const rows = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean)
  let lastText = ''
  for (let i = rows.length - 1; i >= 0; i--) {
    let row
    try {
      row = JSON.parse(rows[i])
    } catch {
      continue
    }
    if (startsJob(row)) break
    if (row?.type !== 'assistant' || !Array.isArray(row.message?.content)) continue
    const handback = row.message.content.find(part => part?.type === 'tool_use' && part.name === 'SubagentHandback')
    if (typeof handback?.input?.message === 'string') return handback.input.message
    const text = row.message.content.filter(part => part?.type === 'text').map(part => part.text).join('\n')
    if (lastText === '' && text !== '') lastText = text
  }
  return lastText
}

// Every section REPORT is saved, ungraded ones too, at the root of the session's project (CLAUDE_PROJECT_DIR, else the event's cwd).
// The clean-code gate is enforced earlier, when the REPORT is handed back (pre-tool-use.mjs): by the time a section stops, the supervisor already has its REPORT.
// Returns the file, or null when nothing was saved; say gets the one line for the user when a REPORT is held back (keepsOut).
export function saveFromEvent(e, now = new Date(), env = process.env, say = () => {}) {
  const id = sectionIdFromType(e?.agent_type)
  const dir = projectDirOf(e, env)
  if (!id || dir === null) return null
  const block = extractReport(e.last_assistant_message || finalAgentText(e.agent_transcript_path))
  if (!block) return null
  const root = projectRoot(dir)
  const setting = readMode(root)
  if (keepsOut(root, setting)) {
    say(OFF_UNIGNORED)
    return null
  }
  return writeReport(root, id, stamped(block, setting), now)
}

// The line the hook shows when it cannot do its job, or null: input that is not JSON, or a section event with no usable project dir.
// Any other event is not a section's, so there is nothing to save and nothing to say.
export function skipNotice(e, env = process.env) {
  if (e === null) return 'skipped: the hook input is not JSON, so no REPORT was saved'
  const id = sectionIdFromType(e?.agent_type)
  return id && projectDirOf(e, env) === null ? `skipped: the hook input has no absolute cwd, so the ${id} REPORT was not saved` : null
}

const notice = text => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: ${text}` }))
export const sayLine = line => process.stdout.write(JSON.stringify({ systemMessage: line }))

if (isMainModule(import.meta.url)) {
  readStdinJson()
    .then(e => {
      const skipped = skipNotice(e)
      if (skipped === null) saveFromEvent(e, new Date(), process.env, sayLine)
      else notice(skipped)
    })
    .catch(err => notice(`the REPORT was not saved: ${lineOf(err)}`))
}
