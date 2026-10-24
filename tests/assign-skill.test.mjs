import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { accessSync, chmodSync, constants, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assignSkill, removeSkill, validateExtra, SKILL_NAME } from '../scripts/assign-skill.mjs'
import { HELPER_AGENTS, ROSTER, render, writeAgents } from '../scripts/gen-agents.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const frontend = ROSTER.find(s => s.id === 'frontend')
const isWritable = file => { try { accessSync(file, constants.W_OK); return true } catch { return false } }

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

  test('rejects a bad skill name', () => {
    for (const bad of ['../x', 'a b', '', 'x'.repeat(101), undefined]) assert.throws(() => removeSkill({}, bad), /invalid skill name/, JSON.stringify(bad))
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
      assert.equal(writeAgents({ dir: target, extra }).length, ROSTER.length + HELPER_AGENTS.length)
      assert.deepEqual(writeAgents({ dir: target, extra, check: true }), [])
      assert.deepEqual(writeAgents({ dir: target, extra: {}, check: true }), ['frontend.md'])
      assert.match(readFileSync(join(dir, 'frontend.md'), 'utf8'), /my-skill/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

})

describe('assign-skill CLI in a temp copy of the plugin', () => {
  const run = (tmp, script, ...args) => spawnSync(process.execPath, [join(tmp, 'scripts', script), ...args], { encoding: 'utf8', cwd: tmpdir() })
  const cli = (tmp, ...args) => run(tmp, 'assign-skill.mjs', ...args)
  const rosterFile = tmp => join(tmp, 'scripts', 'roster-extra.json')
  const watched = tmp => ['scripts/roster-extra.json', ...readdirSync(join(tmp, 'agents')).map(f => `agents/${f}`)]
  const snapshot = tmp => Object.fromEntries(watched(tmp).map(f => [f, readFileSync(join(tmp, f), 'utf8')]))
  const mtimes = tmp => Object.fromEntries(watched(tmp).map(f => [f, statSync(join(tmp, f)).mtimeMs]))

  // A copy of the plugin whose roster starts as `extra`, with the agents regenerated for it:
  // the state of the repo after the feature has been used.
  const withPlugin = (extra, fn) => {
    const tmp = mkdtempSync(join(tmpdir(), 'st-cli-'))
    try {
      for (const d of ['scripts', 'hooks/lib', 'agents']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true })
      writeFileSync(rosterFile(tmp), `${JSON.stringify(extra, null, 2)}\n`)
      const gen = run(tmp, 'gen-agents.mjs')
      assert.equal(gen.status, 0, gen.stderr)
      return fn(tmp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  test('assign, list, remove, and error paths', () => withPlugin({}, tmp => {
    assert.equal(readFileSync(rosterFile(tmp), 'utf8'), '{}\n')
    const before = snapshot(tmp)

    const add = cli(tmp, 'demo-skill', 'frontend', 'uiux')
    assert.equal(add.status, 0, add.stderr)
    assert.equal(add.stdout.trim(), 'assigned demo-skill → frontend, uiux')
    assert.equal(readFileSync(rosterFile(tmp), 'utf8'), '{\n  "frontend": [\n    "demo-skill"\n  ],\n  "uiux": [\n    "demo-skill"\n  ]\n}\n')
    for (const id of ['frontend', 'uiux']) assert.match(readFileSync(join(tmp, 'agents', `${id}.md`), 'utf8'), /go-to ones:.*demo-skill/)
    assert.ok(!readFileSync(join(tmp, 'agents', 'backend.md'), 'utf8').includes('demo-skill'))
    assert.equal(run(tmp, 'gen-agents.mjs', '--check').status, 0)

    const list = cli(tmp, '--list')
    assert.equal(list.status, 0, list.stderr)
    assert.deepEqual(JSON.parse(list.stdout), { frontend: ['demo-skill'], uiux: ['demo-skill'] })

    const withSkill = snapshot(tmp)
    for (const args of [['demo-skill', 'nope'], ['bad name', 'frontend'], ['../x', 'frontend'], ['only-a-skill'], []]) {
      const bad = cli(tmp, ...args)
      assert.equal(bad.status, 1, JSON.stringify(args))
      assert.match(bad.stderr, /^error: /, JSON.stringify(args))
      assert.deepEqual(snapshot(tmp), withSkill, `files changed after ${JSON.stringify(args)}`)
    }

    const rm = cli(tmp, '--remove', 'demo-skill')
    assert.equal(rm.status, 0, rm.stderr)
    assert.equal(rm.stdout.trim(), 'removed demo-skill')
    assert.equal(readFileSync(rosterFile(tmp), 'utf8'), '{}\n')
    assert.deepEqual(snapshot(tmp), before)

    writeFileSync(rosterFile(tmp), '{ "nope": ["x"] }\n')
    const corrupt = cli(tmp, '--list')
    assert.equal(corrupt.status, 1)
    assert.match(corrupt.stderr, /^error: .*unknown section/)
    assert.notEqual(run(tmp, 'gen-agents.mjs', '--check').status, 0)
  }))

  test('after prior use (roster already holds backend: x) the flow and the committed-agents test still pass', () => withPlugin({ backend: ['x'] }, tmp => {
    const prior = snapshot(tmp)
    assert.match(prior['agents/backend.md'], /plus your go-to ones: x\./)
    assert.equal(run(tmp, 'gen-agents.mjs', '--check').status, 0)

    // tests/agents.test.mjs ("committed files match the generator") run inside the copy
    mkdirSync(join(tmp, 'tests'))
    cpSync(join(ROOT, 'tests', 'agents.test.mjs'), join(tmp, 'tests', 'agents.test.mjs'))
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const suite = spawnSync(process.execPath, ['--test', join(tmp, 'tests', 'agents.test.mjs')], { encoding: 'utf8', env, cwd: tmp })
    assert.equal(suite.status, 0, suite.stdout + suite.stderr)

    const add = cli(tmp, 'demo-skill', 'frontend', 'backend')
    assert.equal(add.status, 0, add.stderr)
    assert.deepEqual(JSON.parse(cli(tmp, '--list').stdout), { backend: ['x', 'demo-skill'], frontend: ['demo-skill'] })
    assert.equal(run(tmp, 'gen-agents.mjs', '--check').status, 0)

    const rm = cli(tmp, '--remove', 'demo-skill')
    assert.equal(rm.status, 0, rm.stderr)
    assert.deepEqual(snapshot(tmp), prior)
  }))

  test('--remove validates the name and leaves files alone for an unassigned skill; --list takes no arguments', () => withPlugin({ backend: ['x'] }, tmp => {
    const old = new Date('2020-01-01T00:00:00Z')
    for (const f of watched(tmp)) utimesSync(join(tmp, f), old, old)
    const files = snapshot(tmp)
    const stamps = mtimes(tmp)

    for (const args of [['--remove', 'bad name'], ['--remove', '../x'], ['--remove', 'x'.repeat(101)], ['--remove'], ['--remove', 'a', 'b'], ['--list', 'extra']]) {
      const bad = cli(tmp, ...args)
      assert.equal(bad.status, 1, JSON.stringify(args))
      assert.match(bad.stderr, /^error: /, JSON.stringify(args))
      assert.equal(bad.stdout, '', JSON.stringify(args))
    }

    const absent = cli(tmp, '--remove', 'never-assigned')
    assert.equal(absent.status, 0, absent.stderr)
    assert.equal(absent.stdout.trim(), 'not assigned: never-assigned')

    assert.deepEqual(snapshot(tmp), files)
    assert.deepEqual(mtimes(tmp), stamps, 'a file was rewritten')
  }))

  test('a failed agent-file write leaves the roster unchanged (agents first, roster last)', t => withPlugin({}, tmp => {
    const locked = join(tmp, 'agents', 'frontend.md')
    chmodSync(locked, 0o444)
    if (isWritable(locked)) {
      chmodSync(locked, 0o666)
      return t.skip('read-only files are still writable here (running as root?)')
    }
    try {
      const failed = cli(tmp, 'demo-skill', 'frontend')
      assert.equal(failed.status, 1, failed.stdout)
      assert.match(failed.stderr, /^error: /)
      assert.equal(readFileSync(rosterFile(tmp), 'utf8'), '{}\n')
    } finally {
      chmodSync(locked, 0o666)
    }
    const retry = cli(tmp, 'demo-skill', 'frontend')
    assert.equal(retry.status, 0, retry.stderr)
    assert.equal(run(tmp, 'gen-agents.mjs', '--check').status, 0)
  }))
})
