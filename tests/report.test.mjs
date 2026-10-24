import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionIdFromType, extractReport, parseReport, SECTION_IDS } from '../hooks/lib/report.mjs'

const CLEAN = `Some work notes first.

## REPORT · backend · 2026-10-12 14:32
Status:       done
Job:          Build /api/login
Changed:      src/api/login.ts
Tests:        8 ran, 8 passed
Coordination: frontend → agreed {token, user}
Helpers used: sonnet ×2 (tests)
Problems:     none
Next:         rate limiting
`

test('section id comes only from section-team: prefixed types', () => {
  assert.equal(sectionIdFromType('section-team:frontend'), 'frontend')
  assert.equal(sectionIdFromType('ai-llm'), null)
  assert.equal(sectionIdFromType('security'), null)
  assert.equal(sectionIdFromType('section-team:nope'), null)
  assert.equal(sectionIdFromType('section-team:'), null)
  assert.equal(sectionIdFromType('section-team:data-scientist'), 'data-scientist')
  assert.equal(sectionIdFromType('general-purpose'), null)
  assert.equal(sectionIdFromType(''), null)
  assert.equal(sectionIdFromType(undefined), null)
  assert.equal(SECTION_IDS.length, 12)
})

test('the scout and coder helpers are not sections', () => {
  assert.equal(sectionIdFromType('section-team:scout'), null)
  assert.equal(sectionIdFromType('section-team:coder'), null)
})

test('extracts the block from the heading to the end', () => {
  const block = extractReport(CLEAN)
  assert.ok(block.startsWith('## REPORT · backend'))
  assert.ok(!block.includes('work notes'))
  assert.ok(block.endsWith('Next:         rate limiting\n'))
})

test('no REPORT heading gives null', () => {
  assert.equal(extractReport('all done, no report'), null)
  assert.equal(extractReport(undefined), null)
})

test('handles CRLF, bold labels and a markdown fence', () => {
  const messy = '```markdown\r\n### REPORT · testing\r\n**Status:** Partial — 2 failing\r\n- **Job:** auth tests\r\n**Helpers used:** haiku ×1\r\n```\r\nthanks'
  const block = extractReport(messy)
  assert.ok(block.startsWith('### REPORT · testing'))
  assert.ok(!block.includes('```'))
  assert.ok(!block.includes('thanks'))
  assert.ok(!block.includes('\r'))
  const r = parseReport(block)
  assert.equal(r.status, 'partial')
  assert.equal(r.job, 'auth tests')
  assert.equal(r.helpers, 'haiku ×1')
})

test('parses every field and normalises status', () => {
  const r = parseReport(extractReport(CLEAN))
  assert.deepEqual(r, {
    status: 'done', job: 'Build /api/login', changed: 'src/api/login.ts', tests: '8 ran, 8 passed',
    coordination: 'frontend → agreed {token, user}', helpers: 'sonnet ×2 (tests)', problems: 'none', next: 'rate limiting',
  })
})

test('missing fields stay empty strings', () => {
  const r = parseReport('## REPORT · docs\nStatus: blocked | waiting on backend\n')
  assert.equal(r.status, 'blocked')
  assert.equal(r.job, '')
  assert.equal(parseReport(undefined).status, '')
})

test('status survives punctuation, backticks and emoji around the word', () => {
  for (const [raw, want] of [['blocked.', 'blocked'], ['`blocked`', 'blocked'], ['⚠ partial', 'partial'], ['❌ blocked', 'blocked'], ['**Partial** — 2 failing', 'partial'], ['DONE', 'done'], ['✅ done', 'done']]) {
    assert.equal(parseReport(`## REPORT · docs\nStatus: ${raw}\n`).status, want, raw)
  }
  assert.equal(parseReport('## REPORT · docs\nStatus: shipped\n').status, 'shipped')
})

test('heading is matched case-insensitively', () => {
  for (const heading of ['## Report · docs', '## report · docs', '### REPORT']) {
    const block = extractReport(`notes\n${heading}\nStatus: done\n`)
    assert.ok(block?.startsWith(heading), heading)
  }
  assert.equal(extractReport('## Reporting is hard\nStatus: done\n'), null)
})

test('the last REPORT heading wins', () => {
  const text = '## REPORT · backend\nStatus: partial\nJob: first try\n\nretrying...\n\n## REPORT · backend\nStatus: done\nJob: second try\n'
  const block = extractReport(text)
  assert.ok(block.startsWith('## REPORT · backend\nStatus: done'))
  assert.ok(!block.includes('first try'))
  assert.equal(parseReport(block).job, 'second try')
})

test('keeps fenced code blocks inside the report', () => {
  const text = '## REPORT · backend\nStatus: partial\nProblems:\n```js\nconst x = 1\n```\nNext: deploy\n'
  const block = extractReport(text)
  assert.ok(block.includes('```js\nconst x = 1\n```\n'))
  assert.ok(block.includes('Next: deploy'))
  assert.equal(parseReport(block).next, 'deploy')
})
