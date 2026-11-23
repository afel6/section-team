import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MODE_LABELS } from '../hooks/lib/mode.mjs'
import { HEAD_CONTEXT_LIMIT } from '../hooks/lib/head-context.mjs'
import { userExtraFile } from '../scripts/assign-skill.mjs'
import { MODEL } from '../scripts/gen-agents.mjs'

const CLAIM_WORDS = /\b(sav(?:e|es|ed|ing|ings)|cheaper|cuts? cost|half|better code|higher quality|better quality|improv(?:es|ed)|reduces|lower cost|costs? less|much less|fewer tokens)\b|\d\s*%/i

const DISCLAIMED = /\b(?:not|never|none|no|isn['’]t)\b(?: \w+){0,3} measured|unmeasured/i

const STALE_COST_MULTIPLE = /(?<![\d.])3\.6\s*(times|×|x)/i

const assertIncludes = (text, needles, label) => {
  for (const needle of needles) assert.ok(text.includes(needle), `${label} missing ${needle}`)
}

// Sentences that make a saving or quality claim without saying it is unmeasured.
const claimSentences = text => text.split(/(?<=[.!?])\s+|\n/).filter(s => CLAIM_WORDS.test(s) && !DISCLAIMED.test(s))

// The round-by-round results moved out of the README into this file.
const RESULTS_DOC = 'docs/benchmark-p1-hq-fx-2026-11.md'

// The solo baseline of rounds 1-17, the held-out round and the p1 rounds on the main test machine; the mode round's was plain Claude Code.
const BASELINE = "Claude Code with the author's setup (plugin off; their CLAUDE.md and other plugins on)"
// The solo row label of rounds whose machine setup was not recorded (hq, fx and the second machine's p1 rounds).
const UNRECORDED = 'Solo (plugin off; machine setup not recorded)'
const FABLE_NOTE = 'Fable also planned and reviewed some of the fixes it judged.'
// The README's Platform readiness section moved here.
const LONG_DOC = 'docs/long-sessions.md'
// The README's routing, report, Max, mode-file, board and section details moved here.
const HOW_DOC = 'docs/how-it-works.md'
// The README's length target.
const README_MAX_WORDS = 3000
const wordsOf = text => text.split(/\s+/).filter(word => word !== '').length

const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8').replaceAll('\r\n', '\n')

test('the claim check catches claim words and accepts a disclaimed sentence', () => {
  for (const claim of ['It will save money.', 'Tokens were saved.', 'Quality improved.', 'It reduces the bill.', 'You get lower cost.', 'You get better quality.', 'It uses much less.']) {
    assert.equal(claimSentences(claim).length, 1, `not caught: ${claim}`)
  }
  assert.deepEqual(claimSentences('Any saving in real use has not been measured.'), [])
  assert.deepEqual(claimSentences('Saving is unmeasured.'), [])
  for (const ok of ['The saving is never measured.', 'No saving was measured.', 'The saving is not yet measured.', 'The saving: none measured.', 'The saving isn’t measured.', "The saving isn't measured."]) {
    assert.deepEqual(claimSentences(ok), [], `not accepted: ${ok}`)
  }
})

test('the stale cost multiple pattern matches 3.6 times, 3.6× and 3.6x but not 13.6 times', () => {
  for (const stale of ['3.6 times', '3.6×', '3.6x']) assert.ok(STALE_COST_MULTIPLE.test(stale), `not caught: ${stale}`)
  assert.ok(!STALE_COST_MULTIPLE.test('13.6 times'))
})

test('the README opens with the cost and the gain, and the results doc keeps the measured cost ranges and the round 17 label', () => {
  const readme = read('README.md')
  const results = read(RESULTS_DOC)
  for (const text of [readme, results]) assert.ok(!STALE_COST_MULTIPLE.test(text), 'no stale 3.6 multiple')
  const quickstart = readme.split('\n## Quickstart\n')[1].split('\n## ')[0]
  assertIncludes(quickstart, ['about 5× your normal Claude Code usage in Balanced', 'about 10× in Max, up to 13× on platform-sized tasks', 'blind judges scored the plugin\'s code higher, the largest part (42-44% in the mode round) for bigger test suites', '/plugin install section-team --marketplace afel6/section-team', '/team mode off', 'claude plugin disable section-team@section-team', 'claude plugin uninstall section-team@section-team'], 'Quickstart')
  assertIncludes(readme, ['Lean, the third, was removed in 0.3.0', 'Measured on v0.2.1'], 'README')
  const needles = ['about 2.2 to 5.2 times', 'about 7.5 to 9.7 times in Max', 'section-team (round 17)', 'with tests the largest part of the gap (42 to 44% in the mode round)', 'depending on the tasks and the setup', 'mode round only', 'Lean 4.5, Balanced 7.0 and Max 13.4 times plain Claude Code', "plugin off, author's setup"]
  assertIncludes(results, needles, 'results doc')
  assert.ok(!readme.includes('cleaner, better-tested and more robust'))
})

test('the README mode table shows the picker labels, with no measured date', () => {
  const readme = read('README.md')
  for (const mode of ['balanced', 'max']) assert.ok(readme.includes(`| ${MODE_LABELS[mode]} |`), mode)
  assert.ok(!readme.includes('(measured 2026-11)'), 'no date in a label')
})

test('the long-sessions doc says the docs section and final review apply in every mode', () => {
  assert.ok(read(LONG_DOC).includes('In every mode the docs section comes after the builders report, and the final review starts the app and drives the critical flows'))
})

test('the README points to the long-sessions doc, which keeps the Platform readiness text', () => {
  const readme = read('README.md')
  assertIncludes(section(readme, 'Platform readiness (0.2.3)'), ['[docs/long-sessions.md](docs/long-sessions.md)'], 'README pointer')
  assert.ok(section(readme, 'Platform readiness (0.2.3)').trim().split('\n').length <= 2, 'the pointer is short')
  assert.ok(!readme.includes('**Context guard.**'), 'the details left the README')
  assert.ok(read(LONG_DOC).includes('\n## Platform readiness (0.2.3)\n'), 'heading kept in the doc')
})

test('the long-sessions doc describes the foundation skill, fresh sections and the guard, and what is not measured', () => {
  const readme = read(LONG_DOC)
  assert.ok(read('README.md').includes('testing, docs, the security pass and advisors not counted'), 'README Use keeps the plan-first count')
  assertIncludes(readme, [
    // fresh sections and the shorter tool list
    'section-team:foundation', 'fresh Agent call', `${HEAD_CONTEXT_LIMIT.toLocaleString('en-US')} tokens`, 'builder heads have no project MCP servers', 'they use a CLI, or ask the supervisor',
    // what is measured, and what is not
    'Not measured yet', 'one-off replay of private local transcripts', 'replay itself is not in this repo', '71.8K tokens', '40.0K by default', '32.9K', 'one PC', '24.7K', 'where the difference is large',
    'any saving in real use',
    // brief rules and the foundation trigger
    "Max's security pass is unchanged", 'In Balanced, multi-area work touching auth, payments, uploads or secrets also wakes the security section', 'The p1 rounds ran the brief rules live, and from 0.3.0 on the foundation skill too', 'the grade check and the two-stage harness', 'a new platform or product with two or more builder areas', 'other work with 3 or more builders keeps the short plan',
    // Plan H: the node-http skill, and Max's complex single-area work
    'section-team:node-http', 'In Max, a single-area task with new concurrent writes, protocol framing, auth or crypto also loads it',
    '0.2.3',
  ], 'long-sessions doc')
  assert.ok(!readme.includes('nor its figures') && !readme.includes('the saving in real use'), 'stale unmeasured wording is gone')
  assert.ok(!readme.includes('any work needing 3 or more builders'), 'the foundation skill no longer covers any 3-builder work')
  assert.ok(!readme.includes('the foundation skill and the brief rules have not been run live'), 'the p1 rounds ran them live')
  assert.ok(readme.includes('## Platform readiness'), 'Platform readiness heading missing')
  const claims = readme.split('## Platform readiness')[1]
  assert.deepEqual(claimSentences(claims), [], 'no saving or quality claim before the runs')
})

test('the how-it-works doc describes the saved request, the short hand-back, the resume brief and the Max flow command, with the measured peak', () => {
  const readme = read(HOW_DOC)
  assertIncludes(readme, [
    "Before it says done, the supervisor runs the testing section's one command that prints a PASS or FAIL line per critical flow.",
    'any message you send of 3000 characters or more is saved, with recognised secrets replaced by `[redacted]`, to `.team/reports/<date>/<time>-user-request.md` inside a git repo whose `.team/` folder git ignores',
    'so the supervisor points sections to it instead of re-typing it',
    'in a `-details.md` file there and keep at most 5 short lines above their REPORT',
    'a builder hand-back that claims done with more than 1200 characters above its REPORT is refused (partial, blocked and ungraded are not',
    'A resumed session gets the brief again only when it changed since the session started.',
    "In the p1 measure round the supervisor's chat peaked at 99K to 104K in Balanced and 116K to 123K in Max, against 158K to 168K for solo.",
  ], 'how-it-works doc')
  for (const path of ['README.md', HOW_DOC]) assert.ok(!read(path).includes('the supervisor starts the app itself and drives every critical flow'), `${path}: the old Max flow sentence is gone`)
})

test('the README records the p1 confirm round with its numbers and what is not measured', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**A p1 confirm round (0.3.0, 2026-11-10).**',
    `| ${BASELINE} | $3.53 | 1.0 | 264 | 7.0 | 0 of 4 | 27 min | 149K to 152K |`,
    '| **Balanced (default)** | $17.45 | 4.9 | 262.5 | 8.0 | 0 of 4 | 34 min | 95K to 98K |',
    '| Max | $37.37 | 10.6 | 261 | 8.75 | 4 of 4 | 54 min | 137K to 139K |',
    'Missed: Balanced judged 1.0 above solo again, not 1.5',
    "`new TextDecoder('utf-8')`, which drops a leading byte order mark",
    "Commits 27db531, 44f5d45 and 68ffecb fix these in the sections' rules; the measure round below tests them.",
  ], 'results doc')
  assert.ok(!readme.includes('Their effect on usage is not measured yet.'), 'the unmeasured-usage sentence is gone')
})

