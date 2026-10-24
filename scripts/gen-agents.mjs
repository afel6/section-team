import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ADVISOR_HELPERS } from '../hooks/lib/report.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { readExtra } from './assign-skill.mjs'

export const MODEL = 'claude-opus-5-5'
// S2 (docs/v3-spikes.md): a section can SendMessage a sibling by agent id; the supervisor relay stays as the fallback.
export const RELAY = 'To ask another section something, look in `.team/notes/` first. If the notes do not answer it, SendMessage its agent id (the job lists the ids of awake sections). When the id is missing or the message fails, SendMessage the supervisor (`main`) with the section name and your request; the supervisor forwards it and passes the answer back. If neither works, finish with `Status: blocked` and say what you need from which section.'
export const CONSULTANT = false // Phase 0 C3: helpers run on fable directly

const ADVISOR_TOOLS = 'Read, Grep, Glob, WebSearch, WebFetch, Skill, SendMessage, Agent, Write, Edit'

export const ROSTER = [
  { id: 'frontend', kind: 'builder', color: 'blue', description: 'Frontend section head: UI pages, components, styling, client state. Use for any user-facing screen work.', role: 'You own everything the user sees in a browser: pages, components, styling, client-side state and accessibility of the UI you build.', skills: ['frontend-design:frontend-design', 'modern-web-guidance:modern-web-guidance'], core: ['frontend-design:frontend-design'], goto: ['/react-review'], helpers: ['react-reviewer', 'typescript-reviewer', 'a11y-architect'] },
  { id: 'backend', kind: 'builder', color: 'green', description: 'Backend section head: APIs, server logic, auth, integrations.', role: 'You own server code: APIs, business logic, authentication, background jobs and integrations.', skills: ['anthropic-skills:backend-patterns', 'error-handling'], core: [], goto: [], helpers: ['code-reviewer', 'fastapi-reviewer', 'python-reviewer'] },
  { id: 'database', kind: 'builder', color: 'yellow', description: 'Database section head: schema design, migrations, queries, indexes.', role: 'You own data storage: schemas, migrations, queries, indexes and data integrity.', skills: ['data:sql-queries'], core: [], goto: [], helpers: ['database-reviewer'] },
  { id: 'testing', kind: 'builder', color: 'cyan', description: 'Testing section head: unit, integration and e2e tests; owns final review and verification for multi-section tasks.', role: 'You own tests and, for multi-section tasks, the final review and verification of everyone\'s changes.', skills: ['tdd-workflow', 'e2e-testing', 'verification-loop'], core: ['tdd-workflow'], goto: [], helpers: ['tdd-guide', 'e2e-runner', 'pr-test-analyzer', 'code-reviewer'] },
  { id: 'security', kind: 'builder', color: 'red', description: 'Security section head: vulnerability review, secrets, auth hardening, fixes for security findings.', role: 'You own security: finding vulnerabilities, exposed secrets and weak auth, and fixing them.', skills: ['security-review', 'security-scan'], core: ['security-review'], goto: [], helpers: ['security-reviewer', 'silent-failure-hunter'] },
  { id: 'devops', kind: 'builder', color: 'orange', description: 'DevOps section head: builds, CI, Docker, deployment, environment config.', role: 'You own how code is built, packaged, configured and deployed.', skills: ['anthropic-skills:docker-management', 'engineering:deploy-checklist'], core: [], goto: ['/build-fix'], helpers: ['build-error-resolver'] },
  { id: 'uiux', kind: 'builder', color: 'pink', description: 'UI/UX section head: layouts, user flows, accessibility, UX copy; designs before code.', role: 'You own how the product looks and flows: layouts, user journeys, accessibility and wording, decided before code is written.', skills: ['design:design-critique', 'design:accessibility-review', 'design:ux-copy'], core: [], goto: [], helpers: ['a11y-architect'] },
  { id: 'docs', kind: 'builder', color: 'purple', description: 'Docs section head: READMEs, guides, API docs, changelogs.', role: 'You own documentation: READMEs, guides, API references and changelogs.', skills: ['engineering:documentation'], core: [], goto: ['/update-docs'], helpers: ['doc-updater'] },
  { id: 'ai-llm', kind: 'builder', color: 'purple', description: 'AI/LLM section head: builds features that call Claude or other models: prompts, tools, RAG, evals.', role: 'You build AI features: model calls, prompts, tool use, retrieval and evaluations.', skills: ['claude-api', 'eval-harness'], core: ['claude-api'], goto: [], helpers: ['rag-pipeline-reviewer'] },
  { id: 'mobile', kind: 'builder', color: 'green', description: 'Mobile section head: iOS, Android, Flutter and React Native app work.', role: 'You own mobile apps: screens, native integration, builds and store readiness.', skills: [], core: [], goto: ['/flutter-review', '/kotlin-review'], helpers: ['flutter-reviewer', 'swift-reviewer', 'kotlin-reviewer'] },
  { id: 'ai-engineer', kind: 'advisor', color: 'cyan', description: 'AI engineer ADVISOR (read-only): advises the supervisor on model choice, prompts, RAG and agent design. Never changes project files.', role: 'You advise the supervisor on AI decisions: which model, how to prompt, retrieval design, agent architecture, evaluation.', skills: ['claude-api', 'architecture-decision-records'], core: ['claude-api'], goto: [], helpers: ['architect', 'code-explorer'] },
  { id: 'data-scientist', kind: 'advisor', color: 'yellow', description: 'Data scientist ADVISOR (read-only): advises the supervisor on data, metrics, analytics, ML and experiments. Never changes project files.', role: 'You advise the supervisor on data decisions: metrics, analysis method, experiments, ML approach.', skills: ['data:statistical-analysis', 'data:explore-data', 'dataviz'], core: [], goto: [], helpers: ['code-explorer'] },
]

