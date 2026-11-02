// Lists the tells in the anonymized solutions before any judge runs: hits of the frozen word list in file contents
// and relative paths, files outside the deliverables, tests and docs, and test lines, per setup through the blind key.
// It only reads; solutions stay as built. SEED/ is not a solution, but its files are left out of the test lines.
// Usage: node bench/leak-scan.mjs --round=mo   (writes results/leak-scan-<round>.json and prints a table)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, relative } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { judgeDirFor } from './anonymize.mjs'
import { NAME, RESULTS } from './run.mjs'
import { codeStats, isTestPath } from './score.mjs'

export const WORDS = ['section-team', 'section', 'supervisor', 'REPORT', 'GRADE', 'reviewer', 'near-miss', 'near miss', 'nearmiss', 'mutant', 'Lean', 'Balanced', 'Max mode', '.team', 'ponytail']

const ALNUM = '[\\p{L}\\p{Nd}]'
const escapeRegExp = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Contents: a - or . joins a word only between two letters or digits, so "Lean." hits and "near-miss-1" does not.
// Before the word: no letter or digit, and no - or . that has one on its left (the word's first character is its right).
// After the word: no letter or digit, and no - or . that has one on its right (the word's last character is its left).
const NOT_JOINED_BEFORE = `(?<!${ALNUM})(?<!${ALNUM}[.-](?=${ALNUM}))`
const NOT_JOINED_AFTER = `(?!${ALNUM})(?!(?<=${ALNUM})[.-]${ALNUM})`
const contentPattern = word => new RegExp(`${NOT_JOINED_BEFORE}${escapeRegExp(word)}${NOT_JOINED_AFTER}`, 'giu')
// Paths: only letters and digits join a word, so /, -, . and _ end a name part ("near-miss-1-parse.mjs" hits).
const pathPattern = word => new RegExp(`(?<!${ALNUM})${escapeRegExp(word)}(?!${ALNUM})`, 'giu')
const CONTENT_PATTERNS = WORDS.map(word => [word, contentPattern(word)])
const PATH_PATTERNS = WORDS.map(word => [word, pathPattern(word)])

const count = (patterns, text) => Object.fromEntries(patterns.map(([word, re]) => [word, text.match(re)?.length ?? 0]).filter(([, n]) => n > 0))
const sumHits = list => Object.fromEntries(WORDS.map(word => [word, list.reduce((n, hits) => n + (hits[word] ?? 0), 0)]).filter(([, n]) => n > 0))

// { [word]: count } of case-insensitive whole-word matches, only words that hit.
export const scanText = text => count(CONTENT_PATTERNS, text)

const DELIVERABLE_EXT = new Set(['.mjs', '.js', '.cjs', '.html', '.css', '.json'])
// package.json, *.md (case-sensitive, as the brief writes it), a code file or a test file; anything else is extra.
const isExpectedFile = rel => basename(rel) === 'package.json' || rel.endsWith('.md') || DELIVERABLE_EXT.has(extname(rel)) || isTestPath(rel)

// One entry per non-folder under dir. A file link is scanned by name only (its target is not read); on Windows,
// readdirSync's recursive walk follows a folder junction, so the junction is listed by name and its files are scanned.
function scanFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => !e.isDirectory()).map(e => {
    const path = join(e.parentPath, e.name)
    const rel = relative(dir, path).replace(/\\/g, '/')
    const pathHits = count(PATH_PATTERNS, rel)
    const contentHits = e.isFile() ? scanText(readFileSync(path, 'utf8')) : {}
    return { rel, hits: sumHits([pathHits, contentHits]), extra: !isExpectedFile(rel) || Object.keys(pathHits).length > 0 }
  })
}