test('the README records the p1 measure round with both judges and what is not measured', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**A p1 measure round (0.3.0, 2026-11-11).**',
    `| ${BASELINE} | $4.03 | 1.0 | 264 | 7.0 | 7.0 | 0 of 4 | 8 min | 158K to 168K |`,
    '| **Balanced (default)** | $18.95 | 4.7 | 264 | 8.5 | 9.0 | 2 of 4 | 43 min | 99K to 104K |',
    '| Max | $32.96 | 8.2 | 264 | 8.5 | 8.25 | 2 of 4 | 52 min | 116K to 123K |',
    'Missed: Max judged level with Balanced by Codex and 0.75 below it by Fable, not 0.25 above.',
    'Commit 77edf80 keeps the answer after such a call',
    'checked its Node claims with probes; round tg below measured it.',
  ], 'results doc')
  assert.ok(!readme.includes("fix these in the sections' rules; not measured yet."), 'the confirm round fixes are measured now')
  assert.ok(!readme.includes('checked its Node claims with probes; not measured yet.'), '77edf80 is measured now')
})

test('the README records the p1 rounds tg to ph with both judges, what each measured and what was missed', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**The p1 rounds after the measure round (2026-11-11 to 2026-11-18).**',
    'Rounds tg, th, ti, tj, tk, tl and to ran on the main test machine (16 GB)',
    '| tg, 2026-11-11 | 80ab45a |',
    '| 3.7 | 8.6 | 7.50 / 8.75 / 9.00 | 6.00 / 8.50 / 9.00 | Balanced 1.25 above solo on Codex |',
    "| tk, 2026-11-16 | 70969f0 | nothing: Claude Code's own advisor tool, switched on in the test machine's user settings, reached four runs, so the round was not judged |",
    '| ph, 2026-11-18 | 8713aa3 |',
    'meeting the 1.5 bar on both judges in ti, tj, to and ph; Max was never below Balanced on either judge.',
    '**Round ph in detail (after the 0.3.0 release, 2026-11-18).**',
    `| ${UNRECORDED} | $3.62 | 1.0 | 264 | 7.25 | 6.75 | 0 / 0 of 4 | 9 min | 135K to 145K |`,
    '| **Balanced (default)** | $17.13 | 4.7 | 264 | 8.75 | 8.75 | 1 / 1 of 4 | 36 min | 79K to 88K |',
    '| Max | $36.94 | 10.2 | 264 | 9.25 | 8.75 | 3 / 3 of 4 | 71 min | 114K to 134K |',
    'Not met as written:',
    'this is kept as designed.',
    'None of the judges\' points against the team builds was a missed target.',
    'Codex found both Balanced builds sending a model URL written with other than two slashes before the host to the wrong path',
    "and Node's bare 400 instead of the spec's 405 or 404 for methods Node refuses (CONNECT got no reply at all)",
  ], 'results doc')
  assert.ok(!readme.includes('design weight, not failed spec lines'), 'team defects are not called design weight')
  assert.ok(!readme.includes('Rounds tg to to ran'), 'round names are listed, not "tg to to"')
})