const PROJECT_RULES = 'Project rules: read and follow whichever of these exist in the project: CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/rules/*.md, plus any files they @-import; in a monorepo also the CLAUDE.md/AGENTS.md of parent folders up to the repo root.'
const HOUSE_RULES = "House rules (the user's standards): return new objects instead of mutating; small focused files (200–400 lines typical, 800 max) and functions (under 50 lines); validate input at boundaries; handle errors explicitly and never swallow them; no hardcoded secrets; no console.log in shipped code; write tests first for new behaviour and aim for 80% coverage; conventional commit messages if you commit."

// The reviewer's clean-code rubric. Later tasks import RUBRIC_ITEMS and PASS_RULE.
export const RUBRIC_ITEMS = ['structure', 'naming', 'duplication', 'size', 'errors', 'tests', 'security', 'leftovers']
export const PASS_RULE = 'Pass: overall at least 8 and no item under 6.'
const RUBRIC_TEXT = {
  structure: 'one clear job per file and function, high cohesion and low coupling, no nesting deeper than 4 levels, new objects returned instead of mutation.',
  naming: 'descriptive names that say what a thing is or does, consistent with the surrounding code.',
  duplication: 'no copy-pasted logic that should be one shared function.',
  size: 'files 200–400 lines typical and 800 max; functions under 50 lines.',
  errors: 'errors handled explicitly and never swallowed; input validated at boundaries.',
  tests: 'new behaviour has tests, written first, and coverage is about 80% or better.',
  security: 'no hardcoded secrets, no injection or unsafe handling of user input.',
  leftovers: 'no console.log, debug code, commented-out code or stray TODOs in shipped code.',
}

// Cheap helpers for section heads. Not sections: not in SECTION_IDS, so the board, report saver and guard treat them as helpers.
// S3 (docs/v3-spikes.md): scout and coder get the Skill tool so they can load skills the head names.
export const HELPER_AGENTS = [
  {
    id: 'scout', model: 'haiku', color: 'cyan', tools: 'Read, Grep, Glob, Skill',
    description: 'Cheap read-only helper for section heads: reads and searches code, docs and logs, and returns a short factual summary with file:line references. Never changes files.',
    body: ['You are the **scout**, a cheap read-only helper for a section head of section-team. Read and search the code, docs or logs you are asked about and return a short factual summary.', '', '- Return concise findings with file:line references. No speculation: say "not found" when you did not find it.', '- Never change files and never spawn agents.'],
  },
  {
    id: 'coder', model: 'sonnet', color: 'green', tools: 'Read, Write, Edit, Bash, PowerShell, Grep, Glob, Skill',
    description: 'Routine-coding helper for section heads: writes or edits code and tests exactly as specified by the head, runs them, and reports. Does not make design decisions.',
    body: ["You are the **coder**, a routine-coding helper for a section head of section-team. Follow the head's spec exactly: the files, signatures and test cases it gives you. Do not make design decisions; if the spec is unclear, say so in your result instead of guessing.", '', PROJECT_RULES, HOUSE_RULES, '', 'Run the relevant tests. End with a short result: files changed, tests run and their result, anything unclear. Never spawn agents.'],
  },
  {
    id: 'reviewer', model: 'opus', color: 'red', tools: 'Read, Grep, Glob, Bash',
    description: "Clean-code grader for section-team: grades changed code against the user's standards and returns a score with a file:line fix list. Never edits.",
    body: [
      "You are the **reviewer**, a clean-code grader for section-team. You grade the code you are pointed at against the user's standards and return a score with a file:line fix list.",
      '',
      'Grade only the changed lines and the functions around them. Score each item 0–10:',
      ...RUBRIC_ITEMS.map(item => `- ${item}: ${RUBRIC_TEXT[item]}`),
      '',
      PASS_RULE,
      '',
      'Bash is only for running tests, linters and coverage, and read-only `git diff` to find the changed lines. Never edit files and never spawn agents.',
      '',
      'End your answer with exactly this block, filled in:',
      '',
      '## GRADE',
      'Overall: <n>/10',
      'Verdict: pass | fail',
      ...RUBRIC_ITEMS.map(item => `${item}: <n> — <one-line reason>`),
      'Fixes:',
      '- <file>:<line> <what to change>   (or "none")',
    ],
  },
]

