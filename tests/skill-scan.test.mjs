import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The add-skill review greps a fetched skill for hostile content. These tests run the grep patterns SKILL.md
// itself gives against hostile fixtures: the pattern is what is tested, not the prose around it.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROCEDURE = readFileSync(join(ROOT, 'skills', 'add-skill', 'SKILL.md'), 'utf8')
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'hostile-skills')

// Each scan in SKILL.md reads: [LC_ALL=C.UTF-8 ]grep -<flags> '<pattern>' "<skill dir>" (every file) or "<skill dir>/SKILL.md" (that file only).
const SCAN = /(LC_ALL=C\.UTF-8 )?grep -([a-zA-Z]+) '([^']+)' "<skill dir>(\/SKILL\.md)?"/g
const SCANS = [...PROCEDURE.matchAll(SCAN)].map(([, utf8, flags, pattern, only]) => ({ utf8: Boolean(utf8), flags, pattern, skillMdOnly: Boolean(only) }))
const UTF8 = { ...process.env, LC_ALL: 'C.UTF-8' }

// grep's PCRE \x{HHHH} is JavaScript's \u{HHHH}; everything else these patterns use reads the same in both.
const toRegExp = pattern => new RegExp(pattern.replace(/\\x\{([0-9A-Fa-f]+)\}/g, '\\u{$1}'), 'u')
// grep matches line by line, and a CRLF line keeps its \r.
const hits = (pattern, text) => text.split('\n').some(line => toRegExp(pattern).test(line))
const appliesTo = (scan, rel) => !scan.skillMdOnly || rel === 'SKILL.md'

const fixtureFiles = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile())
  .map(e => {
    const file = join(e.parentPath, e.name)
    return { file, rel: file.slice(dir.length + 1).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }
  })
const FIXTURE_DIRS = readdirSync(FIXTURES).map(name => join(FIXTURES, name))

const CLEAN = [
  '---',
  'name: table-format',
  'description: Formats Markdown tables when the user asks for a table.',
  '---',
  '# Format tables',
  '',
  'Run `npm test` after a change. Done! It sets no hooks and asks for no allowed-tools.',
  '',
  '```js',
  'const rows = [1, 2]',
  '```',
  'See https://example.com/docs for the table syntax.',
  '',
].join('\n')

test('SKILL.md gives the scans these tests read, in flags this test can translate', () => {
  assert.ok(SCANS.length >= 4, `scans found: ${SCANS.length}`)
  for (const { flags } of SCANS) assert.match(flags, /^[rnPE]+$/)
  // Git Bash's grep refuses -P outside a UTF-8 locale (exit 2), and the \x{HHHH} ranges need one.
  for (const scan of SCANS.filter(s => s.flags.includes('P'))) assert.ok(scan.utf8, `no LC_ALL=C.UTF-8 before ${scan.pattern}`)
  assert.ok(SCANS.some(s => s.pattern.includes('\\x{2066}-\\x{2069}')), 'the hidden-character scan covers the bidi isolates')
  assert.ok(SCANS.some(s => s.skillMdOnly), 'a frontmatter scan of SKILL.md')
})

test('every file of every hostile fixture is hit by a scan from SKILL.md, with LF or CRLF line endings', () => {
  assert.deepEqual(FIXTURE_DIRS.map(d => basename(d)).sort(), ['bidi-isolate', 'frontmatter-hook', 'inline-command'])
  for (const dir of FIXTURE_DIRS) {
    for (const { rel, text } of fixtureFiles(dir)) {
      for (const body of [text, text.replace(/\n/g, '\r\n')]) {
        assert.ok(SCANS.some(s => appliesTo(s, rel) && hits(s.pattern, body)), `${basename(dir)}/${rel} is not hit`)
      }
    }
  }
})

test('a clean skill is hit by no scan', () => {
  for (const scan of SCANS) assert.ok(!hits(scan.pattern, CLEAN), scan.pattern)
})

test('the bidi fixture needs the isolate range: the scan before 0.6.0 missed it', () => {
  const before = '[\\x{200B}-\\x{200F}\\x{2060}\\x{FEFF}\\x{202A}-\\x{202E}\\x{E0000}-\\x{E007F}]'
  const text = readFileSync(join(FIXTURES, 'bidi-isolate', 'SKILL.md'), 'utf8')
  assert.ok(!hits(before, text))
  assert.ok(/[⁦-⁩]/u.test(text))
})

test('SKILL.md carries no command Claude Code would run when the skill loads', () => {
  assert.ok(!PROCEDURE.includes('!`'), 'an inline command')
  assert.ok(!/^\s*(```|~~~)\s*!/m.test(PROCEDURE), 'a fenced command block')
})

test('SKILL.md counts a scan that could not run as a red flag', () => {
  assert.ok(PROCEDURE.includes('an exit of 2 means the scan did not run'), 'grep exit 2')
})

// Where a grep with -P is on PATH (Linux, Git Bash), the real grep agrees with the translation above on every file.
// The pattern goes in a file (-f): on Windows a native parent's argv loses the backslashes on the way to Git Bash's grep,
// which a bash command line does not.
test('real grep agrees with these results', t => {
  const probe = spawnSync('grep', ['-P', 'x'], { input: 'x', encoding: 'utf8', env: UTF8 })
  if (probe.status !== 0) return t.skip('no grep with -P on PATH here')
  const tmp = mkdtempSync(join(tmpdir(), 'st-scan-'))
  try {
    const clean = join(tmp, 'SKILL.md')
    const patternFile = join(tmp, 'pattern.txt')
    writeFileSync(clean, CLEAN)
    const files = [...FIXTURE_DIRS.flatMap(fixtureFiles), { file: clean, rel: 'SKILL.md', text: CLEAN }]
    for (const scan of SCANS) {
      writeFileSync(patternFile, `${scan.pattern}\n`)
      for (const { file, rel, text } of files.filter(f => appliesTo(scan, f.rel))) {
        const real = spawnSync('grep', [`-${scan.flags}`, '-f', patternFile, file], { encoding: 'utf8', env: scan.utf8 ? UTF8 : process.env })
        assert.notEqual(real.status, 2, `${scan.pattern} on ${rel}: ${real.stderr}`)
        assert.equal(real.status === 0, hits(scan.pattern, text), `${scan.pattern} on ${file}`)
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
