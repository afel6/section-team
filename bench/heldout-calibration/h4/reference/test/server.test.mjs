// Startup of `node server.mjs` as its own process: PORT, DATA_FILE and the stdout/stderr contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { booking, send, spawnServer, stopServer, tempDir } from './helpers.mjs'

async function withRun(options, fn) {
  const run = await spawnServer(options)
  try {
    await fn(run)
  } finally {
    await stopServer(run)
  }
}

// For a start that should fail: a server that listens anyway is stopped, so the test fails instead of hanging.
async function exitedRun(options) {
  const run = await spawnServer(options)
  await stopServer(run)
  return run
}

const post = (port, fields) => send(port, {
  method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(booking(fields)),
})

test('prints exactly one listening line with the bound port (PORT=0)', async () => {
  const { dir, cleanup } = tempDir()
  try {
    await withRun({ cwd: dir, env: { PORT: '0', DATA_FILE: '' } }, async run => {
      assert.equal(run.code, null, run.stderr)
      assert.equal(run.stdout, `listening on http://127.0.0.1:${run.port}\n`)
      assert.notEqual(run.port, 0)
      assert.equal((await post(run.port, {})).status, 201)
      assert.ok(existsSync(join(dir, 'bookings.json')), 'the default data file is in the working directory')
    })
  } finally {
    cleanup()
  }
})

test('an invalid PORT writes one stderr line and exits 1, before the data file is read', async () => {
  const { dir, cleanup } = tempDir()
  try {
    mkdirSync(join(dir, 'folder'))
    for (const port of ['abc', '-1', '+80', ' 80', '80 ', '1e3', '3000.0', '65536', '99999999999999999999', '٣٠٠٠']) {
      const run = await exitedRun({ cwd: dir, env: { PORT: port, DATA_FILE: 'folder' } })
      assert.equal(run.code, 1, `PORT=${port}`)
      assert.equal(run.stdout, '')
      assert.match(run.stderr, /^[^\n]+\n$/, `one line for PORT=${port}`)
      assert.doesNotMatch(run.stderr, /cannot read data file/)
    }
  } finally {
    cleanup()
  }
})

test('a PORT in use writes one stderr line and exits 1', async () => {
  const blocker = createServer()
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve))
  const { dir, cleanup } = tempDir()
  try {
    const run = await exitedRun({ cwd: dir, env: { PORT: String(blocker.address().port), DATA_FILE: 'b.json' } })
    assert.equal(run.code, 1)
    assert.equal(run.stdout, '')
    assert.match(run.stderr, /^[^\n]+\n$/)
  } finally {
    blocker.close()
    cleanup()
  }
})

test('an unreadable or damaged data file: "cannot read data file <name>" and exit 1', async () => {
  const { dir, cleanup } = tempDir()
  try {
    mkdirSync(join(dir, 'folder'))
    writeFileSync(join(dir, 'empty.json'), '')
    writeFileSync(join(dir, 'broken.json'), '{"nextId":')
    writeFileSync(join(dir, 'null.json'), 'null')
    for (const name of ['folder', 'empty.json', 'broken.json', 'null.json', './broken.json', join(dir, 'broken.json')]) {
      const run = await exitedRun({ cwd: dir, env: { PORT: '0', DATA_FILE: name } })
      assert.equal(run.code, 1, name)
      assert.equal(run.stdout, '')
      assert.equal(run.stderr, `cannot read data file ${name}\n`)
    }
  } finally {
    cleanup()
  }
})

test('a missing data file or folder means no bookings; DATA_FILE is relative to the working directory', async () => {
  const { dir, cleanup } = tempDir()
  try {
    mkdirSync(join(dir, 'data'))
    await withRun({ cwd: dir, env: { PORT: '0', DATA_FILE: join('nope', 'b.json') } }, async run => {
      assert.deepEqual((await send(run.port, { path: '/api/bookings' })).json(), { bookings: [] })
      assert.equal((await post(run.port, {})).status, 500, 'no folder is created')
      assert.equal(existsSync(join(dir, 'nope')), false)
    })
    await withRun({ cwd: dir, env: { PORT: '0', DATA_FILE: join('data', 'b.json') } }, async run => {
      assert.equal((await post(run.port, {})).status, 201)
    })
    assert.equal(JSON.parse(readFileSync(join(dir, 'data', 'b.json'), 'utf8')).bookings.length, 1)
  } finally {
    cleanup()
  }
})

test('bookings and the next id survive a restart; outside edits are not noticed while running', async () => {
  const { dir, cleanup } = tempDir()
  const env = { PORT: '0', DATA_FILE: 'b.json' }
  try {
    await withRun({ cwd: dir, env }, async run => {
      await post(run.port, {})
      await post(run.port, { start: '10:00', end: '11:00' })
      assert.equal((await send(run.port, { method: 'DELETE', path: '/api/bookings/2' })).status, 204)
      writeFileSync(join(dir, 'b.json'), 'garbage')
      assert.equal((await send(run.port, { path: '/api/bookings' })).json().bookings.length, 1)
      assert.equal((await post(run.port, { start: '12:00', end: '13:00' })).json().id, 3)
    })
    await withRun({ cwd: dir, env }, async run => {
      assert.deepEqual((await send(run.port, { path: '/api/bookings' })).json().bookings.map(b => b.id), [1, 3])
      assert.equal((await post(run.port, { start: '14:00', end: '15:00' })).json().id, 4)
    })
  } finally {
    cleanup()
  }
})