test('the results doc records round hq with both judges and its missed targets', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**A held-out round on three other tasks (hq, 2026-11-19).**',
    `| ${UNRECORDED} | $11.20 | 1.0 | 25 / 47 / 146 | 7.92 | 7.17 | 0 / 0 of 12 | up to 140K |`,
    '| **Balanced (default)** | $58.10 | 5.2 | 25 / 47 / 147 | 8.58 | 8.50 | 0 / 0 of 12 | up to 103K |',
    '| Max | $117.47 | 10.5 | 25 / 47 / 148 | 9.42 | 9.00 | 12 / 12 of 12 | up to 125K |',
    'Missed: Balanced judged 1.33 above solo by Fable but 0.67 by Codex, under the 1.0 bar',
    'Balanced cost 5.2× solo over the three tasks, over 5×',
    'commit 2003125 has it written in place, not measured yet',
  ], 'results doc')
})

test('the README records round fx: the Balanced test-gap fix missed its bar and does not ship', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**A check of one Balanced fix on three new tasks (fx, 2026-11-20).**',
    'Codex 7.83 / 9.08 / 9.08, Fable 6.58 / 8.58 / 8.33',
    '2.93× solo and 1.02× Balanced without it',
    'so the fix does not ship',
  ], 'results doc')
})

test('the README Modes section keeps the p1 and h7 cost ranges, and labels Max on platform work as reported only', () => {
  const modes = read('README.md').split('\n## Modes\n')[1].split('\n## ')[0]
  assertIncludes(modes, [
    'in rounds tg to ph Balanced cost 3.4 to 6.0 times and Max 8.4 to 13.0 times solo',
    'Reported only: on hq (2 runs) Max ranked first; in the published p1 data Max led Balanced by 0 to +0.75 at 1.4 to 2.7× its cost and scored below it in pr and tf.',
  ], 'Modes section')
})

test('the results doc links every published round with its recompute command, and the h7 overlap with p1', () => {
  const results = read(RESULTS_DOC)
  assertIncludes(results, [
    'node bench/data/p1/recompute.mjs', 'node bench/data/p1/recompute.mjs ph py', 'node bench/data/hq/recompute.mjs', 'node bench/data/fx/recompute.mjs',
    '[`bench/data/hq/`](../bench/data/hq/)', '[`bench/data/fx/`](../bench/data/fx/)', 'not publicly pre-registered', 'h7 is not fully held out',
    'a reported rescore, not published',
  ], 'results doc')
  assert.ok(!results.includes('raw data not published'), 'every round in the doc now has its raw data')
  const readme = read('README.md')
  assertIncludes(readme, ['[`bench/data/p1/`](bench/data/p1/)', '[`bench/data/hq/`](bench/data/hq/)', '[`bench/data/fx/`](bench/data/fx/)', 'shares a requirement word for word with p1'], 'README')
  assert.ok(!readme.includes('raw data not published'), 'README: every listed round has its raw data')
})

// Round tg: the second Max final review reads the code instead of probing again, and slices that share nothing are built side by side.
test('the docs say the second Max final review reads the code, and slices that share nothing are built side by side', () => {
  assert.ok(read('README.md').includes("(the second is not shown the first's REPORT; it reads the code against the spec instead of probing again)"), 'README Max row')
  const doc = read(LONG_DOC)
  assert.ok(doc.includes('then builds one slice at a time, or slices that share nothing side by side, with a whole-stack check after each'), 'long-sessions doc')
  assert.ok(!doc.includes('then builds one slice at a time with a whole-stack check after each'), 'old foundation line')
})

