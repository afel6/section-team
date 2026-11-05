import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MODE_LABELS } from '../hooks/lib/mode.mjs'
import { HEAD_CONTEXT_LIMIT } from '../hooks/lib/head-context.mjs'

const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

test('the README states the cost ranges from the mode labels, the round 17 label and no single stale cost multiple', () => {
  const readme = read('README.md')
  assert.ok(!readme.includes('It costs about 3.6 times as much as plain Claude Code'))
  const range = mode => MODE_LABELS[mode].match(/([\d.]+)–([\d.]+)×/).slice(1).join(' to ')
  const needles = ['about 2.2 to 5.2 times', `about ${range('lean')} times in Lean`, `about ${range('max')} times in Max`, 'section-team (round 17)', 'with tests the largest part of the gap (42 to 44% in the mode round)', 'depending on the tasks and the setup', 'mode round only']
  for (const needle of needles) {
    assert.ok(readme.includes(needle), `README missing ${needle}`)
  }
  assert.ok(!readme.includes('cleaner, better-tested and more robust'))
})

test('the README describes the foundation skill, fresh sections and the guard, and what is not measured', () => {
  const readme = read('README.md')
  for (const needle of ['section-team:foundation', 'fresh Agent call', `${HEAD_CONTEXT_LIMIT.toLocaleString('en-US')} tokens`, 'Not measured yet', 'one-off replay of private local transcripts', 'nor its figures are in this repo', 'the grade check and the two-stage harness', 'any work needing 3 or more builders', '0.2.3']) {
    assert.ok(readme.includes(needle), `README missing ${needle}`)
  }
  assert.ok(readme.includes('## Platform readiness'), 'Platform readiness heading missing')
  const claims = readme.split('## Platform readiness')[1].split('**What is measured')[0]
  assert.ok(!/\b(sav(?:es|ing|ings)|cheaper|cuts? cost|half|better code|higher quality|improves|costs? less|fewer tokens)\b|\d\s*%/i.test(claims), 'no saving or quality claim before the runs')
})

test('CONTRIBUTING lists the foundation skill and the new hook helpers', () => {
  const text = read('CONTRIBUTING.md')
  for (const needle of ['skills/foundation/', 'hooks/lib/head-context.mjs', 'hooks/lib/grade.mjs']) {
    assert.ok(text.includes(needle), `CONTRIBUTING missing ${needle}`)
  }
})