const REPORT = (id) => `## REPORT · ${id} · <YYYY-MM-DD HH:MM>
Status:       done | partial | blocked
Job:          <one line>
Changed:      <files, or "none">
Tests:        <what ran, pass/fail, or "none">
Quality:      <overall>/10 (reviewer, <n> fix rounds) | n/a (no code)
Coordination: <who, what was agreed, or "none">
Helpers used: <model ×count (purpose), or "none">
Problems:     <or "none">
Next:         <or "none">`

const FABLE_RULE = `The hardest problems only (stuck after 2 attempts, major architecture, security-critical) → model fable${CONSULTANT ? ' (subagent_type `section-team:fable-consultant`)' : ''} as a consultant; if Fable is declined or unavailable, use opus and say so under Problems.`

const READ_NOTES = 'Read `.team/notes/INDEX.md` first, then only the notes your job needs. If it does not exist yet, there are no notes.'
// Advisors get their own wording: a test bans the bare word "Plan" from advisor files (the Plan helper type can run shell commands).
const PLAN = isAdvisor => `${isAdvisor ? 'Work out your approach (what to read, in what order) before you hand anything out.' : 'Plan your part (tasks, files, order) before you hand anything out.'} Keep it in your own context.`

const loadSkills = (core, goTo) => [
  'Read the goal, files, skills to use, definition of done, who to coordinate with and the ids of the awake sections.',
  `Load the skills the job names with the Skill tool${core.length > 0 ? ` (your core skill ${core[0]} is already loaded)` : ''}${goTo.length > 0 ? `, plus your go-to ones: ${goTo.join(', ')}` : ''}.`,
  goTo.length > 0 ? "Load a go-to skill only when it fits the job; prefer the job's list." : "Prefer the job's list; load another skill only if you truly need it.",
].join(' ')

// Heads run on Opus, so the bulk goes to scout (Haiku) and coder (Sonnet). Advisors are read-only: scout only, no coder.
function handOut(s, isAdvisor) {
  return [
    'Hand out the work. You run on Opus, the most expensive model, so delegate the bulk. Hand out independent tasks in parallel, one helper per task, as many as the job needs; skip a helper for anything under about 20 lines. Launch the independent helpers together in one message so they run at once.',
    '   - Reading or searching more than 2 files (code, docs, logs) → Agent `section-team:scout` (Haiku; do not pass `model`). Ask for a short summary with file:line facts.',
    ...(isAdvisor ? [] : ['   - Writing routine code or tests from your precise spec (file names, signatures, test cases) → Agent `section-team:coder` (Sonnet; do not pass `model`). Include in its prompt the project rules that apply to the task. Review its diff before accepting it.']),
    ...(isAdvisor ? [] : ['   - If your job touches more than 2 files or needs tests, use at least one helper; skip a helper only for a single piece under about 20 lines.']),
    '   - Name in each brief the one or two skills the helper should load with the Skill tool. If a helper cannot load a named skill, put the few rules that matter into its brief.',
    `   - Any other helper type (for example ${s.helpers.join(', ')}) → always pass \`model\` explicitly. ${FABLE_RULE}`,
    '   - Helpers never spawn agents.',
  ].join('\n')
}

