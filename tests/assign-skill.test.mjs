import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assignSkill, removeSkill, validateExtra, SKILL_NAME } from '../scripts/assign-skill.mjs'
import { ROSTER, render, writeAgents } from '../scripts/gen-agents.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const frontend = ROSTER.find(s => s.id === 'frontend')

describe('assignSkill', () => {
  test('adds a skill to one section and to several', () => {
    assert.deepEqual(assignSkill({}, 'demo', ['frontend']), { frontend: ['demo'] })
    assert.deepEqual(assignSkill({}, 'demo', ['frontend', 'uiux']), { frontend: ['demo'], uiux: ['demo'] })
  })

  test('dedupes and keeps order', () => {
    const once = assignSkill({ frontend: ['a', 'b'] }, 'c', ['frontend'])
    assert.deepEqual(once, { frontend: ['a', 'b', 'c'] })
    assert.deepEqual(assignSkill(once, 'a', ['frontend']), { frontend: ['a', 'b', 'c'] })
    assert.deepEqual(assignSkill({}, 'a', ['frontend', 'frontend']), { frontend: ['a'] })
  })

  test('returns a new object and never mutates its input', () => {
    const input = { frontend: ['a'] }
    const snapshot = JSON.stringify(input)
    const out = assignSkill(input, 'b', ['frontend', 'docs'])
    assert.equal(JSON.stringify(input), snapshot)
    assert.notEqual(out, input)
    assert.notEqual(out.frontend, input.frontend)
    const same = assignSkill(input, 'a', ['frontend'])
    assert.notEqual(same, input)
    assert.notEqual(same.frontend, input.frontend)
  })

  test('rejects an unknown section, an empty sections list and a non-array', () => {
    assert.throws(() => assignSkill({}, 'demo', ['nope']), /unknown section.*nope/)
    assert.throws(() => assignSkill({}, 'demo', ['frontend', '__proto__']), /unknown section/)
    assert.throws(() => assignSkill({}, 'demo', []), /at least one section/)
    assert.throws(() => assignSkill({}, 'demo', 'frontend'), /at least one section/)
  })

  test('rejects bad skill names', () => {
    for (const bad of ['../x', 'a b', '', 'x'.repeat(101), '-x', '.x', 'a/b', 'a\nb', undefined, 5]) {
      assert.throws(() => assignSkill({}, bad, ['frontend']), /invalid skill name/, JSON.stringify(bad))
    }
    assert.doesNotThrow(() => assignSkill({}, 'x'.repeat(100), ['frontend']))
    assert.doesNotThrow(() => assignSkill({}, 'data:sql-queries', ['frontend']))
    assert.ok(SKILL_NAME.test('My_Skill.v2'))
  })

  test('refuses to build on a malformed extra', () => {
    assert.throws(() => assignSkill({ nope: ['a'] }, 'b', ['frontend']), /unknown section/)
  })
})

describe('removeSkill', () => {
  test('removes the skill from every section and drops sections that become empty', () => {
    const input = { frontend: ['a', 'x'], uiux: ['x'], docs: ['b'] }
    assert.deepEqual(removeSkill(input, 'x'), { frontend: ['a'], docs: ['b'] })
  })

  test('does not mutate its input', () => {
    const input = { frontend: ['a', 'x'], uiux: ['x'] }
    const snapshot = JSON.stringify(input)
    const out = removeSkill(input, 'x')
    assert.equal(JSON.stringify(input), snapshot)
    assert.notEqual(out, input)
  })

  test('removing an absent skill is a no-op (equal copy)', () => {
    const input = { frontend: ['a'] }
    const out = removeSkill(input, 'zzz')
    assert.deepEqual(out, input)
    assert.notEqual(out, input)
    assert.deepEqual(removeSkill({}, 'zzz'), {})
  })
})

describe('validateExtra', () => {
  test('accepts {} and a well-formed extra', () => {
    assert.doesNotThrow(() => validateExtra({}))
    assert.doesNotThrow(() => validateExtra({ frontend: ['a', 'b-c'], uiux: [] }))
  })

  test('rejects an unknown key, a non-array value and a bad skill name', () => {
    assert.throws(() => validateExtra({ nope: ['a'] }), /unknown section/)
    assert.throws(() => validateExtra({ frontend: 'a' }), /array/)
    assert.throws(() => validateExtra({ frontend: ['../x'] }), /invalid skill name/)
    assert.throws(() => validateExtra({ frontend: [7] }), /invalid skill name/)
  })

  test('rejects a non-object', () => {
    for (const bad of [null, [], 'x', 3]) assert.throws(() => validateExtra(bad), /object/)
  })
})

