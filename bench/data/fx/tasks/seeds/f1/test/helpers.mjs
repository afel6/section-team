import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../timelog.mjs', import.meta.url))

// Runs fn(dir, write) in a fresh temp folder that is deleted afterwards.
export function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'timelog-test-'))
  try {
    return fn(dir, (name, content) => { const p = join(dir, name); writeFileSync(p, content); return p })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Runs the CLI with args; returns { code, out, err }.
export function cli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
