import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const TODO = join(process.env.TARGET_DIR, 'todo.mjs')
const ok = (r, out) => { assert.equal(r.code, 0, r.err); assert.equal(r.out, out) }
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-'))
  return { dir, file: join(dir, 'data.json') }
}
const run = (ctx, ...args) => {
  const r = spawnSync(process.execPath, [TODO, ...args], {
    cwd: ctx.dir,
    env: { ...process.env, TODO_FILE: ctx.file },
    encoding: 'utf8',
    timeout: 15000,
  })
  return { code: r.status, out: (r.stdout ?? '').replace(/\r\n/g, '\n'), err: (r.stderr ?? '').replace(/\r\n/g, '\n') }
}

test('empty list prints No todos', () => {
  const r = run(fresh(), 'list')
  assert.equal(r.code, 0)
  assert.equal(r.out, 'No todos\n')
})

test('add joins words, ids start at 1, list shows open items', () => {
  const ctx = fresh()
  ok(run(ctx, 'add', 'buy', 'milk'), 'Added #1: buy milk\n')
  assert.equal(run(ctx, 'add', 'walk', 'the', 'dog').out, 'Added #2: walk the dog\n')
  assert.equal(run(ctx, 'list').out, '#1 [ ] buy milk\n#2 [ ] walk the dog\n')
})

test('done marks [x], is idempotent', () => {
  const ctx = fresh()
  run(ctx, 'add', 'a')
  run(ctx, 'add', 'b')
  ok(run(ctx, 'done', '1'), 'Completed #1\n')
  assert.equal(run(ctx, 'done', '1').code, 0)
  assert.equal(run(ctx, 'list').out, '#1 [x] a\n#2 [ ] b\n')
})

test('remove deletes and ids are never reused', () => {
  const ctx = fresh()
  run(ctx, 'add', 'a')
  run(ctx, 'add', 'b')
  ok(run(ctx, 'remove', '2'), 'Removed #2\n')
  assert.equal(run(ctx, 'add', 'c').out, 'Added #3: c\n')
  assert.equal(run(ctx, 'list').out, '#1 [ ] a\n#3 [ ] c\n')
})

test('unknown id → exit 1, invalid id → exit 2', () => {
  const ctx = fresh()
  run(ctx, 'add', 'a')
  const nf = run(ctx, 'done', '99')
  assert.equal(nf.code, 1)
  assert.match(nf.err, /Error: not found #99/)
  const nf2 = run(ctx, 'remove', '42')
  assert.equal(nf2.code, 1)
  assert.match(nf2.err, /Error: not found #42/)
  for (const args of [['done', 'abc'], ['done'], ['remove', '1.5']]) {
    const r = run(ctx, ...args)
    assert.equal(r.code, 2, `args ${args.join(' ')}`)
    assert.match(r.err, /Error: invalid id/)
  }
})

test('empty text → exit 2', () => {
  const ctx = fresh()
  for (const args of [['add'], ['add', '   ']]) {
    const r = run(ctx, ...args)
    assert.equal(r.code, 2)
    assert.match(r.err, /Error: text required/)
  }
  assert.equal(run(ctx, 'list').out, 'No todos\n')
})

test('clear-done removes done items and reports the count', () => {
  const ctx = fresh()
  run(ctx, 'add', 'a')
  run(ctx, 'add', 'b')
  run(ctx, 'add', 'c')
  run(ctx, 'done', '1')
  run(ctx, 'done', '3')
  ok(run(ctx, 'clear-done'), 'Cleared 2\n')
  assert.equal(run(ctx, 'list').out, '#2 [ ] b\n')
})

test('missing or unknown command → usage on stderr, exit 2', () => {
  const ctx = fresh()
  for (const args of [[], ['frobnicate']]) {
    const r = run(ctx, ...args)
    assert.equal(r.code, 2)
    assert.match(r.err, /(^|\n)Usage:/)
  }
})

test('corrupt data file → exit 3 and file untouched', () => {
  const ctx = fresh()
  writeFileSync(ctx.file, '{not json')
  for (const args of [['list'], ['add', 'x']]) {
    const r = run(ctx, ...args)
    assert.equal(r.code, 3)
    assert.match(r.err, /Error: corrupt data file/)
  }
  assert.equal(readFileSync(ctx.file, 'utf8'), '{not json')
})

test('data file is valid JSON and no temp files are left behind', () => {
  const ctx = fresh()
  run(ctx, 'add', 'a')
  run(ctx, 'done', '1')
  JSON.parse(readFileSync(ctx.file, 'utf8'))
  assert.deepEqual(readdirSync(ctx.dir), ['data.json'])
})

test('default data file is todo.json in the current directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-default-'))
  const r = spawnSync(process.execPath, [TODO, 'add', 'x'], {
    cwd: dir,
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'TODO_FILE')),
    encoding: 'utf8',
    timeout: 15000,
  })
  assert.equal(r.status, 0)
  assert.ok(existsSync(join(dir, 'todo.json')))
})
