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

test('the README says the docs section and final review apply in every mode', () => {
  assert.ok(read('README.md').includes('In every mode the docs section comes after the builders report, and the final review starts the app and drives the critical flows'))
})

test('the README describes the foundation skill, fresh sections and the guard, and what is not measured', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    // fresh sections and the shorter tool list
    'section-team:foundation', 'fresh Agent call', `${HEAD_CONTEXT_LIMIT.toLocaleString('en-US')} tokens`, 'builder heads have no project MCP servers', 'they use a CLI, or ask the supervisor',
    // what is measured, and what is not
    'Not measured yet', 'one-off replay of private local transcripts', 'replay itself is not in this repo', '71.8K tokens', '40.0K by default', '32.9K', 'one PC', '24.7K', 'where the difference is large',
    'testing, docs, the security pass and advisors not counted', 'any saving in real use',
    // brief rules and the foundation trigger
    "Max's security pass is unchanged", 'In Balanced, multi-area work touching auth, payments, uploads or secrets also wakes the security section', 'The p1 rounds ran the brief rules live, and from 0.3.0 on the foundation skill too', 'the grade check and the two-stage harness', 'a new platform or product with two or more builder areas', 'other work with 3 or more builders keeps the short plan',
    // Plan H: the node-http skill, and Max's complex single-area work
    'section-team:node-http', 'In Max, a single-area task with new concurrent writes, protocol framing, auth or crypto also loads it',
    '0.2.3',
  ], 'README')
  assert.ok(!readme.includes('nor its figures') && !readme.includes('the saving in real use'), 'stale unmeasured wording is gone')
  assert.ok(!readme.includes('any work needing 3 or more builders'), 'the foundation skill no longer covers any 3-builder work')
  assert.ok(!readme.includes('the foundation skill and the brief rules have not been run live'), 'the p1 rounds ran them live')
  assert.ok(readme.includes('## Platform readiness'), 'Platform readiness heading missing')
  const claims = readme.split('## Platform readiness')[1].split('## Develop')[0]
  assert.deepEqual(claimSentences(claims), [], 'no saving or quality claim before the runs')
})

test('the README describes the saved request, the short hand-back, the resume brief and the Max flow command, with the measured peak', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    "Before it says done, the supervisor runs the testing section's one command that prints a PASS or FAIL line per critical flow.",
    'a pasted message of 3000 characters or more is saved, with recognised secrets replaced by `[redacted]`, to `.team/reports/<date>/<time>-user-request.md` inside a git repo whose `.team/` folder git ignores',
    'so the supervisor points sections to it instead of re-typing it',
    'in a `-details.md` file there and keep at most 5 short lines above their REPORT',
    'a builder hand-back that claims done with more than 1200 characters above its REPORT is refused (partial, blocked and ungraded are not',
    'A resumed session gets the brief again only when it changed since the session started.',
    "In the p1 measure round the supervisor's chat peaked at 99K to 104K in Balanced and 116K to 123K in Max, against 158K to 168K for solo.",
  ], 'README')
  assert.ok(!readme.includes('the supervisor starts the app itself and drives every critical flow'), 'the old Max flow sentence is gone')
})