test('the long-sessions doc says the guard refuses only finished heads, and what each caller is told', () => {
  const guard = read(LONG_DOC).split('**Context guard.**')[1].split('\n')[0]
  assert.ok(!guard.includes('Any message') && !guard.includes('not to each other'), 'a working head still takes messages')
  assertIncludes(guard, [
    'refuses only a section that has finished', 'still working takes messages',
    'A section or helper whose message is refused is sent to the supervisor (`main`), which starts a fresh section; the supervisor itself is told to start a fresh one pointed at the notes, its REPORT if it left one, and its changed files.',
    'its changed files',
  ], 'guard line')
})

// Real use, 2026-11-11: one process took all the memory of the machine three times; the plugin's guard stops such a run.
test('the README describes the memory guard under Use: what it stops, the limit, the variable, the log, the default and how to turn it off', () => {
  const use = read('README.md').split('\n## Use\n')[1].split('\n## ')[0]
  const guard = use.split('**Memory guard (opt-in).**')[1]?.split('\n')[0]
  assert.ok(guard, 'no Memory guard entry under Use')
  assertIncludes(guard, [
    'every 5 seconds', "the session's MCP servers", '`SECTION_TEAM_MEMORY_LIMIT_MB`', 'for example `12288` on a 16 GB machine', '`0` or a value that is not a whole number keeps it off',
    '`.team/tmp/memory-guard.log`', 'It is off by default on every platform',
  ], 'memory guard entry')
})

test('CONTRIBUTING makes no claim, explains --plugin-ref and lists the foundation skill and the new hook helpers', () => {
  const text = read('CONTRIBUTING.md')
  assert.deepEqual(claimSentences(text), [], 'no saving or quality claim in CONTRIBUTING')
  assertIncludes(text, [
    '--plugin-ref', 'names the ref the `--plugin` worktree must be at', 'v<SECTION_TEAM_VERSION>', 'leave the flag out or pass the same ref', 'expected version comes from the plugin under test',
    'skills/foundation/', 'skills/node-http/', 'hooks/lib/head-context.mjs', 'hooks/lib/grade.mjs',
  ], 'CONTRIBUTING')
  assert.ok(!text.includes('(now v0.2.1)'), 'no unpinned version number')
})

test('the README describes the office, walks, names and where names are saved', () => {
  const board = read('README.md').split('\n## Team Board\n')[1].split('\n## ')[0]
  assertIncludes(board, [
    '/team name <section> <name>', '`/team name <section>` gives back its default name', 'names.json', 'walks', 'strolls', 'advisors',
    'The terminal keeps the text board.',
  ], 'Team Board section')
})

test('the README lists every MCP grant in the agent files, and says no section gets the logged-in Chrome', () => {
  const readme = read('README.md')
  const agents = new URL('../agents/', import.meta.url)
  const grants = new Set()
  for (const file of readdirSync(agents)) {
    const tools = readFileSync(new URL(file, agents), 'utf8').match(/^tools: (.*)$/m)?.[1] ?? ''
    for (const tool of tools.split(', ')) if (tool.startsWith('mcp__')) grants.add(tool)
  }
  assert.ok(grants.size > 0, 'the agent files grant some MCP tools')
  for (const grant of grants) assert.ok(readme.includes(`\`${grant}\``), `README does not list ${grant}`)
  assert.ok(readme.includes('No section gets `mcp__claude-in-chrome__*`'))
})

test('the README says how to turn the team off in one project, and that it applies from the next session', () => {
  const modes = read('README.md').split('\n## Modes\n')[1].split('\n## ')[0]
  assertIncludes(modes, ['**Turn it off in one project:**', '`/team mode off`', '`{"mode": "off"}`', 'applies from your next session', 'no brief'], 'Modes section')
})

// The text under one ## heading of a markdown file, up to the next ## heading.
const section = (text, heading) => text.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? ''

// The value a source file gives a constant, read as text so the test runs no hook.
const sourceConst = (path, name) => read(path).match(new RegExp(`const ${name} = (.*)`))?.[1]

test('the Quickstart says what you get without overstating it, with the wall time', () => {
  const readme = read('README.md')
  const quickstart = section(readme, 'Quickstart')
  assertIncludes(quickstart, [
    'No meaningful correctness gain has been measured: hidden tests tied in most rounds, the plugin passed fewer in the first three p1 rounds, and at most 2 more of 148 on one hq task (2 runs).',
    "On seeded near-miss bugs (mode round) its suites caught about as many as solo's: 21 and 19 against 20 of 24 on h6, and all 18 on h5",
    'about 3 to 6× the wall time in Balanced and 6 to 12× in Max',
  ], 'Quickstart')
  for (const old of ['never came out ahead', 'mostly tests', 'mostly for its tests']) assert.ok(!readme.includes(old), `old sentence: ${old}`)
})

test('the Needs line at the Quickstart and at Install names the tested CLI, the alias floor, Node, git and the providers', () => {
  const readme = read('README.md')
  assertIncludes(section(readme, 'Install'), [
    '**Needs:** Claude Code 2.1.318 (tested; this release has not been run on an older one, and before 2.1.280 the `opus` alias did not mean Opus 5.5)',
    'Node 20.16+ or 22.3+ and git 2.31+ on PATH (without Node every prompt and matched tool call shows a hook error)',
    'first-party access to Opus 5.5 (Bedrock, Vertex and Foundry are untested; on Foundry the `opus` alias means Opus 4.6)',
  ], 'Install')
  assert.ok(section(readme, 'Quickstart').includes('**Needs:** Claude Code 2.1.318, Node 20.16+ or 22.3+, git 2.31+ and first-party access to Opus 5.5 ([details](#install))'), 'Quickstart')
  assert.ok(!readme.includes('2.1.275 or later'), 'the untested version floor is gone')
})

