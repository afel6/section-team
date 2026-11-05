import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

test('the README results headline no longer states a single stale cost multiple', () => {
  const readme = read('README.md')
  assert.ok(!readme.includes('It costs about 3.6 times as much as plain Claude Code'))
  assert.ok(readme.includes('about 2.2 to 5.2 times'))
})

test('the README describes the foundation skill, fresh sections and the guard, and what is not measured', () => {
  const readme = read('README.md')
  for (const needle of ['section-team:foundation', 'fresh Agent call', '300,000 tokens', 'Not measured yet', '0.2.3']) {
    assert.ok(readme.includes(needle), `README missing ${needle}`)
  }
  assert.ok(!/\b(saves|cheaper by|better code by)\b/i.test(readme.split('## Platform readiness')[1] ?? ''), 'no saving or quality claim before the runs')
})

test('CONTRIBUTING lists the foundation skill and the new hook helpers', () => {
  const text = read('CONTRIBUTING.md')
  for (const needle of ['skills/foundation/', 'hooks/lib/head-context.mjs', 'hooks/lib/grade.mjs']) {
    assert.ok(text.includes(needle), `CONTRIBUTING missing ${needle}`)
  }
})