// One solution: word hits in contents and relative paths, the extra paths (sorted), and test lines (score.mjs's
// code.testLines, leaving out files byte-identical to seedDir's same path).
export function scanSolution(dir, seedDir = null) {
  const files = scanFiles(dir)
  return {
    hits: sumHits(files.map(f => f.hits)),
    extraPaths: files.filter(f => f.extra).map(f => f.rel).sort(),
    testLines: codeStats(dir, seedDir).testLines,
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const GROUP = /^[A-Za-z0-9]+-r\d+$/
const LABEL = /^[WXYZ]$/
const COND = /^[A-Za-z0-9-]+$/

// The key's { group, label, cond } entries; every name becomes part of a path, so each is checked.
function solutionsOf(key) {
  if (!isRecord(key)) throw new TypeError('the blind key must be an object of groups')
  return Object.entries(key).flatMap(([group, labels]) => {
    if (!GROUP.test(group)) throw new RangeError(`blind key: group "${group}" is not <task>-r<rep>`)
    if (!isRecord(labels)) throw new TypeError(`blind key: the labels of ${group} must be an object`)
    return Object.entries(labels).map(([label, cond]) => {
      if (!LABEL.test(label)) throw new RangeError(`blind key: label "${label}" in ${group} is not W, X, Y or Z`)
      if (typeof cond !== 'string' || !COND.test(cond)) throw new RangeError(`blind key: the setup of ${group}/${label} is not a plain name`)
      return { group, label, cond }
    })
  })
}

function scanOne(judgeDir, { group, label, cond }) {
  const dir = join(judgeDir, group, label)
  if (!existsSync(dir)) throw new Error(`${group}/${label}: solution folder missing in ${judgeDir}; finish that run, then run node bench/anonymize.mjs again`)
  const seed = join(judgeDir, group, 'SEED')
  const scan = scanSolution(dir, existsSync(seed) ? seed : null)
  return { cond, ...scan, extraPaths: scan.extraPaths.map(rel => `${group}/${label}/${rel}`) }
}

// { [cond]: { hits, extraPaths, testLines } } summed over each setup's solutions, setups sorted by name.
export function leakScan({ judgeDir, key }) {
  const scans = solutionsOf(key).map(solution => scanOne(judgeDir, solution))
  const conds = [...new Set(scans.map(s => s.cond))].sort()
  return Object.fromEntries(conds.map(cond => {
    const mine = scans.filter(s => s.cond === cond)
    return [cond, {
      hits: sumHits(mine.map(s => s.hits)),
      extraPaths: mine.flatMap(s => s.extraPaths).sort(),
      testLines: mine.reduce((n, s) => n + s.testLines, 0),
    }]
  }))
}

const HEADER = ['setup', 'word hits', 'extra paths', 'test lines']
const wordHits = hits => Object.entries(hits).map(([word, n]) => `${word} ${n}`).join(', ') || 'none'

export function formatTable(scan) {
  const line = values => `| ${values.map(v => String(v).replaceAll('|', '\\|')).join(' | ')} |`
  const rows = Object.entries(scan).map(([cond, s]) => line([cond, wordHits(s.hits), s.extraPaths.length, s.testLines]))
  return [line(HEADER), `|${HEADER.map(() => '---').join('|')}|`, ...rows].join('\n')
}

// A missing key keeps its ENOENT (main names the step that makes it); other read failures and bad JSON get their own line.
function readKey(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    if (err.code === 'EISDIR') throw new Error(`${path} is a folder, not a file`, { cause: err })
    if (err.code === 'EACCES' || err.code === 'EPERM') throw new Error(`no permission to read ${path}`, { cause: err })
    throw err
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path}: not valid JSON`, { cause: err })
  }
}

export function main(argv = process.argv.slice(2), { results = RESULTS, home = homedir() } = {}) {
  const round = argv.find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!NAME.test(round)) {
    console.error('usage: node bench/leak-scan.mjs --round=<tag>   (letters and digits only)')
    process.exitCode = 1
    return
  }
  try {
    const scan = leakScan({ judgeDir: judgeDirFor(round, home), key: readKey(join(results, `blind-key-${round}.json`)) })
    writeFileSync(join(results, `leak-scan-${round}.json`), JSON.stringify(scan, null, 2) + '\n')
    console.log(formatTable(scan))
  } catch (err) {
    console.error(`leak-scan: ${err.code === 'ENOENT' ? `missing ${err.path}: run node bench/anonymize.mjs --round=${round} first` : err.message}`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) main()
