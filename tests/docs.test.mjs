import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MODE_LABELS } from '../hooks/lib/mode.mjs'
import { HEAD_CONTEXT_LIMIT } from '../hooks/lib/head-context.mjs'

const CLAIM_WORDS = /\b(sav(?:e|es|ed|ing|ings)|cheaper|cuts? cost|half|better code|higher quality|better quality|improv(?:es|ed)|reduces|lower cost|costs? less|much less|fewer tokens)\b|\d\s*%/i

const DISCLAIMED = /\b(?:not|never|none|no|isn['’]t)\b(?: \w+){0,3} measured|unmeasured/i

const STALE_COST_MULTIPLE = /(?<![\d.])3\.6\s*(times|×|x)/i

const assertIncludes = (text, needles, label) => {
  for (const needle of needles) assert.ok(text.includes(needle), `${label} missing ${needle}`)
}

// Sentences that make a saving or quality claim without saying it is unmeasured.
const claimSentences = text => text.split(/(?<=[.!?])\s+|\n/).filter(s => CLAIM_WORDS.test(s) && !DISCLAIMED.test(s))

const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

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

test('the README states the measured cost ranges, the round 17 label and no single stale cost multiple', () => {
  const readme = read('README.md')
  assert.ok(!STALE_COST_MULTIPLE.test(readme), 'no stale 3.6 multiple')
  const needles = ['about 2.2 to 5.2 times', 'about 7.5 to 9.7 times in Max', 'section-team (round 17)', 'with tests the largest part of the gap (42 to 44% in the mode round)', 'depending on the tasks and the setup', 'mode round only', 'Lean, the third, was removed in 0.3.0']
  assertIncludes(readme, needles, 'README')
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
    'Lean 4.5, Balanced 7.0 and Max 13.4 times plain Claude Code', 'testing, docs, the security pass and advisors not counted', 'any saving in real use',
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
    'a pasted message of 3000 characters or more is saved word for word to `.team/reports/<date>/<time>-user-request.md` inside a git repo whose `.team/` folder git ignores',
    'so the supervisor points sections to it instead of re-typing it',
    'in a `-details.md` file there and keep at most 5 short lines above their REPORT',
    'a builder hand-back that claims done with more than 1200 characters above its REPORT is refused (partial, blocked and ungraded are not',
    'A resumed session gets the brief again only when it changed since the session started.',
    "In the p1 measure round the supervisor's chat peaked at 99K to 104K in Balanced and 116K to 123K in Max, against 158K to 168K for solo.",
  ], 'README')
  assert.ok(!readme.includes('the supervisor starts the app itself and drives every critical flow'), 'the old Max flow sentence is gone')
})

test('the README records the p1 confirm round with its numbers and what is not measured', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    '**A p1 confirm round (0.3.0, 2026-11-10).**',
    '| Plain Claude Code (solo) | $3.53 | 1.0 | 264 | 7.0 | 0 of 4 | 27 min | 149K to 152K |',
    '| **Balanced (default)** | $17.45 | 4.9 | 262.5 | 8.0 | 0 of 4 | 34 min | 95K to 98K |',
    '| Max | $37.37 | 10.6 | 261 | 8.75 | 4 of 4 | 54 min | 137K to 139K |',
    'Missed: Balanced judged 1.0 above solo again, not 1.5',
    "`new TextDecoder('utf-8')`, which drops a leading byte order mark",
    "Commits 27db531, 44f5d45 and 68ffecb fix these in the sections' rules; the measure round below tests them.",
  ], 'README')
  assert.ok(!readme.includes('Their effect on usage is not measured yet.'), 'the unmeasured-usage sentence is gone')
})

test('the README records the p1 measure round with both judges and what is not measured', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    '**A p1 measure round (0.3.0, 2026-11-11).**',
    '| Plain Claude Code (solo) | $4.03 | 1.0 | 264 | 7.0 | 7.0 | 0 of 4 | 8 min | 158K to 168K |',
    '| **Balanced (default)** | $18.95 | 4.7 | 264 | 8.5 | 9.0 | 2 of 4 | 43 min | 99K to 104K |',
    '| Max | $32.96 | 8.2 | 264 | 8.5 | 8.25 | 2 of 4 | 52 min | 116K to 123K |',
    'Missed: Max judged level with Balanced by Codex and 0.75 below it by Fable, not 0.25 above.',
    'Commit 77edf80 keeps the answer after such a call',
    'checked its Node claims with probes; round tg below measured it.',
  ], 'README')
  assert.ok(!readme.includes("fix these in the sections' rules; not measured yet."), 'the confirm round fixes are measured now')
  assert.ok(!readme.includes('checked its Node claims with probes; not measured yet.'), '77edf80 is measured now')
})

test('the README records the p1 rounds tg to ph with both judges, what each measured and what was missed', () => {
  const readme = read('README.md')
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
    'in rounds tg to ph Balanced cost 3.4 to 6.0 times and Max 8.4 to 13.0 times plain Claude Code',
  ], 'README')
  assert.ok(!readme.includes('design weight, not failed spec lines'), 'team defects are not called design weight')
  assert.ok(!readme.includes('Rounds tg to to ran'), 'round names are listed, not "tg to to"')
})

test('the README records round hq with both judges, its missed targets, and Max as the pick for platform work', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    '**A held-out round on three other tasks (hq, 2026-11-19).**',
    '| Plain Claude Code (solo) | $11.19 | 1.0 | 25 / 47 / 146 | 7.92 | 7.17 | 0 / 0 of 12 | up to 140K |',
    '| **Balanced (default)** | $58.10 | 5.2 | 25 / 47 / 147 | 8.58 | 8.50 | 0 / 0 of 12 | up to 103K |',
    '| Max | $117.47 | 10.5 | 25 / 47 / 148 | 9.42 | 9.00 | 12 / 12 of 12 | up to 125K |',
    'Missed: Balanced judged 1.33 above solo by Fable but 0.67 by Codex, under the 1.0 bar',
    'Balanced cost 5.2× solo over the three tasks, over 5×',
    'commit 2003125 has it written in place, not measured yet',
    'so for platform-sized work Max is the stronger pick',
  ], 'README')
})

test('the README records round fx: the Balanced test-gap fix missed its bar and does not ship', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    '**A check of one Balanced fix on three new tasks (fx, 2026-11-20).**',
    'Codex 7.83 / 9.08 / 9.08, Fable 6.58 / 8.58 / 8.33',
    '2.94× solo and 1.02× Balanced without it',
    'so the fix does not ship',
  ], 'README')
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
  const guard = use.split('**Memory guard.**')[1]?.split('\n')[0]
  assert.ok(guard, 'no Memory guard entry under Use')
  assertIncludes(guard, [
    'every 5 seconds', "the session's MCP servers", '75% of physical memory, never under 4096 MB', '`SECTION_TEAM_MEMORY_LIMIT_MB`', '`0` turns it off',
    '`.team/tmp/memory-guard.log`', 'on by default on Windows only',
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
    '/team name <section> <name>', '/team name <section>', 'names.json', 'walks', 'strolls', 'advisors',
    'The terminal keeps the text board.',
  ], 'Team Board section')
})