test('the README names the model aliases the agent files use, not a pinned Opus 5.5', () => {
  const readme = read('README.md')
  assert.equal(MODEL.builder, 'opus')
  assert.equal(MODEL.advisor, 'opus')
  assertIncludes(readme, ["Sections and the reviewer use the `opus` model alias (they follow your session's Opus version, or the alias default)", '(`opus` has meant Opus 5.5 since Claude Code 2.1.280)'], 'README')
  assert.ok(!readme.includes('sections and the reviewer run on Opus 5.5'), 'old pinned-model sentence')
})

test('What changes says sections skip the global CLAUDE.md, counted from the agent files', () => {
  const agents = new URL('../agents/', import.meta.url)
  const files = readdirSync(agents)
  const omitting = files.filter(file => /^omitClaudeMd: true$/m.test(readFileSync(new URL(file, agents), 'utf8')))
  assert.equal(omitting.length, files.length, 'every agent file omits the global CLAUDE.md')
  assert.ok(sourceConst('scripts/gen-agents.mjs', 'SAFETY').includes('never push, force-push, deploy'), "the builders' safety rule")
  assertIncludes(section(read('README.md'), 'What changes in your sessions'), [
    `**Sections skip your global \`~/.claude/CLAUDE.md\`** (\`omitClaudeMd\` in all ${files.length} agent files). Put rules you rely on in the project's CLAUDE.md or AGENTS.md. Builders carry their own rule: no push, force-push, deploy or destructive git without your yes.`,
  ], 'What changes')
})

test('the off wording says what still runs, when off applies, and how to try the plugin in one project', () => {
  const readme = read('README.md')
  assertIncludes(section(readme, 'What changes in your sessions'), [
    '**In a project set to off,** the hooks still start on every prompt and matched tool call (one git call per prompt) but do nothing for the supervisor',
    "a project's first session may already have written `.team/` and the exclude lines",
    'Off applies from your next session, `/clear` or `/compact`. To try the plugin in one project only, install it with `--scope local`.',
  ], 'What changes')
  assert.ok(!readme.includes('none of this happens except the strip'), 'old off sentence')
  for (const name of ['Install', 'Modes']) assert.ok(section(readme, name).includes('applies from your next session, `/clear` or `/compact`'), name)
})

test('the README says where skill assignments and trusted owners live, and how to restore them after an update', () => {
  const readme = read('README.md')
  assert.equal(userExtraFile('~').replaceAll('\\', '/'), '~/.claude/section-team/roster-extra.json')
  assert.ok(read('scripts/trusted-source.mjs').includes("'~/.claude/section-team/trusted-sources.json'"))
  assert.ok(read('scripts/assign-skill.mjs').includes('--reapply'))
  assertIncludes(readme, [
    '`~/.claude/section-team/roster-extra.json`', '`~/.claude/section-team/trusted-sources.json`',
    'after `claude plugin update`, run `node "<plugin root>/scripts/assign-skill.mjs" --reapply`',
  ], 'README')
  assert.ok(!readme.includes('are kept in `scripts/roster-extra.json`'), 'old assignment file')
  assert.ok(!readme.includes('one you listed in `skills/add-skill/trusted-sources.json`'), 'old trusted-owner file')
})

test('the README quotes the board-load line the prompt hook shows, and the off switch without the board', () => {
  const line = sourceConst('hooks/user-prompt-submit.mjs', 'BOARD_LINE')?.match(/^"(.*)"$/)?.[1]
  assert.ok(line, 'BOARD_LINE found in the hook')
  assertIncludes(section(read('README.md'), 'Team Board'), [line, 'tested on Claude Code 2.1.318', 'turn the team off with `{"mode": "off"}` in `.team/mode.json`'], 'Team Board')
})

test('the README says project settings that set the install switch, HOME or USERPROFILE keep installs off, in any letter case', () => {
  const readme = read('README.md')
  assert.ok(sourceConst('hooks/lib/project-settings.mjs', 'HOME_VARS').includes("['HOME', 'USERPROFILE']"))
  const line = "a project's `.claude/settings.json` or `settings.local.json` that sets this variable, `HOME` or `USERPROFILE` (a key in any letter case counts) keeps automatic installs off, with one line saying so"
  assert.ok(section(readme, 'Modes').includes(line), 'Modes')
  assert.ok(section(readme, 'What changes in your sessions').includes('Project settings that set it, `HOME` or `USERPROFILE` keep installs off'), 'What changes')
  for (const old of ['can set environment variables too, this one included', "a project's own `.claude/settings.json` can set it too"]) assert.ok(!readme.includes(old), `old sentence: ${old}`)
})

test('the README says a .team/ plan or last summary git does not ignore is not pointed to', () => {
  assert.ok(sourceConst('hooks/session-start.mjs', 'TEAM_UNIGNORED_LINE').includes('the project is not in git; its plan and last summary were not loaded as instructions'))
  assert.ok(section(read('README.md'), 'Use').includes(
    'In a project outside git, or one whose `.team/` git does not ignore or tracks (as with `.team/keep-in-git`), session start does not point the supervisor to `.team/notes/plan.md` or the last summary; one line tells you so.'))
})

test('the README describes the hooks as they are now: notices instead of silent allows, refused advisor writes, SIGTERM first, redaction, the slow off poll', () => {
  const readme = read('README.md')
  const grace = Number(sourceConst('hooks/memory-guard.mjs', 'KILL_GRACE_MS')) / 1000
  assert.equal(sourceConst('hooks/register.tsx', 'OFF_POLL_MS'), '10 * 1000')
  assertIncludes(readme, [
    `(SIGTERM, then SIGKILL if it is still running ${grace} seconds later)`, 'every 10 s in a project set to off while neither board pane is open',
    'if that check itself fails, the write is refused', 'a section transcript the context guard or the grade check cannot read gets one line too',
    'with recognised secrets replaced by `[redacted]`',
  ], 'README')
  const docs = [readme, read(HOW_DOC), read(LONG_DOC)].join('\n')
  for (const old of ['allow silently', 'it allows the call if it crashes', 'stops (SIGKILL)', 'If the plugin cannot read the needed files, it allows the message.', 'If the result cannot be read, nothing is refused.', 'saved word for word']) {
    assert.ok(!docs.includes(old), `old sentence: ${old}`)
  }
})

