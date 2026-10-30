import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preflightVerdict } from './preflight.mjs'

const init = agents => ({ type: 'system', subtype: 'init', agents })
const result = text => ({ type: 'result', is_error: false, result: text })
const output = (...messages) => JSON.stringify(messages)
const TEAM_AGENTS = ['general-purpose', 'section-team:backend', 'section-team:reviewer']

test('team passes with section-team agents loaded and no automatic skill installs', () => {
  assert.deepEqual(preflightVerdict('team', output(init(TEAM_AGENTS), result('NO'))), [])
})

test('solo passes with no section-team agent', () => {
  assert.deepEqual(preflightVerdict('solo', output(init(['general-purpose']), result('NO'))), [])
})

test('team without the plugin fails: the --settings env replaced the user\'s env and dropped the plugin dir', () => {
  assert.deepEqual(preflightVerdict('team', output(init(['general-purpose']), result('NO'))), ['team: section-team did not load'])
})

test('solo with the plugin, or automatic installs still on, fails', () => {
  assert.deepEqual(preflightVerdict('solo', output(init(TEAM_AGENTS), result('NO'))), ['solo: section-team loaded although it is turned off'])
  assert.deepEqual(preflightVerdict('team', output(init(TEAM_AGENTS), result('YES'))), ['team: automatic skill installs are still on'])
})

test('output it cannot read is a problem, never a pass', () => {
  assert.deepEqual(preflightVerdict('team', 'not json'), ['team: claude output is not JSON'])
  assert.deepEqual(preflightVerdict('team', output(result('NO'))), ['team: no init message with an agents list'])
  assert.deepEqual(preflightVerdict('team', output(init(TEAM_AGENTS), { type: 'result', is_error: true, result: 'API Error' })), ['team: claude ended on an error: API Error'])
})
