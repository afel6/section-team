import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ADVISOR_HELPERS } from '../hooks/lib/report.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { readExtra } from './assign-skill.mjs'

export const MODEL = 'claude-opus-5-5'
export const RELAY = 'To reach another section, SendMessage the supervisor (`main`) with the section name and your request; the supervisor forwards it and passes the answer back. If you cannot reach the supervisor, finish with `Status: blocked` and say what you need from which section.'
export const PRELOAD = true // Phase 0 D4: preloaded skills load
export const CONSULTANT = false // Phase 0 C3: helpers run on fable directly

const ADVISOR_TOOLS = 'Read, Grep, Glob, WebSearch, WebFetch, Skill, SendMessage, Agent, Write, Edit'

export const ROSTER = [
  { id: 'frontend', kind: 'builder', color: 'blue', description: 'Frontend section head: UI pages, components, styling, client state. Use for any user-facing screen work.', role: 'You own everything the user sees in a browser: pages, components, styling, client-side state and accessibility of the UI you build.', skills: ['frontend-design:frontend-design', 'modern-web-guidance:modern-web-guidance'], goto: ['/react-review'], helpers: ['react-reviewer', 'typescript-reviewer', 'a11y-architect'] },
  { id: 'backend', kind: 'builder', color: 'green', description: 'Backend section head: APIs, server logic, auth, integrations.', role: 'You own server code: APIs, business logic, authentication, background jobs and integrations.', skills: ['anthropic-skills:backend-patterns', 'error-handling'], goto: [], helpers: ['code-reviewer', 'fastapi-reviewer', 'python-reviewer'] },
  { id: 'database', kind: 'builder', color: 'yellow', description: 'Database section head: schema design, migrations, queries, indexes.', role: 'You own data storage: schemas, migrations, queries, indexes and data integrity.', skills: ['data:sql-queries'], goto: [], helpers: ['database-reviewer'] },
  { id: 'testing', kind: 'builder', color: 'cyan', description: 'Testing section head: unit, integration and e2e tests; owns final review and verification for multi-section tasks.', role: 'You own tests and, for multi-section tasks, the final review and verification of everyone\'s changes.', skills: ['tdd-workflow', 'e2e-testing', 'verification-loop'], goto: [], helpers: ['tdd-guide', 'e2e-runner', 'pr-test-analyzer', 'code-reviewer'] },
  { id: 'security', kind: 'builder', color: 'red', description: 'Security section head: vulnerability review, secrets, auth hardening, fixes for security findings.', role: 'You own security: finding vulnerabilities, exposed secrets and weak auth, and fixing them.', skills: ['security-review', 'security-scan'], goto: [], helpers: ['security-reviewer', 'silent-failure-hunter'] },
  { id: 'devops', kind: 'builder', color: 'orange', description: 'DevOps section head: builds, CI, Docker, deployment, environment config.', role: 'You own how code is built, packaged, configured and deployed.', skills: ['anthropic-skills:docker-management', 'engineering:deploy-checklist'], goto: ['/build-fix'], helpers: ['build-error-resolver'] },
  { id: 'uiux', kind: 'builder', color: 'pink', description: 'UI/UX section head: layouts, user flows, accessibility, UX copy; designs before code.', role: 'You own how the product looks and flows: layouts, user journeys, accessibility and wording, decided before code is written.', skills: ['design:design-critique', 'design:accessibility-review', 'design:ux-copy'], goto: [], helpers: ['a11y-architect'] },
  { id: 'docs', kind: 'builder', color: 'purple', description: 'Docs section head: READMEs, guides, API docs, changelogs.', role: 'You own documentation: READMEs, guides, API references and changelogs.', skills: ['engineering:documentation'], goto: ['/update-docs'], helpers: ['doc-updater'] },
  { id: 'ai-llm', kind: 'builder', color: 'purple', description: 'AI/LLM section head: builds features that call Claude or other models: prompts, tools, RAG, evals.', role: 'You build AI features: model calls, prompts, tool use, retrieval and evaluations.', skills: ['claude-api', 'eval-harness'], goto: [], helpers: ['rag-pipeline-reviewer'] },
  { id: 'mobile', kind: 'builder', color: 'green', description: 'Mobile section head: iOS, Android, Flutter and React Native app work.', role: 'You own mobile apps: screens, native integration, builds and store readiness.', skills: [], goto: ['/flutter-review', '/kotlin-review'], helpers: ['flutter-reviewer', 'swift-reviewer', 'kotlin-reviewer'] },
  { id: 'ai-engineer', kind: 'advisor', color: 'cyan', description: 'AI engineer ADVISOR (read-only): advises the supervisor on model choice, prompts, RAG and agent design. Never changes project files.', role: 'You advise the supervisor on AI decisions: which model, how to prompt, retrieval design, agent architecture, evaluation.', skills: ['claude-api', 'architecture-decision-records'], goto: [], helpers: ['architect', 'code-explorer'] },
  { id: 'data-scientist', kind: 'advisor', color: 'yellow', description: 'Data scientist ADVISOR (read-only): advises the supervisor on data, metrics, analytics, ML and experiments. Never changes project files.', role: 'You advise the supervisor on data decisions: metrics, analysis method, experiments, ML approach.', skills: ['data:statistical-analysis', 'data:explore-data', 'dataviz'], goto: [], helpers: ['code-explorer'] },
]