test('the README says only the saved long message is redacted, not REPORTs or the supervisor summary', () => {
  for (const hook of ['hooks/subagent-stop.mjs', 'hooks/stop.mjs']) assert.ok(!read(hook).includes('redact'), `${hook} saves its text as written`)
  const files = read('README.md').split('\n').find(line => line.startsWith('- **Files in each git repo.**')) ?? ''
  assert.ok(files.includes("every section REPORT and the supervisor's summary as written, and any message you send of 3000 characters or more with recognised secrets replaced by `[redacted]`"), 'Files line')
  assert.ok(!files.includes("the supervisor's summary, and any message of 3000 characters or more, with recognised secrets"), 'old sentence calls every saved file redacted')
})

test('the README says an off project saves no report where git does not ignore .team/, and names a committed Max or off mode file', () => {
  assertIncludes(section(read('README.md'), 'Modes'), [
    'only where git ignores `.team/`; elsewhere nothing is saved and one line says so',
    'A committed `.team/mode.json` that sets Max or off is named in one line at session start.',
  ], 'Modes')
})

// Solo runs in the published summaries under these folders, and how many spawned the author's code-reviewer or security-reviewer agent.
function soloReviewerRuns(dirs) {
  const solo = dirs.flatMap(dir => JSON.parse(read(`${dir}/summary.json`))).filter(row => row.cond.startsWith('solo'))
  const spawned = solo.filter(row => Object.keys(row.agentTypes ?? {}).some(type => /code-reviewer|security-reviewer/.test(type)))
  return `${spawned.length} of ${solo.length}`
}

const P1_DIR = new URL('../bench/data/p1/', import.meta.url)
const P1_ROUNDS = readdirSync(P1_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `bench/data/p1/${entry.name}`)

const sentencesOf = text => text.split(/(?<=[.!?])\s+|\n/)

test('the held-out and p1 baselines are labelled the author\'s setup, with reviewer counts from the published summaries', () => {
  const readme = read('README.md')
  const p1 = soloReviewerRuns(P1_ROUNDS)
  const heldout = soloReviewerRuns(['bench/data/heldout'])
  assert.equal(soloReviewerRuns(['bench/data/modes']).split(' of ')[0], '0', 'the clean mode round spawned none')
  assertIncludes(section(readme, 'Results'), [
    BASELINE, `${heldout} held-out solo runs and ${p1} solo runs in \`bench/data/p1/\` spawned the author's code-reviewer or security-reviewer agent`,
    "Only the mode round's baseline was plain Claude Code on a clean machine.", 'For rounds hq, fx, py and ph the machine setup was not recorded',
  ], 'README Results')
  const results = read(RESULTS_DOC)
  assert.equal(results.split('\n').filter(line => line.startsWith(`| ${BASELINE} |`)).length, 4, 'the four main-machine p1 tables')
  assert.equal(results.split('\n').filter(line => line.startsWith(`| ${UNRECORDED} |`)).length, 2, 'the ph and hq tables')
  assert.ok(!results.split('\n').some(line => line.startsWith('| Plain Claude Code (solo)')), 'no solo row is called plain Claude Code')
  assert.ok(read('docs/benchmark-heldout-2026-11.md').includes(BASELINE), 'held-out doc label')
  assert.ok(read('bench/data/p1/README.md').includes(BASELINE), 'p1 data README label')
  assert.ok(read('bench/data/README.md').includes(BASELINE), 'rounds 1-17 data README label')
})

test('no sentence about a held-out, p1, hq or fx round calls the baseline plain Claude Code', () => {
  for (const path of ['README.md', RESULTS_DOC, LONG_DOC, HOW_DOC]) {
    const bad = sentencesOf(read(path)).filter(s => /held-out|\bp1\b|\bhq\b|\bfx\b/i.test(s) && s.includes('plain Claude Code'))
    assert.deepEqual(bad, [], path)
  }
  assert.ok(!read('docs/benchmark-heldout-2026-11.md').includes('plain Claude Code'), 'held-out doc')
})

test('the hq paragraph does not call round hq pre-registered', () => {
  const hq = read(RESULTS_DOC).split('\n').filter(line => line.includes('(hq, 2026-11-19)') || line.startsWith('Met: Max scored at least'))
  assert.equal(hq.length, 2, 'the hq paragraphs')
  for (const line of hq) assert.ok(!line.replaceAll('not publicly pre-registered', '').includes('pre-registered'), line.slice(0, 60))
  const bullet = read('README.md').split('\n').find(line => line.startsWith('- **Round hq'))
  assert.ok(bullet && !bullet.includes('pre-registered'), 'README hq bullet')
})

test('the README says Max is the pick for platform work only as a labelled report', () => {
  const unlabelled = sentencesOf(read('README.md')).filter(s => /stronger pick/i.test(s) && !s.includes('Reported only'))
  assert.deepEqual(unlabelled, [])
})

test('the README p1 bullet gives the judged ranges, the unjudged round and the versions', () => {
  assertIncludes(section(read('README.md'), 'Results'), [
    "Balanced judged 1.0 to 1.75 above solo on Codex at 3.4 to 5.6× (judged rounds; py's 6.0× was never judged); Max 6.1 to 13.0×.",
    'Round pr ran 0.2.3, so eleven of the twelve published p1 rounds are 0.3.0 or later.',
    'in round tj\'s official scoring', '[`bench/data/ph/`](bench/data/ph/)', '[`bench/data/py/`](bench/data/py/)',
  ], 'README Results')
})

