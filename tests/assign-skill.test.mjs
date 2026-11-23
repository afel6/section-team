import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { accessSync, chmodSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assignSkill, mergeExtra, readExtra, removeSkill, userExtraFile, validateExtra, SKILL_NAME } from '../scripts/assign-skill.mjs'
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

describe('mergeExtra', () => {
  test('the shipped roster first, then the user\'s skills, deduped per section', () => {
    assert.deepEqual(mergeExtra({ backend: ['x'] }, { backend: ['y', 'x'], frontend: ['z'] }), { backend: ['x', 'y'], frontend: ['z'] })
    assert.deepEqual(mergeExtra({}, {}), {})
    assert.deepEqual(mergeExtra({ docs: ['a'] }, {}), { docs: ['a'] })
  })

  test('returns a new object and never mutates its inputs', () => {
    const shipped = { backend: ['x'] }
    const user = { backend: ['y'] }
    const snapshot = JSON.stringify([shipped, user])
    const out = mergeExtra(shipped, user)
    assert.equal(JSON.stringify([shipped, user]), snapshot)
    assert.notEqual(out.backend, shipped.backend)
    assert.notEqual(mergeExtra(shipped, {}).backend, shipped.backend)
  })

  test('refuses a malformed side', () => {
    assert.throws(() => mergeExtra({ nope: ['a'] }, {}), /unknown section/)
    assert.throws(() => mergeExtra({}, { frontend: ['../x'] }), /invalid skill name/)
  })
})

test('the user file lives under ~/.claude/section-team, outside the plugin folder', () => {
  assert.equal(userExtraFile(join('h')), join('h', '.claude', 'section-team', 'roster-extra.json'))
})

