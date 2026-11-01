import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { modeRecordDir, modeRecordFile, readRecord, recordMode } from '../hooks/lib/mode-record.mjs'

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
  for (const mode of ['lean', 'balanced', 'max']) {
    recordMode(h, 's1', mode)
    assert.equal(readRecord(h, 's1'), mode)
  }
  assert.equal(readRecord(h, 'other'), null)
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