// A line of text, or a table with the line before it: the unit a Fable score must carry its note in.
function scoreUnits(text) {
  return text.split(/\n{2,}/).reduce((units, para) => {
    const table = para.split('\n').every(line => line.startsWith('|'))
    if (table && units.length > 0) return [...units.slice(0, -1), `${units.at(-1)}\n${para}`]
    return [...units, ...para.split('\n')]
  }, [])
}

test('every line or table with a Fable score says Fable also planned and reviewed some of the fixes it judged', () => {
  for (const path of ['README.md', RESULTS_DOC]) {
    const missing = scoreUnits(read(path)).filter(unit => /Fable/.test(unit) && /\d\.\d/.test(unit) && !unit.includes(FABLE_NOTE))
    assert.deepEqual(missing.map(unit => unit.slice(0, 80)), [], path)
  }
})

test('the results doc numbers are the recompute output, correctly rounded', () => {
  const results = read(RESULTS_DOC)
  for (const old of ['$11.19', '2.94×', '$3.63', '$9.82', '$18.79', '3.3× on h6', '| 4.2 | 9.0 |']) assert.ok(!results.includes(old), `old figure ${old}`)
  assertIncludes(results, ['$11.20', '2.93×', '$3.62', '| $9.81 |', '| $18.78 |', '3.2× on h6', '| 4.2 | 9.1 |'], 'results doc')
  const p1 = read('bench/data/p1/README.md')
  assert.ok(!p1.includes('where they say $9.82 and $18.79') && p1.includes('to 4.2x, 9.1x'), 'p1 data README')
})

test('the results doc records the 0.2.3 h7 run that hit its limit, and labels the tj rescore', () => {
  assertIncludes(read(RESULTS_DOC), ['hit the 120-minute limit in stage 1 at $29.43', '(264 on a quiet rescore: a reported rescore, not published)'], 'results doc')
})

test('the bench data READMEs point to every published round and recompute in a temp folder', () => {
  const data = read('bench/data/README.md')
  for (const dir of ['heldout', 'modes', 'p1', 'ph', 'py', 'hq', 'fx']) assert.ok(data.includes(`[\`${dir}/\`](${dir}/)`), dir)
  assert.ok(data.includes('BENCH_RESULTS="$tmp" node bench/aggregate.mjs --round=v17'), 'temp-folder recipe')
  assert.ok(!data.includes('cp bench/data/*.json bench/results/'), 'never bench/results/')
  const p1 = read('bench/data/p1/README.md')
  assertIncludes(p1, ['[`../ph/`](../ph/)', '[`../py/`](../py/)', 'node bench/data/p1/recompute.mjs ph py'], 'p1 data README')
  assert.ok(read('docs/benchmark-2026-10-24.md').includes('Data: the raw files for rounds 1-17 are public in'), 'round doc scope')
})

test(`the README is ${README_MAX_WORDS} words or fewer`, () => {
  const words = wordsOf(read('README.md'))
  assert.ok(words <= README_MAX_WORDS, `README has ${words} words`)
})

test('the README glossary defines its terms in eight lines', () => {
  const lines = section(read('README.md'), 'Glossary').trim().split('\n')
  assert.equal(lines.length, 8)
  const terms = ['Section', 'Helper', 'Reviewer gate', 'REPORT', 'Mode', 'Solo', 'Rounds', 'Judges']
  assert.deepEqual(lines.map(line => line.match(/^- \*\*(.+?):\*\*/)?.[1]), terms)
  for (const name of ['p1', 'hq', 'fx', 'Codex', 'Fable']) assert.ok(lines.join('\n').includes(name), name)
})

test('the how-it-works doc keeps the README details it took, and the README points to it', () => {
  const readme = read('README.md')
  for (const anchor of ['', '#max', '#mode-file', '#team-board', '#sections', '#develop']) assert.ok(readme.includes(`](docs/how-it-works.md${anchor})`), `README link ${anchor}`)
  const doc = read(HOW_DOC)
  for (const heading of ['Routing', 'Reports, notes and long messages', 'Max', 'Mode file', 'Team Board', 'Sections', 'Requirements in detail', 'Develop']) {
    assert.ok(doc.includes(`\n## ${heading}\n`), heading)
  }
  assertIncludes(doc, [
    'a feature with its own behaviour to test (a CLI, an endpoint, a module with storage or I/O) is never small',
    'If the file breaks mid-session, the session keeps its mode', 'The default names are frontend Iris',
    "The plugin refuses a section's Agent call that asks for the background", 'Remote sessions (`CLAUDE_CODE_REMOTE_MEMORY_DIR`)',
    'set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`', 'Sections load `security-review` only when the branch shares history with an `origin/HEAD` ref',
    // lines the trim cut from the README that live only here
    'An unknown mode is refused and nothing is saved.', 'On mobile the strip has no picker', 'Nothing opens by itself.',
    'Balanced is above the 8.60 scale ceiling', "the handback gate uses the new mode's pass mark at once", 'A change to `autoInstallSkills` applies from the next session.',
    'and prompts are not saved or checked', '(for example, its input names no project folder)', 'then on the two single-area tasks alone',
    '- `npm test` — hook logic (node:test)', '- `node scripts/gen-agents.mjs --check` — agent files match the roster',
  ], 'how-it-works doc')
  assert.ok(!read(LONG_DOC).includes('the Results figures above'), 'no pointer to text that moved')
})

