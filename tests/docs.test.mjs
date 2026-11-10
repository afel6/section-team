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

test('the README states the cost ranges from the mode labels, the round 17 label and no single stale cost multiple', () => {
  const readme = read('README.md')
  assert.ok(!STALE_COST_MULTIPLE.test(readme), 'no stale 3.6 multiple')
  const range = mode => MODE_LABELS[mode].match(/([\d.]+)–([\d.]+)×/).slice(1).join(' to ')
  const needles = ['about 2.2 to 5.2 times', `about ${range('max')} times in Max`, 'section-team (round 17)', 'with tests the largest part of the gap (42 to 44% in the mode round)', 'depending on the tasks and the setup', 'mode round only', 'Lean, the third, was removed in 0.3.0']
  assertIncludes(readme, needles, 'README')
  assert.ok(!readme.includes('cleaner, better-tested and more robust'))
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
    "Max's security pass is unchanged", 'In Balanced, multi-area work touching auth, payments, uploads or secrets also wakes the security section', 'the foundation skill and the brief rules have not been run live', 'the grade check and the two-stage harness', 'a new platform or product with two or more builder areas', 'other work with 3 or more builders keeps the short plan',
    '0.2.3',
  ], 'README')
  assert.ok(!readme.includes('nor its figures') && !readme.includes('the saving in real use'), 'stale unmeasured wording is gone')
  assert.ok(!readme.includes('any work needing 3 or more builders'), 'the foundation skill no longer covers any 3-builder work')
  assert.ok(readme.includes('## Platform readiness'), 'Platform readiness heading missing')
  const claims = readme.split('## Platform readiness')[1].split('## Develop')[0]
  assert.deepEqual(claimSentences(claims), [], 'no saving or quality claim before the runs')
})

test('the README describes the saved request, the short hand-back, the resume brief and the Max flow command, as not measured', () => {
  const readme = read('README.md')
  assertIncludes(readme, [
    "Before it says done, the supervisor runs the testing section's one command that prints a PASS or FAIL line per critical flow.",
    'a pasted message of 3000 characters or more is saved word for word to `.team/reports/<date>/<time>-user-request.md` inside a git repo whose `.team/` folder git ignores',
    'so the supervisor points sections to it instead of re-typing it',
    'in a `-details.md` file there and keep at most 5 short lines above their REPORT',
    'a builder hand-back that claims done with more than 1200 characters above its REPORT is refused (partial, blocked and ungraded are not',
    'A resumed session gets the brief again only when it changed since the session started.',
    'Their effect on usage is not measured yet.',
  ], 'README')
  assert.ok(!readme.includes('the supervisor starts the app itself and drives every critical flow'), 'the old Max flow sentence is gone')
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

test('CONTRIBUTING makes no claim, explains --plugin-ref and lists the foundation skill and the new hook helpers', () => {
  const text = read('CONTRIBUTING.md')
  assert.deepEqual(claimSentences(text), [], 'no saving or quality claim in CONTRIBUTING')
  assertIncludes(text, [
    '--plugin-ref', 'names the ref the `--plugin` worktree must be at', 'v<SECTION_TEAM_VERSION>', 'leave the flag out or pass the same ref', 'expected version comes from the plugin under test',
    'skills/foundation/', 'hooks/lib/head-context.mjs', 'hooks/lib/grade.mjs',
  ], 'CONTRIBUTING')
  assert.ok(!text.includes('(now v0.2.1)'), 'no unpinned version number')
})
