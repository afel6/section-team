import { readFileSync } from 'node:fs'
import { finalAgentText } from './subagent-stop.mjs'
import { isMainModule, latestSummary, lineOf, projectDirOf, projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'

const MESSAGE_PREFIX = 'section-team stop'
// The brief tells the supervisor to start its summary under this line: its own mark that the message is the summary.
const SUMMARY_HEADING = /^#{1,3} Team summary$/m

const isSection = e => typeof e?.agent_type === 'string' && e.agent_type.startsWith('section-team:')
const messageOf = e => (typeof e?.last_assistant_message === 'string' && e.last_assistant_message !== '' ? e.last_assistant_message : finalAgentText(e?.transcript_path))
const holds = (file, text) => {
  const saved = readFileSync(file, 'utf8')
  return saved === text || saved === `${text}\n`
}

// Saves the main session's last message as the supervisor summary when it has the heading, unless the newest summary already holds it.
// Checked in this order so an ordinary stop starts no git process. Returns the file, or null when nothing was saved.
// ponytail: reads the whole transcript when the event carries no text; read only its tail if a stop ever gets slow.
export function saveSummary(e, now = new Date(), env = process.env) {
  if (isSection(e)) return null
  const text = messageOf(e)
  if (!SUMMARY_HEADING.test(text)) return null
  const dir = projectDirOf(e, env)
  if (dir === null) return null
  const root = projectRoot(dir)
  const last = latestSummary(root, now)
  if (last !== null && holds(last, text)) return null
  return writeReport(root, 'supervisor-summary', text, now)
}

const notice = text => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: ${text}` }))

if (isMainModule(import.meta.url)) {
  readStdinJson()
    .then(e => {
      if (e === null) notice('skipped: the hook input is not JSON, so no summary was saved')
      else saveSummary(e)
    })
    .catch(err => notice(`the summary was not saved: ${lineOf(err)}`))
}
