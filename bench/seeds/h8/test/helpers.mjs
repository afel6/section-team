import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../loans.mjs'

// Runs fn(loans, file) with a data file in a fresh temp folder; loans(...args) runs one command on it.
export function withLoans(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loans-test-'))
  const file = join(dir, 'loans.json')
  try {
    return fn((...args) => run(args, file), file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const ok = stdout => ({ code: 0, stdout, stderr: '' })
export const failed = message => ({ code: 1, stdout: '', stderr: `error: ${message}\n` })