describe('generator with extras', () => {
  const gotoLine = text => text.split('\n').find(l => l.startsWith('2. '))

  test('the body lists the extra among the go-to skills; the skills: preload does not', () => {
    const text = render(frontend, { frontend: ['my-skill'] })
    const frontmatter = text.split('---')[1]
    assert.ok(gotoLine(text).includes('/react-review, my-skill'), gotoLine(text))
    assert.ok(!frontmatter.includes('my-skill'), 'extra leaked into the skills: preload')
    assert.ok(frontmatter.includes('frontend-design:frontend-design'), 'real preload lost')
  })

  test('extras for another section do not appear, and no extras means no change', () => {
    assert.equal(render(frontend, { backend: ['my-skill'] }), render(frontend))
    assert.equal(render(frontend, {}), render(frontend))
    assert.ok(!render(frontend).includes('my-skill'))
  })

  test('extras are deduped and render is deterministic', () => {
    const extra = { frontend: ['my-skill', 'my-skill'] }
    const text = render(frontend, extra)
    assert.equal(text.split('my-skill').length - 1, 1)
    assert.equal(render(frontend, extra), text)
  })

  test('a section with no go-to entries gains a go-to list from extras', () => {
    const backend = ROSTER.find(s => s.id === 'backend')
    assert.ok(!render(backend).includes('go-to'))
    assert.ok(render(backend, { backend: ['x1'] }).includes('plus your go-to ones: x1.'))
  })

  test('writeAgents --check compares against output that includes extras', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-gen-'))
    const target = pathToFileURL(dir + '/')
    try {
      const extra = { frontend: ['my-skill'] }
      assert.equal(writeAgents({ dir: target, extra }).length, ROSTER.length)
      assert.deepEqual(writeAgents({ dir: target, extra, check: true }), [])
      assert.deepEqual(writeAgents({ dir: target, extra: {}, check: true }), ['frontend.md'])
      assert.match(readFileSync(join(dir, 'frontend.md'), 'utf8'), /my-skill/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the committed roster-extra.json is {} (+ newline)', () => {
    assert.equal(readFileSync(join(ROOT, 'scripts', 'roster-extra.json'), 'utf8'), '{}\n')
  })
})

describe('assign-skill CLI in a temp copy of the plugin', () => {
  const snapshot = dir => Object.fromEntries(
    ['scripts/roster-extra.json', ...readdirSync(join(dir, 'agents')).map(f => `agents/${f}`)].map(f => [f, readFileSync(join(dir, f), 'utf8')]),
  )

  test('assign, list, remove, and error paths', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'st-cli-'))
    try {
      for (const d of ['scripts', 'hooks/lib', 'agents']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true })
      const cli = (...args) => spawnSync(process.execPath, [join(tmp, 'scripts', 'assign-skill.mjs'), ...args], { encoding: 'utf8', cwd: tmpdir() })
      const extraFile = join(tmp, 'scripts', 'roster-extra.json')
      const before = snapshot(tmp)

      const add = cli('demo-skill', 'frontend', 'uiux')
      assert.equal(add.status, 0, add.stderr)
      assert.equal(add.stdout.trim(), 'assigned demo-skill → frontend, uiux')
      assert.equal(readFileSync(extraFile, 'utf8'), '{\n  "frontend": [\n    "demo-skill"\n  ],\n  "uiux": [\n    "demo-skill"\n  ]\n}\n')
      for (const id of ['frontend', 'uiux']) assert.match(readFileSync(join(tmp, 'agents', `${id}.md`), 'utf8'), /go-to ones:.*demo-skill/)
      assert.ok(!readFileSync(join(tmp, 'agents', 'backend.md'), 'utf8').includes('demo-skill'))
      assert.equal(spawnSync(process.execPath, [join(tmp, 'scripts', 'gen-agents.mjs'), '--check'], { encoding: 'utf8' }).status, 0)

      const list = cli('--list')
      assert.equal(list.status, 0, list.stderr)
      assert.deepEqual(JSON.parse(list.stdout), { frontend: ['demo-skill'], uiux: ['demo-skill'] })

      const withSkill = snapshot(tmp)
      for (const args of [['demo-skill', 'nope'], ['bad name', 'frontend'], ['../x', 'frontend'], ['only-a-skill'], []]) {
        const bad = cli(...args)
        assert.equal(bad.status, 1, JSON.stringify(args))
        assert.match(bad.stderr, /^error: /, JSON.stringify(args))
        assert.deepEqual(snapshot(tmp), withSkill, `files changed after ${JSON.stringify(args)}`)
      }

      const rm = cli('--remove', 'demo-skill')
      assert.equal(rm.status, 0, rm.stderr)
      assert.equal(rm.stdout.trim(), 'removed demo-skill')
      assert.equal(readFileSync(extraFile, 'utf8'), '{}\n')
      assert.deepEqual(snapshot(tmp), before)

      writeFileSync(extraFile, '{ "nope": ["x"] }\n')
      const corrupt = cli('--list')
      assert.equal(corrupt.status, 1)
      assert.match(corrupt.stderr, /^error: .*unknown section/)
      assert.equal(spawnSync(process.execPath, [join(tmp, 'scripts', 'gen-agents.mjs'), '--check'], { encoding: 'utf8' }).status !== 0, true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
    assert.ok(!existsSync(tmp))
  })
})