test('the README records the p1 confirm round with its numbers and what is not measured', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**A p1 confirm round (0.3.0, 2026-11-10).**',
    '| Plain Claude Code (solo) | $3.53 | 1.0 | 264 | 7.0 | 0 of 4 | 27 min | 149K to 152K |',
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
    '| Plain Claude Code (solo) | $4.03 | 1.0 | 264 | 7.0 | 7.0 | 0 of 4 | 8 min | 158K to 168K |',
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
    '| Plain Claude Code (solo) | $3.63 | 1.0 | 264 | 7.25 | 6.75 | 0 / 0 of 4 | 9 min | 135K to 145K |',
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

test('the README records round hq with both judges, its missed targets, and Max as the pick for platform work', () => {
  const readme = read(RESULTS_DOC)
  assertIncludes(readme, [
    '**A held-out round on three other tasks (hq, 2026-11-19).**',
    '| Plain Claude Code (solo) | $11.19 | 1.0 | 25 / 47 / 146 | 7.92 | 7.17 | 0 / 0 of 12 | up to 140K |',
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
    '2.94× solo and 1.02× Balanced without it',
    'so the fix does not ship',
  ], 'results doc')
})

test('the README Modes section keeps the p1 and h7 cost ranges and Max as the pick for platform work', () => {
  const modes = read('README.md').split('\n## Modes\n')[1].split('\n## ')[0]
  assertIncludes(modes, ['in rounds tg to ph Balanced cost 3.4 to 6.0 times and Max 8.4 to 13.0 times plain Claude Code', 'so for platform-sized work Max is the stronger pick'], 'Modes section')
})

test('the results doc says which rounds are published and which are reported only, and the h7 overlap with p1', () => {
  const results = read(RESULTS_DOC)
  assertIncludes(results, ['**reported, raw data not published**', 'node bench/data/p1/recompute.mjs', 'not publicly pre-registered', 'h7 is not fully held out'], 'results doc')
  const readme = read('README.md')
  assertIncludes(readme, ['Reported, raw data not published.', '[`bench/data/p1/`](bench/data/p1/)', 'shares a requirement word for word with p1'], 'README')
})

// Round tg: the second Max final review reads the code instead of probing again, and slices that share nothing are built side by side.
test('the README says the second Max final review reads the code, and slices that share nothing are built side by side', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    "(the second is not shown the first's REPORT; it reads the code against the spec instead of probing again)",
    'then builds one slice at a time, or slices that share nothing side by side, with a whole-stack check after each',
  ], 'README')
  assert.ok(!readme.includes('then builds one slice at a time with a whole-stack check after each'), 'old foundation line')
})

test('the README says the guard refuses only finished heads, and what each caller is told', () => {
  const guard = read('README.md').split('**Context guard.**')[1].split('\n')[0]
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
  for (const name of ['Quickstart', 'Install']) {
    assertIncludes(section(readme, name), [
      '**Needs:** Claude Code 2.1.318 (tested; this release has not been run on an older one, and before 2.1.280 the `opus` alias did not mean Opus 5.5)',
      'Node 20.16+ or 22.3+ and git 2.31+ on PATH (without Node every prompt and matched tool call shows a hook error)',
      'first-party access to Opus 5.5 (Bedrock, Vertex and Foundry are untested; on Foundry the `opus` alias means Opus 4.6)',
    ], name)
  }
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
  assertIncludes(section(read('README.md'), 'Requirements'), [line, 'tested on Claude Code 2.1.318', 'turn the team off with `{"mode": "off"}` in `.team/mode.json`'], 'Requirements')
})

test('the README says project settings that set the install switch, HOME or USERPROFILE keep installs off, in any letter case', () => {
  const readme = read('README.md')
  assert.ok(sourceConst('hooks/lib/project-settings.mjs', 'HOME_VARS').includes("['HOME', 'USERPROFILE']"))
  const line = "a project's `.claude/settings.json` or `settings.local.json` that sets this variable, `HOME` or `USERPROFILE` (a key in any letter case counts) keeps automatic installs off, with one line saying so"
  for (const name of ['What changes in your sessions', 'Modes']) assert.ok(section(readme, name).includes(line), name)
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
  for (const old of ['allow silently', 'it allows the call if it crashes', 'stops (SIGKILL)', 'If the plugin cannot read the needed files, it allows the message.', 'If the result cannot be read, nothing is refused.']) {
    assert.ok(!readme.includes(old), `old sentence: ${old}`)
  }
})

test('the README says an off project saves no report where git does not ignore .team/, and names a committed Max or off mode file', () => {
  assertIncludes(section(read('README.md'), 'Modes'), [
    'only where git ignores `.team/`; elsewhere nothing is saved and one line says so',
    'A committed `.team/mode.json` that sets Max or off is named in one line at session start.',
  ], 'Modes')
})