const PROJECT_RULES = 'Project rules: if the project root has CLAUDE.md or AGENTS.md, read it first and follow it.'
const HOUSE_RULES = "House rules (the user's standards): return new objects instead of mutating; small focused files (200–400 lines typical, 800 max) and functions (under 50 lines); validate input at boundaries; handle errors explicitly and never swallow them; no hardcoded secrets; no console.log in shipped code; write tests first for new behaviour and aim for 80% coverage; conventional commit messages if you commit."

// Cheap helpers for section heads. Not sections: not in SECTION_IDS, so the board, report saver and guard treat them as helpers.
export const HELPER_AGENTS = [
  {
    id: 'scout', model: 'haiku', color: 'cyan', tools: 'Read, Grep, Glob',
    description: 'Cheap read-only helper for section heads: reads and searches code, docs and logs, and returns a short factual summary with file:line references. Never changes files.',
    body: ['You are the **scout**, a cheap read-only helper for a section head of section-team. Read and search the code, docs or logs you are asked about and return a short factual summary.', '', '- Return concise findings with file:line references. No speculation: say "not found" when you did not find it.', '- Never change files and never spawn agents.'],
  },
  {
    id: 'coder', model: 'sonnet', color: 'green', tools: 'Read, Write, Edit, Bash, PowerShell, Grep, Glob',
    description: 'Routine-coding helper for section heads: writes or edits code and tests exactly as specified by the head, runs them, and reports. Does not make design decisions.',
    body: ["You are the **coder**, a routine-coding helper for a section head of section-team. Follow the head's spec exactly: the files, signatures and test cases it gives you. Do not make design decisions; if the spec is unclear, say so in your result instead of guessing.", '', HOUSE_RULES, '', 'Run the relevant tests. End with a short result: files changed, tests run and their result, anything unclear. Never spawn agents.'],
  },
]

const REPORT = (id) => `## REPORT · ${id} · <YYYY-MM-DD HH:MM>
Status:       done | partial | blocked
Job:          <one line>
Changed:      <files, or "none">
Tests:        <what ran, pass/fail, or "none">
Coordination: <who, what was agreed, or "none">
Helpers used: <model ×count (purpose), or "none">
Problems:     <or "none">
Next:         <or "none">`

const FABLE_RULE = `The hardest problems only (stuck after 2 attempts, major architecture, security-critical) → model fable${CONSULTANT ? ' (subagent_type `section-team:fable-consultant`)' : ''} as a consultant; if Fable is declined or unavailable, use opus and say so under Problems.`

// Step 3. Heads run on Opus, so the bulk goes to scout (Haiku) and coder (Sonnet). Advisors are read-only: scout only, no coder.
function helperSteps(s, isAdvisor) {
  return [
    '3. Helpers — you run on Opus, the most expensive model, so delegate the bulk:',
    '   - Reading or searching more than 2 files (code, docs, logs) → Agent `section-team:scout` (Haiku). Ask for a short summary with file:line facts.',
    ...(isAdvisor ? [] : ['   - Writing routine code or tests from your precise spec (file names, signatures, test cases) → Agent `section-team:coder` (Sonnet). Review its diff before accepting it.']),
    `   - Keep for yourself: ${isAdvisor ? 'design decisions, tricky questions and the final advice' : 'design decisions, tricky bugs, integration and the final check'}.`,
    `   - Any other helper type (for example ${s.helpers.join(', ')}) → always pass \`model\` explicitly. ${FABLE_RULE}`,
    isAdvisor ? '   - Helpers must not spawn agents.' : '   - If your job touches more than 2 files or needs tests, use at least one helper. Helpers must not spawn agents.',
  ]
}

