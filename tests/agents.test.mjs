import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROSTER, render, renderAll } from '../scripts/gen-agents.mjs'
import { BUILDER_IDS, ADVISOR_IDS } from '../hooks/lib/report.mjs'

const GEN = fileURLToPath(new URL('../scripts/gen-agents.mjs', import.meta.url))
const AGENTS = new URL('../agents/', import.meta.url)
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']
const front = text => Object.fromEntries(text.split('---')[1].trim().split('\n').filter(l => /^\w/.test(l)).map(l => [l.split(':')[0], l.slice(l.indexOf(':') + 1).trim()]))

test('roster matches the section ids', () => {
  assert.deepEqual(ROSTER.map(s => s.id), [...BUILDER_IDS, ...ADVISOR_IDS])
})

test('every section file has the pinned model, memory, a valid colour and a REPORT template', () => {
  for (const s of ROSTER) {
    const file = `${s.id}.md`
    const text = render(s)
    const fm = front(text)
    assert.equal(fm.name, s.id)
    assert.equal(fm.model, 'claude-opus-5-5')
    assert.equal(fm.memory, 'user')
    assert.ok(COLORS.includes(fm.color), `${file} colour ${fm.color}`)
    assert.ok(text.includes('## REPORT · '), `${file} has no REPORT template`)
    assert.ok(text.includes('ALWAYS pass `model`'), `${file} has no model routing`)
  }
})

test('advisors cannot use shell tools; builders have no tools allowlist', () => {
  for (const s of ROSTER) {
    const fm = front(render(s))
    const id = s.id
    if (ADVISOR_IDS.includes(id)) {
      assert.ok(fm.tools, `${id} needs a tools allowlist`)
      for (const banned of ['Bash', 'PowerShell', 'NotebookEdit']) assert.ok(!fm.tools.includes(banned), `${id} has ${banned}`)
    } else {
      assert.equal(fm.tools, undefined, `${id} should inherit tools`)
    }
  }
})

test('committed files match the generator', () => {
  const result = spawnSync(process.execPath, [GEN, '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const [file, text] of Object.entries(renderAll())) assert.equal(readFileSync(new URL(file, AGENTS), 'utf8'), text)
})
