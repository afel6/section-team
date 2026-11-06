import { readFileSync } from 'node:fs'
import { isMainModule } from '../hooks/lib/paths.mjs'

export const SOURCES_FILE = new URL('../skills/add-skill/trusted-sources.json', import.meta.url)

// Exact, case-insensitive match: no prefixes, no trimming, no pattern syntax.
export function isTrusted(owner, list) {
  return typeof owner === 'string' && owner !== '' && Array.isArray(list)
    && list.some(o => typeof o === 'string' && o.toLowerCase() === owner.toLowerCase())
}

// Returns {code, message}: 0 trusted, 1 not trusted, 2 unusable list.
export function check(owner, file = SOURCES_FILE) {
  let list
  try {
    list = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return { code: 2, message: `trusted-sources.json is missing or not valid JSON (${err.code ?? 'parse error'})` }
  }
  if (!Array.isArray(list) || !list.every(o => typeof o === 'string')) return { code: 2, message: 'trusted-sources.json must be an array of owner names' }
  return isTrusted(owner, list) ? { code: 0 } : { code: 1 }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    console.error('usage: trusted-source.mjs <owner>')
    process.exit(2)
  }
  const { code, message } = check(args[0])
  if (message) console.error(message)
  process.exit(code)
}
