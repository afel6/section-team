import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server.mjs'

// A data file in a fresh temp folder; cleanup() deletes the folder.
export function tempDataFile() {
  const dir = mkdtempSync(join(tmpdir(), 'stock-test-'))
  return { file: join(dir, 'stock.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Starts the app on a free port. call(method, path, body) sends one request; stop() closes the server.
export async function startApp(dataFile) {
  const server = createApp(dataFile)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    call: (method, path, body) => request(base + path, method, body),
    stop: () => new Promise(resolve => server.close(resolve)),
  }
}

// Runs fn with a running app on its own data file, then stops it and deletes the file.
export async function withApp(fn) {
  const data = tempDataFile()
  const app = await startApp(data.file)
  try {
    await fn(app.call)
  } finally {
    await app.stop()
    data.cleanup()
  }
}

async function request(url, method, body) {
  const init = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const res = await fetch(url, init)
  const text = await res.text()
  const isJson = (res.headers.get('content-type') ?? '').startsWith('application/json')
  return { status: res.status, headers: res.headers, text, body: isJson ? JSON.parse(text) : undefined }
}