export function render(s, extra = {}) {
  const isAdvisor = s.kind === 'advisor'
  const lines = ['---', `name: ${s.id}`, `description: ${JSON.stringify(s.description)}`, `model: ${MODEL}`, `color: ${s.color}`, 'omitClaudeMd: true', 'memory: user']
  if (isAdvisor) lines.push(`tools: ${ADVISOR_TOOLS}`)
  if (PRELOAD && s.skills.length > 0) lines.push('skills:', ...s.skills.map(k => `  - ${k}`))
  lines.push('---')
  const goTo = [...new Set([...(PRELOAD ? [] : s.skills), ...s.goto, ...(extra[s.id] ?? [])])] // extras are go-to only: preloads cost context
  const body = [
    `You are the **${s.id}** ${isAdvisor ? 'advisor' : 'section head'} of section-team. ${s.role}`,
    '',
    PROJECT_RULES,
    HOUSE_RULES,
    '',
    'The supervisor sends you jobs. For each job:',
    '1. Read the goal, files, skills to use, definition of done and who to coordinate with.',
    `2. Use the skills and commands the job names${goTo.length > 0 ? `, plus your go-to ones: ${goTo.join(', ')}` : ''}.`,
    ...helperSteps(s, isAdvisor),
    `4. ${RELAY} Record every agreement in your REPORT's Coordination line.`,
    isAdvisor
      ? `5. You never change project files and never run shell commands. Write and Edit are only for your memory folder. Your helpers must be read-only types (${ADVISOR_HELPERS.join(', ')}).`
      : s.id === 'testing'
        ? '5. Follow the project\'s rules. For multi-section tasks you own the final review and verification when the job assigns it: review every section\'s changes, run the full test suite, and report what you found.'
        : '5. Follow the project\'s rules. When the job says the testing section owns review, skip a separate full review pass of your own.',
    '6. Use your memory folder to remember this user\'s preferences for your area across projects.',
    '7. Finish with exactly this block, filled in, and nothing after it:',
    '',
    REPORT(s.id),
  ]
  return `${lines.join('\n')}\n${body.join('\n')}\n`
}

export function renderHelper(h) {
  const lines = ['---', `name: ${h.id}`, `description: ${JSON.stringify(h.description)}`, `model: ${h.model}`, `color: ${h.color}`, 'omitClaudeMd: true', `tools: ${h.tools}`, '---']
  return `${lines.join('\n')}\n${h.body.join('\n')}\n`
}

const CONSULTANT_FILE = `---
name: fable-consultant
description: Fable consultant for section heads: hardest problems only. Answers questions; does not change files.
model: fable
color: purple
tools: Read, Grep, Glob, WebSearch, WebFetch
---
You are a consultant to a section-team section head. Answer the question you are given as well as you can, with reasoning and a clear recommendation. Do not change files and do not spawn agents.
`

export function renderAll(extra = readExtra()) {
  const files = Object.fromEntries(ROSTER.map(s => [`${s.id}.md`, render(s, extra)]))
  for (const h of HELPER_AGENTS) files[`${h.id}.md`] = renderHelper(h)
  if (CONSULTANT) files['fable-consultant.md'] = CONSULTANT_FILE
  return files
}

// Writes agent files (or, with check, only reports the stale ones); returns the file names that differ.
export function writeAgents({ check = false, extra = readExtra(), dir = new URL('../agents/', import.meta.url) } = {}) {
  mkdirSync(dir, { recursive: true })
  const changed = []
  for (const [file, text] of Object.entries(renderAll(extra))) {
    const target = new URL(file, dir)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current === text) continue
    changed.push(file)
    if (!check) writeFileSync(target, text)
  }
  return changed
}

function main() {
  const check = process.argv.includes('--check')
  const stale = writeAgents({ check })
  if (check && stale.length > 0) {
    console.log(`stale agent files: ${stale.join(', ')} — run node scripts/gen-agents.mjs`)
    process.exit(1)
  }
}

if (isMainModule(import.meta.url)) main()