test('the README Support section says where to ask and how soon, and a question form exists', () => {
  const support = section(read('README.md'), 'Support')
  assertIncludes(support, ['](https://github.com/afel6/section-team/issues/new/choose)', 'bugs and questions', 'first reply within 7 days', '[SECURITY.md](SECURITY.md)'], 'Support')
  assert.ok(support.trim().split('\n').length <= 3, 'three lines or fewer')
  assert.ok(read('SECURITY.md').includes('first reply within 7 days'), 'SECURITY.md promises the same reply time')
  const form = read('.github/ISSUE_TEMPLATE/question.yml')
  assertIncludes(form, ['name: Question', 'labels: [question]', 'id: question', 'required: true', 'id: plugin-line'], 'question form')
})

test('SECURITY.md says whether private reporting is on, and the issue config links only what works', () => {
  const security = read('SECURITY.md')
  const config = read('.github/ISSUE_TEMPLATE/config.yml')
  const off = security.includes('Private vulnerability reporting: not enabled yet (checked 2026-11-23)')
  assert.ok(off || /Private vulnerability reporting: enabled \(checked \d{4}-\d{2}-\d{2}\)/.test(security), 'SECURITY.md states the setting with a date')
  if (off) {
    assert.ok(!security.includes('Use GitHub\'s private reporting'), 'no instruction to use a form that is off')
    assert.ok(config.includes('blank_issues_enabled: false') && security.includes('with the Question form'), 'the interim route names a form that can be opened')
    assert.ok(read('.github/ISSUE_TEMPLATE/question.yml').includes('name: Question'), 'the Question form exists')
    assert.ok(!config.includes('security/advisories/new'), 'the issue config does not link the form while it is off')
    assert.ok(config.includes('/blob/main/SECURITY.md'), 'the issue config links SECURITY.md')
  }
})

test('SECURITY.md lists the known limits', () => {
  const limits = section(read('SECURITY.md'), 'Known limits')
  assert.ok(/^tools: Read, Grep, Glob, Bash$/m.test(read('agents/reviewer.md')), 'the reviewer holds Bash')
  assert.ok(read('.claude-plugin/marketplace.json').includes('"source": "./"'), 'the marketplace serves the repo root')
  assertIncludes(limits, [
    'The reviewer holds Bash', 'process tree', '`bench/` ships in the plugin', 'can add hooks',
    '`ANTHROPIC_DEFAULT_OPUS_MODEL`', 'for every section head', 'covers only the install switch (`SECTION_TEAM_AUTO_INSTALL_SKILLS`) and `HOME` or `USERPROFILE`',
    'Every push to `main` ships', '`main` moves only at releases',
  ], 'Known limits')
})

test('the bug report asks for the Plugin: line and the install method, not a commit', () => {
  const form = read('.github/ISSUE_TEMPLATE/bug_report.yml')
  assert.ok(!form.includes('section-team commit'), 'no commit field')
  const plugin = form.split('id: plugin-line')[1]?.split('  - type:')[0] ?? ''
  assertIncludes(plugin, ['Plugin:', '.team/reports/', 'version and mode', 'required: true'], 'Plugin: line field')
  const install = form.split('id: install-method')[1]?.split('  - type:')[0] ?? ''
  assertIncludes(install, ['Install method', '- marketplace', '- clone', '- --plugin-dir', 'required: true'], 'install method dropdown')
  assert.ok(form.includes('  - type: dropdown\n    id: install-method'), 'a dropdown')
})

test('the old review brief, final report and build ledger live in docs/history with a superseded banner', () => {
  const docs = readdirSync(new URL('../docs/', import.meta.url))
  for (const name of ['REVIEW-BRIEF.md', 'final-report-2026-10-26.md', 'build-ledger.md']) {
    assert.ok(!docs.includes(name), `${name} left docs/`)
    const lines = read(`docs/history/${name}`).split('\n')
    assert.ok(lines[0].startsWith('# '), `${name} keeps its title`)
    assert.ok(lines[2].includes('Historical; superseded by the README.'), `${name} banner`)
  }
  assert.ok(read('docs/history/REVIEW-BRIEF.md').includes('`docs/history/build-ledger.md`'), 'the brief points to the ledger where it is now')
})

test('the held-out and hq data READMEs state the baseline and the printed numbers truthfully', () => {
  const heldout = read('bench/data/heldout/README.md')
  assert.ok(heldout.includes(`\`solo-ho\` is ${BASELINE}`), 'solo-ho label')
  assert.ok(heldout.includes(`${soloReviewerRuns(['bench/data/heldout'])} solo-ho runs spawned`), 'held-out count recomputed from summary.json')
  assert.ok(!heldout.includes('plain Claude Code'), 'held-out data README')
  const hq = read('bench/data/hq/README.md')
  assertIncludes(hq, ['the printed values are the authority', '$11.19', '2.94x', '$3.63', '3.3x'], 'hq known differences')
  assert.ok(!hq.includes('the doc says'), 'the results doc prints the recomputed values')
})

test('CONTRIBUTING lists the generated direct-build skill and documents the round harness settings', () => {
  assertIncludes(read('CONTRIBUTING.md'), [
    '`skills/direct-build/`', 'SECTION_TEAM_LIVE_CHECKOUT', 'BENCH_RUNS', 'CLAUDE.local.md', 'AGENTS.md', '--config-dir', '--base-plugin', '--base-ref',
    '--conds', '--task-reps', 'SECTION_TEAM_MEMORY_LIMIT_MB', '2.1.318',
  ], 'CONTRIBUTING harness')
})

test('the data README describes the nx folder as it exists: a recompute script, data after the round', () => {
  assertIncludes(read('bench/data/README.md'), ['[`nx/`](nx/)', 'node bench/data/nx/recompute.mjs'], 'data README nx')
})