// Go-to skills are each user's own choice: they live in the home roster, and the plugin ships none.
test('the shipped roster names no skills', () => {
  assert.deepEqual(readExtra(), {})
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
    assert.ok(gotoLine(text).endsWith('Go-to skills, only when the job needs one its list lacks: modern-web-guidance:modern-web-guidance, react-review, my-skill.'), gotoLine(text))
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
    const bare = { ...ROSTER.find(s => s.id === 'backend'), skills: [], goto: [] } // every real section now lists its non-core skills as go-to
    assert.ok(!render(bare).includes('Go-to skills'))
    assert.ok(render(bare, { backend: ['x1'] }).includes('Go-to skills, only when the job needs one its list lacks: x1.'))
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

describe('assign-skill CLI in a temp copy of the plugin, with a temp home', () => {
  // Every child gets a temp HOME and USERPROFILE: the CLI writes ~/.claude/section-team/roster-extra.json (the 2026-11-05 incident).
  const homeOf = tmp => join(tmp, 'home')
  const envFor = tmp => {
    const env = { ...process.env, HOME: homeOf(tmp), USERPROFILE: homeOf(tmp) }
    delete env.NODE_TEST_CONTEXT
    return env
  }
  const run = (tmp, script, ...args) => spawnSync(process.execPath, [join(tmp, 'scripts', script), ...args], { encoding: 'utf8', cwd: tmpdir(), env: envFor(tmp) })
  const cli = (tmp, ...args) => run(tmp, 'assign-skill.mjs', ...args)
  const shippedFile = tmp => join(tmp, 'scripts', 'roster-extra.json')
  const userFile = tmp => userExtraFile(homeOf(tmp))
  const userText = tmp => existsSync(userFile(tmp)) ? readFileSync(userFile(tmp), 'utf8') : null
  const agentFile = (tmp, id) => readFileSync(join(tmp, 'agents', `${id}.md`), 'utf8')
  const watched = tmp => ['scripts/roster-extra.json', ...readdirSync(join(tmp, 'agents')).map(f => `agents/${f}`)]
  const snapshot = tmp => Object.fromEntries(watched(tmp).map(f => [f, readFileSync(join(tmp, f), 'utf8')]))
  const mtimes = tmp => Object.fromEntries(watched(tmp).map(f => [f, statSync(join(tmp, f)).mtimeMs]))
  const age = tmp => { const old = new Date('2020-01-01T00:00:00Z'); for (const f of watched(tmp)) utimesSync(join(tmp, f), old, old) }
  const GOTO = /Go-to skills, only when the job needs one its list lacks:.*demo-skill\.$/m

  // A copy of the plugin whose shipped roster is `extra`, with the agents regenerated for it, and an empty temp home.
  const withPlugin = (extra, fn) => {
    const tmp = mkdtempSync(join(tmpdir(), 'st-cli-'))
    try {
      for (const d of ['scripts', 'hooks/lib', 'agents', 'skills', 'brief']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true })
      mkdirSync(homeOf(tmp))
      writeFileSync(shippedFile(tmp), `${JSON.stringify(extra, null, 2)}\n`)
      const gen = run(tmp, 'gen-agents.mjs')
      assert.equal(gen.status, 0, gen.stderr)
      return fn(tmp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  test('children see the temp home, never the real one', () => withPlugin({}, tmp => {
    const r = spawnSync(process.execPath, ['-e', 'console.log(require("node:os").homedir())'], { encoding: 'utf8', env: envFor(tmp) })
    assert.equal(r.stdout.trim(), homeOf(tmp))
  }))

  test('assign saves to the home file and leaves the shipped roster alone; list, errors and --remove', () => withPlugin({}, tmp => {
    const before = snapshot(tmp)

    const add = cli(tmp, 'demo-skill', 'frontend', 'uiux')
    assert.equal(add.status, 0, add.stderr)
    assert.equal(add.stdout.trim(), 'assigned demo-skill → frontend, uiux')
    assert.equal(userText(tmp), '{\n  "frontend": [\n    "demo-skill"\n  ],\n  "uiux": [\n    "demo-skill"\n  ]\n}\n')
    assert.equal(readFileSync(shippedFile(tmp), 'utf8'), '{}\n', 'the shipped roster changed')
    for (const id of ['frontend', 'uiux']) assert.match(agentFile(tmp, id), GOTO)
    assert.ok(!agentFile(tmp, 'backend').includes('demo-skill'))

    const again = cli(tmp, 'demo-skill', 'frontend')
    assert.equal(again.status, 0, again.stderr)
    assert.equal(again.stdout.trim(), 'already assigned demo-skill → frontend')

    const list = cli(tmp, '--list')
    assert.equal(list.status, 0, list.stderr)
    assert.deepEqual(JSON.parse(list.stdout), { frontend: ['demo-skill'], uiux: ['demo-skill'] })

    const withSkill = [snapshot(tmp), userText(tmp)]
    for (const args of [['demo-skill', 'nope'], ['bad name', 'frontend'], ['../x', 'frontend'], ['only-a-skill'], []]) {
      const bad = cli(tmp, ...args)
      assert.equal(bad.status, 1, JSON.stringify(args))
      assert.match(bad.stderr, /^error: /, JSON.stringify(args))
      assert.deepEqual([snapshot(tmp), userText(tmp)], withSkill, `files changed after ${JSON.stringify(args)}`)
    }

    const rm = cli(tmp, '--remove', 'demo-skill')
    assert.equal(rm.status, 0, rm.stderr)
    assert.equal(rm.stdout.trim(), 'removed demo-skill')
    assert.equal(userText(tmp), '{}\n')
    assert.deepEqual(snapshot(tmp), before)
    assert.equal(run(tmp, 'gen-agents.mjs', '--check').status, 0)
  }))

  test('a broken home roster is an error that names no full path and changes nothing; a broken shipped one fails too', () => withPlugin({}, tmp => {
    mkdirSync(join(homeOf(tmp), '.claude', 'section-team'), { recursive: true })
    for (const text of ['{ "nope": ["x"] }\n', '{nope']) {
      writeFileSync(userFile(tmp), text)
      const before = snapshot(tmp)
      for (const args of [['--list'], ['--reapply'], ['demo-skill', 'frontend'], ['--remove', 'demo-skill']]) {
        const bad = cli(tmp, ...args)
        const what = `${JSON.stringify(text)} ${args.join(' ')}`
        assert.equal(bad.status, 1, what)
        assert.match(bad.stderr, /^error: ~\/\.claude\/section-team\/roster-extra\.json: \S/, what)
        assert.ok(!bad.stderr.includes(homeOf(tmp)), bad.stderr)
        assert.deepEqual(snapshot(tmp), before, what)
        assert.equal(userText(tmp), text, what)
      }
    }
    rmSync(userFile(tmp))
    writeFileSync(shippedFile(tmp), '{ "nope": ["x"] }\n')
    const corrupt = cli(tmp, '--list')
    assert.equal(corrupt.status, 1)
    assert.match(corrupt.stderr, /^error: .*unknown section/)
    assert.notEqual(run(tmp, 'gen-agents.mjs', '--check').status, 0)
  }))

  test('with a shipped assignment (backend: x) the merged roster keeps both and the committed-agents test still passes', () => withPlugin({ backend: ['x'] }, tmp => {
    const prior = snapshot(tmp)
    assert.match(prior['agents/backend.md'], /Go-to skills, only when the job needs one its list lacks: .*, x\.$/m)
    assert.equal(run(tmp, 'gen-agents.mjs', '--check').status, 0)

    // tests/agents.test.mjs ("committed files match the generator") run inside the copy
    mkdirSync(join(tmp, 'tests'))
    cpSync(join(ROOT, 'tests', 'agents.test.mjs'), join(tmp, 'tests', 'agents.test.mjs'))
    const suite = spawnSync(process.execPath, ['--test', join(tmp, 'tests', 'agents.test.mjs')], { encoding: 'utf8', env: envFor(tmp), cwd: tmp })
    assert.equal(suite.status, 0, suite.stdout + suite.stderr)

    const add = cli(tmp, 'demo-skill', 'frontend', 'backend')
    assert.equal(add.status, 0, add.stderr)
    assert.deepEqual(JSON.parse(cli(tmp, '--list').stdout), { backend: ['x', 'demo-skill'], frontend: ['demo-skill'] })
    assert.match(agentFile(tmp, 'backend'), /lacks: .*, x, demo-skill\.$/m)
    assert.equal(readFileSync(shippedFile(tmp), 'utf8'), prior['scripts/roster-extra.json'])

    const files = [snapshot(tmp), userText(tmp)]
    const shipped = cli(tmp, '--remove', 'x')
    assert.equal(shipped.status, 1)
    assert.match(shipped.stderr, /^error: x ships with the plugin/)
    assert.deepEqual([snapshot(tmp), userText(tmp)], files)

    const rm = cli(tmp, '--remove', 'demo-skill')
    assert.equal(rm.status, 0, rm.stderr)
    assert.deepEqual(snapshot(tmp), prior)
  }))

  test('an update rebuilds the agents without the user\'s skills; --reapply restores them from the home file', () => withPlugin({ backend: ['x'] }, tmp => {
    assert.equal(cli(tmp, 'demo-skill', 'frontend').status, 0)
    const saved = userText(tmp)

    // `claude plugin update` brings agent files built from the shipped roster only: the same as running the generator.
    assert.equal(run(tmp, 'gen-agents.mjs').status, 0)
    assert.ok(!agentFile(tmp, 'frontend').includes('demo-skill'))

    const re = cli(tmp, '--reapply')
    assert.equal(re.status, 0, re.stderr)
    assert.equal(re.stdout.trim(), 'reapplied your assignments: 1 agent file updated')
    assert.match(agentFile(tmp, 'frontend'), GOTO)
    assert.match(agentFile(tmp, 'backend'), /lacks: .*, x\.$/m)
    assert.equal(userText(tmp), saved)

    age(tmp)
    const stamps = mtimes(tmp)
    const twice = cli(tmp, '--reapply')
    assert.equal(twice.stdout.trim(), 'reapplied your assignments: 0 agent files updated')
    assert.deepEqual(mtimes(tmp), stamps, 'a second --reapply rewrote a file')
  }))

  test('--remove validates the name and leaves files alone for an unassigned skill; --list and --reapply take no arguments', () => withPlugin({ backend: ['x'] }, tmp => {
    age(tmp)
    const files = snapshot(tmp)
    const stamps = mtimes(tmp)

    for (const args of [['--remove', 'bad name'], ['--remove', '../x'], ['--remove', 'x'.repeat(101)], ['--remove'], ['--remove', 'a', 'b'], ['--list', 'extra'], ['--reapply', 'extra']]) {
      const bad = cli(tmp, ...args)
      assert.equal(bad.status, 1, JSON.stringify(args))
      assert.match(bad.stderr, /^error: /, JSON.stringify(args))
      assert.equal(bad.stdout, '', JSON.stringify(args))
    }

    const absent = cli(tmp, '--remove', 'never-assigned')
    assert.equal(absent.status, 0, absent.stderr)
    assert.equal(absent.stdout.trim(), 'not assigned: never-assigned')

    const re = cli(tmp, '--reapply')
    assert.equal(re.status, 0, re.stderr)
    assert.equal(re.stdout.trim(), 'reapplied your assignments: 0 agent files updated')

    assert.deepEqual(snapshot(tmp), files)
    assert.deepEqual(mtimes(tmp), stamps, 'a file was rewritten')
    assert.equal(userText(tmp), null, 'a home roster was created')
  }))

  test('a failed agent-file write leaves the home roster unchanged (agents first, roster last)', t => withPlugin({}, tmp => {
    const locked = join(tmp, 'agents', 'frontend.md')
    chmodSync(locked, 0o444)
    if (isWritable(locked)) {
      chmodSync(locked, 0o666)
      return t.skip('read-only files are still writable here (running as root?)')
    }
    try {
      const failed = cli(tmp, 'demo-skill', 'frontend')
      assert.equal(failed.status, 1, failed.stdout)
      assert.match(failed.stderr, /^error: could not write the plugin's agent files \(E[A-Z]+\)$/m)
      assert.equal(userText(tmp), null)
    } finally {
      chmodSync(locked, 0o666)
    }
    const retry = cli(tmp, 'demo-skill', 'frontend')
    assert.equal(retry.status, 0, retry.stderr)
    assert.match(agentFile(tmp, 'frontend'), GOTO)
    assert.match(userText(tmp), /"demo-skill"/)
  }))

  test('a home roster that cannot be saved is a friendly error with no full path', () => withPlugin({}, tmp => {
    mkdirSync(join(homeOf(tmp), '.claude'))
    writeFileSync(join(homeOf(tmp), '.claude', 'section-team'), 'a file where the folder should be')
    const r = cli(tmp, 'demo-skill', 'frontend')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /^error: could not save ~\/\.claude\/section-team\/roster-extra\.json \(E[A-Z]+\)$/m)
    assert.ok(!r.stderr.includes(homeOf(tmp)), r.stderr)
  }))
})

describe('add-skill procedure', () => {
  const procedure = readFileSync(join(ROOT, 'skills', 'add-skill', 'SKILL.md'), 'utf8')

  test('clones keep the repo line endings (no CRLF conversion on Windows)', () => {
    const clones = procedure.match(/git[^`\n]*\bclone\b[^`\n]*/g) ?? []
    assert.ok(clones.length > 0, 'procedure has a clone command')
    for (const cmd of clones) assert.match(cmd, /-c core\.autocrlf=false/, cmd)
  })

  test('a section-suggested skill with a clean review installs without a question; any red flag stops it', () => {
    assert.ok(procedure.includes('instructions to fetch content from the web at run time and follow it'), 'run-time fetch is a red flag')
    assert.ok(procedure.includes('When the supervisor installs a `Suggested skill:` from a section and its brief says automatic skill installs are on, the user has approved installs that pass this review: skip this question if step 4 found no red flag, and give it to the section that suggested it. Otherwise ask as usual.'), 'no-question path')
    assert.ok(procedure.includes('If step 4 found any red flag, do not install it: tell the user what was flagged.'), 'red flag stops an unattended install')
  })

  test('nothing runs git in the plugin root: assign-skill records the assignment and says when it was already there', () => {
    assert.ok(!procedure.includes('git -C "<plugin root>"'), 'a git command in the plugin root')
    assert.ok(!/\bgit\b[^`\n]*\bcommit\b/.test(procedure), 'a git commit')
    assert.ok(procedure.includes('`node "<plugin root>/scripts/assign-skill.mjs" <name> <section> [<section>...]`'), 'the assign command')
    assert.ok(procedure.includes('`~/.claude/section-team/roster-extra.json`'), 'where assignments live')
    assert.ok(procedure.includes('If it prints `already assigned`, say so.'), 'already-assigned comes from the script')
    assert.ok(procedure.includes('`node "<plugin root>/scripts/assign-skill.mjs" --reapply`'), 'the report says how to restore assignments after an update')
  })

  test('for an unattended install, frontmatter hooks or allowed-tools, executable files and network calls are red flags that turn it into the question', () => {
    const limits = procedure.split('**Unattended limits.**')[1]?.split('\n')[0] ?? ''
    for (const phrase of ['red flags for an unattended install only', '`hooks` or `allowed-tools` key in the frontmatter', 'any executable file', 'mode 100755', 'any network call', 'ask the step 6 question instead', 'without recommending against it', 'not flagged']) {
      assert.ok(limits.includes(phrase), phrase)
    }
  })

  test('the trusted-source check passes the owner and the project root, and only exit 0 installs unattended', () => {
    assert.ok(procedure.includes('`node "<plugin root>/scripts/trusted-source.mjs" "<owner>" "<project root>"` exits 0 (any other exit means ask)'), 'two-argument contract')
    assert.ok(!procedure.includes('an exit of 1 or 2 means ask'), 'old exit wording')
    assert.ok(procedure.includes('`~/.claude/section-team/trusted-sources.json`'), 'where users add owners')
  })
})
