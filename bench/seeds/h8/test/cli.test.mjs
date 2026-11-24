import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../loans.mjs', import.meta.url))

function cli(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, LOANS_FILE: '', ...env }, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function inTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loans-cli-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the data file is loans.json in the current folder unless LOANS_FILE says otherwise', () => inTempDir(dir => {
  assert.deepEqual(cli(dir, ['add', 'Drill', '--to', 'Sam']), { code: 0, stdout: 'added #1\n', stderr: '' })
  assert.ok(existsSync(join(dir, 'loans.json')))
  assert.deepEqual(cli(dir, ['add', 'Tent', '--to', 'Kim'], { LOANS_FILE: 'other.json' }).stdout, 'added #1\n')
  assert.deepEqual(readdirSync(dir).sort(), ['loans.json', 'other.json'], 'no temp file is left behind')
}))

test('a damaged data file is an error, and the usage goes to stderr with exit 2', () => inTempDir(dir => {
  writeFileSync(join(dir, 'loans.json'), '{"loans": ')
  assert.deepEqual(cli(dir, ['list']), { code: 1, stdout: '', stderr: 'error: data file loans.json is damaged\n' })
  const usage = cli(dir, [])
  assert.equal(usage.code, 2)
  assert.match(usage.stderr, /^usage: node loans\.mjs <command>/)
}))
