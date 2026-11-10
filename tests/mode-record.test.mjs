import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { modeRecordDir, modeRecordFile, readBriefHash, readRecord, recordBriefHash, recordMode } from '../hooks/lib/mode-record.mjs'

const tempHome = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-home-')))
const recordFile = (home, id) => join(home, '.claude', 'section-team', 'modes', `${id}.json`)
const hookText = name => readFileSync(fileURLToPath(new URL(`../hooks/${name}.mjs`, import.meta.url)), 'utf8')
const writeRecordText = (home, id, text) => {
  mkdirSync(join(home, '.claude', 'section-team', 'modes'), { recursive: true })
  writeFileSync(recordFile(home, id), text)
}

test('modeRecordDir is the modes folder under the section-team home', () => {
  assert.equal(modeRecordDir('H'), 'H/.claude/section-team/modes')
})

test('modeRecordFile names the session file and refuses a bad id', () => {
  assert.equal(modeRecordFile('H', 's1'), 'H/.claude/section-team/modes/s1.json')
  assert.throws(() => modeRecordFile('H', '../x'), /session id/)
  assert.throws(() => modeRecordFile('H', '../x'), { message: 'no usable session id (letters, digits, - and _ only)' })
})

test('recordMode refuses a bad session id or mode and writes nothing outside the modes folder', () => {
  const h = tempHome()
  for (const id of ['../x', 'a/b', 'a\\b', '', 'x'.repeat(129), null, undefined, 42]) {
    assert.throws(() => recordMode(h, id, 'max'), /session id/, String(id))
  }
  assert.equal(existsSync(join(h, '.claude', 'section-team', 'x.json')), false)
  assert.throws(() => recordMode(h, 'ok', 'turbo'), /unknown mode/)
  recordMode(h, 'x'.repeat(128), 'max')
  assert.equal(readFileSync(recordFile(h, 'x'.repeat(128)), 'utf8'), '{"mode":"max"}')
})

test('readRecord gives null when the session has no record', () => {
  assert.equal(readRecord(tempHome(), 's1'), null)
})

test('readRecord gives the mode recordMode saved', () => {
  const h = tempHome()
  for (const mode of ['balanced', 'max']) {
    recordMode(h, 's1', mode)
    assert.equal(readRecord(h, 's1'), mode)
  }
  assert.equal(readRecord(h, 'other'), null)
})

test('a record from before 0.3.0 still reads as lean (callers run it as balanced), and lean cannot be recorded any more', () => {
  const h = tempHome()
  writeRecordText(h, 's1', '{"mode":"lean"}')
  assert.equal(readRecord(h, 's1'), 'lean')
  assert.throws(() => recordMode(h, 's2', 'lean'), /unknown mode/)
})

test('readRecord refuses a bad session id', () => {
  const h = tempHome()
  for (const id of ['../x', null, undefined, 42]) {
    assert.throws(() => readRecord(h, id), /session id/, String(id))
  }
})

test('readRecord says the record is not valid for text recordMode could not have written', () => {
  const h = tempHome()
  for (const text of ['{not json', '{"mode":"turbo"}', '[]', '"max"', '{}']) {
    writeRecordText(h, 's1', text)
    assert.throws(() => readRecord(h, 's1'), { message: 'mode record is not valid' }, text)
  }
})

test('readRecord rethrows any other read error with its code', () => {
  const h = tempHome()
  mkdirSync(recordFile(h, 's1'), { recursive: true })
  assert.throws(() => readRecord(h, 's1'), err => err?.code === 'EISDIR')
})

test('the hooks share the mode-record module; session-start no longer exports the record helpers', async () => {
  for (const name of ['session-start', 'user-prompt-submit', 'pre-tool-use']) {
    assert.ok(hookText(name).includes("from './lib/mode-record.mjs'"), name)
  }
  assert.ok(!hookText('user-prompt-submit').includes('session-start.mjs'))
  const sessionStart = await import('../hooks/session-start.mjs')
  for (const name of ['recordMode', 'modeRecordFile', 'modeRecordDir']) {
    assert.equal(sessionStart[name], undefined, name)
  }
})

// The brief a session was given, kept as its sha256 so a resume can leave an unchanged brief out.
const HASH = 'a'.repeat(64)
const briefFile = (home, id) => join(home, '.claude', 'section-team', 'modes', `${id}.brief.json`)

test('recordBriefHash saves {"brief":"<hex>"} next to the mode record, and readBriefHash reads it back', () => {
  const h = tempHome()
  assert.equal(readBriefHash(h, 's1'), null)
  recordBriefHash(h, 's1', HASH)
  assert.equal(readFileSync(briefFile(h, 's1'), 'utf8'), `{"brief":"${HASH}"}`)
  assert.equal(readBriefHash(h, 's1'), HASH)
  assert.equal(readBriefHash(h, 'other'), null)
})

test('the brief record helpers refuse a bad session id, an invalid record, and keep any other read error', () => {
  const h = tempHome()
  for (const id of ['../x', 'a/b', '', null, undefined, 42]) {
    assert.throws(() => recordBriefHash(h, id, HASH), /session id/, String(id))
    assert.throws(() => readBriefHash(h, id), /session id/, String(id))
  }
  assert.equal(existsSync(join(h, '.claude')), false)
  for (const text of ['{not json', '{"brief":"abc"}', `{"brief":"${'A'.repeat(64)}"}`, '{}', '[]']) {
    writeRecordText(h, 's1.brief', text)
    assert.throws(() => readBriefHash(h, 's1'), { message: 'brief record is not valid' }, text)
  }
  mkdirSync(briefFile(h, 's2'), { recursive: true })
  assert.throws(() => readBriefHash(h, 's2'), err => err?.code === 'EISDIR')
})
