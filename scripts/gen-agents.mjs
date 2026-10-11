import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  { id: 'ai-engineer', kind: 'advisor', color: 'cyan', description: 'AI engineer ADVISOR (read-only): advises the supervisor on model choice, prompts, RAG and agent design. Never changes project files.', role: 'You advise the supervisor on AI decisions: which model, how to prompt, retrieval design, agent architecture, evaluation.', skills: ['claude-api', 'council', 'architecture-decision-records'], goto: [], helpers: ['architect', 'Explore'] },
  { id: 'data-scientist', kind: 'advisor', color: 'yellow', description: 'Data scientist ADVISOR (read-only): advises the supervisor on data, metrics, analytics, ML and experiments. Never changes project files.', role: 'You advise the supervisor on data decisions: metrics, analysis method, experiments, ML approach.', skills: ['data:statistical-analysis', 'data:explore-data', 'dataviz'], goto: [], helpers: ['Explore'] },
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

export function render(s) {
  const isAdvisor = s.kind === 'advisor'
  const lines = ['---', `name: ${s.id}`, `description: ${JSON.stringify(s.description)}`, `model: ${MODEL}`, `color: ${s.color}`, 'memory: user']
  if (isAdvisor) lines.push(`tools: ${ADVISOR_TOOLS}`)
  if (PRELOAD && s.skills.length > 0) lines.push('skills:', ...s.skills.map(k => `  - ${k}`))
  lines.push('---')
  const goTo = [...(PRELOAD ? [] : s.skills), ...s.goto]
  const body = [
    `You are the **${s.id}** ${isAdvisor ? 'advisor' : 'section head'} of section-team. ${s.role}`,
    '',
    'The supervisor sends you jobs. For each job:',
    '1. Read the goal, files, skills to use, definition of done and who to coordinate with.',
    `2. Use the skills and commands the job names${goTo.length > 0 ? `, plus your go-to ones: ${goTo.join(', ')}` : ''}.`,
    `3. Helpers: delegate with the Agent tool and ALWAYS pass \`model\` explicitly — haiku for lookups, file search, formatting and mechanical edits; sonnet for routine code, tests and standard reviews; opus for tricky bugs and design calls; fable${CONSULTANT ? ' (subagent_type `section-team:fable-consultant`)' : ''} as a consultant only for the hardest problems (stuck after 2 attempts, major architecture, security-critical reasoning). If Fable is declined or unavailable, use opus and say so under Problems. Suggested helper types: ${s.helpers.join(', ')}. Tell every helper it must not spawn agents. Check helper output, merge it, and own the result.`,
    `4. ${RELAY} Record every agreement in your REPORT's Coordination line.`,
    isAdvisor
      ? '5. You never change project files and never run shell commands. Write and Edit are only for your memory folder. Your helpers must be read-only types (Explore, Plan, architect).'
      : '5. Follow the project\'s rules. When the job says the testing section owns review, skip a separate full review pass of your own.',
    '6. Use your memory folder to remember this user\'s preferences for your area across projects.',
    '7. Finish with exactly this block, filled in, and nothing after it:',
    '',
    REPORT(s.id),
  ]
  return `${lines.join('\n')}\n${body.join('\n')}\n`
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

export function renderAll() {
  const files = Object.fromEntries(ROSTER.map(s => [`${s.id}.md`, render(s)]))
  if (CONSULTANT) files['fable-consultant.md'] = CONSULTANT_FILE
  return files
}

function main() {
  const dir = new URL('../agents/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  const isCheck = process.argv.includes('--check')
  let stale = []
  for (const [file, text] of Object.entries(renderAll())) {
    const target = new URL(file, dir)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current === text) continue
    if (isCheck) stale.push(file)
    else writeFileSync(target, text)
  }
  if (isCheck && stale.length > 0) {
    console.log(`stale agent files: ${stale.join(', ')} — run node scripts/gen-agents.mjs`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
