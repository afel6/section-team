import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../hooks/lib/redact.mjs'

// Every value here is made up for the test.
test('NAME=value is redacted when the name says key, token, secret or password, in any case, and keeps its name', () => {
  assert.equal(redact('export API_KEY=abc123 && run'), 'export API_KEY=[redacted] && run')
  assert.equal(redact('GITHUB_TOKEN=t0k3n npm publish'), 'GITHUB_TOKEN=[redacted] npm publish')
  assert.equal(redact('client_secret=s3cr3t'), 'client_secret=[redacted]')
  assert.equal(redact('mysql --password=hunter2 -u root'), 'mysql --password=[redacted] -u root')
  assert.equal(redact('$env:Db_Password="two words"; go'), '$env:Db_Password=[redacted]; go')
  assert.equal(redact("AUTH_TOKEN='a b c' next"), 'AUTH_TOKEN=[redacted] next')
  assert.equal(redact('NODE_ENV=production PORT=3000'), 'NODE_ENV=production PORT=3000', 'other names stay')
})

test('a Bearer token is redacted; the word bearer in prose is not', () => {
  assert.equal(redact('curl -H "Authorization: Bearer eyJhbGci.payload.sig-_~+/=" https://x'), 'curl -H "Authorization: Bearer [redacted]" https://x')
  assert.equal(redact('bearer abcdefghij.klmnopqrst'), 'bearer [redacted]')
  assert.equal(redact('Send a bearer token in the Authorization header.'), 'Send a bearer token in the Authorization header.')
})

test('a PEM block is redacted whole; one cut off before its END line loses only its key lines', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA==\n-----END RSA PRIVATE KEY-----'
  assert.equal(redact(`key:\n${pem}\nafter`), 'key:\n[redacted]\nafter')
  assert.equal(redact('x -----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXktdjEAAAAA\nAAAABG5vbmUAAAAEbm9uZQ'), 'x [redacted]')
  const spec = 'The file starts with -----BEGIN CERTIFICATE----- and the parser must accept it.\nThe rest of the request stays.'
  assert.equal(redact(spec), 'The file starts with [redacted] and the parser must accept it.\nThe rest of the request stays.')
})

test('sk- and gh*_ tokens are redacted; short look-alikes are not', () => {
  assert.equal(redact('use sk-ant-api03-abcdefghijklmnop1234 now'), 'use [redacted] now')
  assert.equal(redact('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), '[redacted]')
  assert.equal(redact('gho_abcdefghijklmnopqrstuvwxyz0123456789 x'), '[redacted] x')
  assert.equal(redact('pip install scikit-learn; task-runner sk-1'), 'pip install scikit-learn; task-runner sk-1')
})

test('text with nothing to redact comes back the same, and a non-string becomes text', () => {
  assert.equal(redact('npm test > .team/tmp/backend/run1.log'), 'npm test > .team/tmp/backend/run1.log')
  assert.equal(redact(undefined), '')
  assert.equal(redact(5), '5')
})

test('a long run of name characters with no = stays fast', () => {
  const run = 'keytoken'.repeat(128 * 1024) // 1 MB
  const started = performance.now()
  assert.equal(redact(run), run)
  assert.equal(redact(`${run}=x`).endsWith('=x'), true, 'a name longer than the limit is not read as a name')
  assert.ok(performance.now() - started < 1000, `took ${performance.now() - started} ms`)
})
