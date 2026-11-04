import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../lib/app.mjs'
import { loadState } from '../lib/store.mjs'

export const SERVER = join(import.meta.dirname, '..', 'server.mjs')
const START_LIMIT_MS = 10000

// A fresh temp folder; cleanup() deletes it.
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'bookings-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// One request sent with node:http, so the path reaches the server byte for byte (fetch would normalise it).
// A body gets an explicit Content-Length unless the headers choose chunked encoding: without one, node:http
// sends a GET or DELETE body unframed and the server reads it as the next request.
export function send(port, { method = 'GET', path, headers = {}, body }) {
  const framed = body === undefined || 'Transfer-Encoding' in headers ? headers : { ...headers, 'Content-Length': Buffer.byteLength(body) }
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: framed, agent: false }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// The app in this process on a free port, around the state in file. call() sends one request.
export async function startApp(file) {
  const server = createApp(file, loadState(file))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  return {
    port,
    call: (method, path, options = {}) => send(port, { method, path, ...options }),
    post: fields => send(port, { method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, body: JSON.stringify(fields) }),
    stop: () => new Promise(resolve => server.close(resolve)),
  }
}

// Runs fn(app, dir) with an app on a data file in a fresh temp folder, then stops it and deletes the folder.
export async function withApp(fn, fileName = 'bookings.json') {
  const { dir, cleanup } = tempDir()
  const app = await startApp(join(dir, fileName))
  try {
    await fn(app, dir)
  } finally {
    await app.stop()
    cleanup()
  }
}

// Runs `node server.mjs` with env added to this process's env. Resolves once it prints its line or exits:
// { child, port, stdout, stderr, code } (code is null while it runs). stop() kills it.
export function spawnServer({ env = {}, cwd } = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd, env: { ...process.env, ...env }, windowsHide: true })
  const out = { child, port: null, stdout: '', stderr: '', code: null }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server gave no sign within ${START_LIMIT_MS} ms`)), START_LIMIT_MS)
    const done = () => { clearTimeout(timer); resolve(out) }
    child.stderr.on('data', d => { out.stderr += d })
    child.stdout.on('data', d => {
      out.stdout += d
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)\n/.exec(out.stdout)
      if (match && out.port === null) { out.port = Number(match[1]); done() }
    })
    // 'close', not 'exit': it fires once stdout and stderr are fully read.
    child.on('close', code => { out.code = code; done() })
  })
}

export function stopServer(run) {
  if (run.child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    run.child.once('exit', resolve)
    run.child.kill()
  })
}

export const booking = (overrides = {}) => ({
  room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides,
})
