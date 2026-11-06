import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url))

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'parts-'))
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: '0', DB_FILE: join(dir, 'parts.db') }, stdio: ['ignore', 'pipe', 'ignore'] })
  const [line] = await once(child.stdout, 'data')
  const port = /:(\d+)\n/.exec(String(line))[1]
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    child.kill('SIGKILL')
    await once(child, 'exit')
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('a part gets moves, and the running balance stays at or above zero', () => withServer(async base => {
  const part = await (await post(`${base}/api/parts`, { sku: 'A-1', name: ' Bolt ' })).json()
  assert.equal(part.name, 'Bolt')
  assert.equal((await post(`${base}/api/parts/${part.id}/moves`, { on_date: '2026-03-10', qty: 5, unit_cost_cents: 100 })).status, 201)
  const early = await post(`${base}/api/parts/${part.id}/moves`, { on_date: '2026-03-01', qty: -1, unit_cost_cents: 100 })
  assert.deepEqual([early.status, (await early.json()).error], [409, 'stock would go below zero on 2026-03-01'])
  const after = await (await fetch(`${base}/api/parts/${part.id}`)).json()
  assert.deepEqual([after.on_hand, after.value_cents], [5, '500'])
}))