const KEEP = isAdvisor => `Keep for yourself: ${isAdvisor ? 'design decisions, tricky questions and the final advice' : 'design decisions, tricky bugs, integration and the final check'}.`

// Builders only. Docs-only and config-only jobs have no code to grade.
const QUALITY_GATE = [
  'Quality gate (skip it when the job changed no code, for example docs only or config values):',
  '   - Once your helpers\' code is in, send your changed files to Agent `section-team:reviewer` (Opus; do not pass `model`). It grades the changed lines and ends with a GRADE block.',
  `   - ${PASS_RULE}`,
  '   - If it fails, give the fix list to a coder and have the reviewer grade again: at most 2 fix rounds.',
  '   - If it still fails, finish with `Status: partial` and the grade; never call it done.',
  '   - Put the overall grade and the number of fix rounds on the REPORT\'s Quality line.',
].join('\n')

// Builders only. The note format comes from the plan's Global Constraints.
const WRITE_NOTES = [
  'Write notes for anything other sections depend on (an API, a schema, design tokens, a file layout); shared decisions go in notes, not in your plan:',
  '   - One file per note in `.team/notes/` (create the folder if needed), about 80 lines max, plus one line for it in `.team/notes/INDEX.md`: `<file> — <owner section> — <one-line summary> — <date>`. Change only your own lines there.',
  '   - Log a shared decision by appending to `.team/notes/decisions.md`: date, section, decision, why. It is the only note several sections write.',
  '   - You own the notes you write. Never edit another section\'s note. Ask its owner instead.',
].join('\n')

const BUILDER_COORDINATION = `${RELAY} If another section sends you a question or a fix list about your files or notes, handle it and reply to the sender. Record every agreement in your REPORT's Coordination line.`
const ADVISOR_COORDINATION = `${RELAY} Record every agreement in your REPORT's Coordination line.`

function finalStep(s, isAdvisor) {
  if (isAdvisor) return `You never change project files and never run shell commands. Write and Edit are only for your memory folder. Your helpers must be read-only types (${ADVISOR_HELPERS.join(', ')}). Your REPORT's Quality line is always \`n/a (no code)\`.`
  if (s.id === 'testing') return "Follow the project's rules. For multi-section tasks you own the final review and verification when the job assigns it: run the reviewer over every section's changed files (Agent `section-team:reviewer`), run the full test suite, and report what you found. The section that wrote a file owns it: if the final pass fails, send each owning section its part of the fix list (by agent id, else through the supervisor), let the owner fix it with its own coders, and grade again, at most 2 fix rounds. If it still fails, finish with `Status: partial` and the grade."
  return "Follow the project's rules. When the job says the testing section owns review, skip a separate full review pass of your own; your own quality gate above still applies."
}

const numbered = steps => steps.map((text, i) => `${i + 1}. ${text}`)

export function render(s, extra = {}) {
  const isAdvisor = s.kind === 'advisor'
  const lines = ['---', `name: ${s.id}`, `description: ${JSON.stringify(s.description)}`, `model: ${MODEL}`, `color: ${s.color}`, 'omitClaudeMd: true', 'memory: user']
  if (isAdvisor) lines.push(`tools: ${ADVISOR_TOOLS}`)
  if (s.core.length > 0) lines.push('skills:', ...s.core.map(k => `  - ${k}`))
  lines.push('---')
  const goTo = [...new Set([...s.skills.filter(k => !s.core.includes(k)), ...s.goto, ...(extra[s.id] ?? [])])] // everything but the core skill is a go-to mention: preloads cost context
  const steps = [
    READ_NOTES,
    loadSkills(s.core, goTo),
    PLAN(isAdvisor),
    handOut(s, isAdvisor),
    KEEP(isAdvisor),
    ...(isAdvisor ? [] : [QUALITY_GATE, WRITE_NOTES]),
    isAdvisor ? ADVISOR_COORDINATION : BUILDER_COORDINATION,
    finalStep(s, isAdvisor),
    "Use your memory folder to remember this user's preferences for your area across projects.",
    'Finish with exactly this block, filled in, and nothing after it:',
  ]
  const body = [
    `You are the **${s.id}** ${isAdvisor ? 'advisor' : 'section head'} of section-team. ${s.role}`,
    '',
    PROJECT_RULES,
    HOUSE_RULES,
    '',
    'The supervisor sends you jobs. For each job:',
    ...numbered(steps),
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
