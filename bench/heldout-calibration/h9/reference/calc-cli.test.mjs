import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('./calc-cli.mjs', import.meta.url))
const run = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

test('prints the value with at most 12 significant digits', () => {
  assert.deepEqual(run('0.1+0.2'), { code: 0, out: '0.3\n', err: '' })
  assert.deepEqual(run('1/3'), { code: 0, out: '0.333333333333\n', err: '' })
  assert.deepEqual(run('-2*3'), { code: 0, out: '-6\n', err: '' })
})

test('variables come from name=value arguments', () => {
  assert.deepEqual(run('x*y', 'x=2', 'y=-3.5'), { code: 0, out: '-7\n', err: '' })
  assert.deepEqual(run('1', 'x=+1'), { code: 2, out: '', err: 'Error: bad variable x=+1\n' })
  assert.deepEqual(run('1', 'x=1', 'x=2'), { code: 2, out: '', err: 'Error: variable x given twice\n' })
})

test('usage and expression errors', () => {
  assert.deepEqual(run(), { code: 2, out: '', err: 'Usage: node calc-cli.mjs <expression> [<name>=<value>]...\n' })
  assert.deepEqual(run('1/0'), { code: 1, out: '', err: 'Error: division by zero at 1\n' })
})
