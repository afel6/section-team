import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redact } from '../hooks/lib/redact.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

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

test('prose between a quoted BEGIN line and a quoted END line stays', () => {
  const probe = 'The file starts with -----BEGIN CERTIFICATE----- and the parser must accept it. Lots of other prose here. It ends with -----END CERTIFICATE----- and more.'
  assert.equal(redact(probe), 'The file starts with [redacted] and the parser must accept it. Lots of other prose here. It ends with -----END CERTIFICATE----- and more.')
  assert.equal(redact('Wrap it in -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- lines.'), 'Wrap it in [redacted] and -----END CERTIFICATE----- lines.')
  assert.equal(redact('-----BEGIN CERTIFICATE-----\nnot\n-----END PRIVATE KEY----- here'), '[redacted]\nnot\n-----END PRIVATE KEY----- here', 'an END line with another label does not close the block')
})

test('a PEM block written with \\n as in JSON, with header lines, or indented, is redacted whole', () => {
  // Made-up values.
  const json = String.raw`{"private_key":"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nAAAA==\n-----END PRIVATE KEY-----\n","id":"1"}`
  assert.equal(redact(json), String.raw`{"private_key":"[redacted]\n","id":"1"}`)
  const legacy = '-----BEGIN RSA PRIVATE KEY-----\r\nProc-Type: 4,ENCRYPTED\r\nDEK-Info: AES-128-CBC,0123456789ABCDEF\r\n\r\nMIIEow\r\nAAAA==\r\n-----END RSA PRIVATE KEY-----\r\nafter'
  assert.equal(redact(legacy), '[redacted]\r\nafter')
  const yaml = 'key: |\n    -----BEGIN PRIVATE KEY-----\n    MIIEvQ\n    -----END PRIVATE KEY-----\nnext: 1'
  assert.equal(redact(yaml), 'key: |\n    [redacted]\nnext: 1')
})

test('many BEGIN lines with no END line, blank lines after one, or BEGIN lines in header lines stay fast', () => {
  const lines = '-----BEGIN CERTIFICATE-----\n'.repeat(20 * 1024) // 560 KB
  const blanks = '\r\n  '.repeat(128 * 1024) // 512 KB
  const headers = '-----BEGIN X-----\nk: -----BEGIN X-----\n'
  const started = performance.now()
  assert.equal(redact(lines), '[redacted]\n'.repeat(20 * 1024))
  assert.equal(redact(`-----BEGIN X-----${blanks}`), `[redacted]${blanks}`)
  assert.equal(redact(headers.repeat(14 * 1024)), '[redacted]\nk: [redacted]\n'.repeat(14 * 1024)) // 530 KB
  assert.ok(performance.now() - started < 1000, `took ${performance.now() - started} ms`)
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

// Made-up values, joined at run time so no provider-shaped string sits in the file for a secret scanner to flag.
const fake = (...parts) => parts.join('')
const AWS_ID = fake('AKIA', 'IOSFODNN7EXAMPLE')
const GITHUB_PAT = fake('github_pat_', '11ABCDEFG0123456789abc', '_', 'x'.repeat(59))
const SLACK = fake('xox', 'b-', '123456789012-1234567890123-', 'AbCdEfGhIjKlMnOp')
const GOOGLE = fake('AI', 'za', 'Sy', 'A'.repeat(16), '0123456789abcdefg')
const STRIPE_LIVE = fake('sk_', 'live_', '4eC39HqLyjWDarjtT1zdp7dc')
const STRIPE_TEST = fake('sk_', 'test_', '4eC39HqLyjWDarjtT1zdp7dc')

test('a JSON value whose key names a password, secret, token or API key is redacted; other keys and non-string values stay', () => {
  assert.equal(redact('{"password": "hunter2", "api_key": "abc123", "name": "x"}'), '{"password": "[redacted]", "api_key": "[redacted]", "name": "x"}')
  assert.equal(redact('{"accessToken":"a.b.c","client_secret":"s\\"q","db_password" : "p w"}'), '{"accessToken":"[redacted]","client_secret":"[redacted]","db_password" : "[redacted]"}')
  assert.equal(redact('{"password": ""}'), '{"password": ""}', 'an empty value holds nothing')
})

test('provider tokens are redacted anywhere: AWS key ids, github_pat_, Slack, Google and Stripe keys', () => {
  assert.equal(redact(`aws configure set aws_access_key_id ${AWS_ID}`), 'aws configure set aws_access_key_id [redacted]')
  assert.equal(redact(`git clone https://${GITHUB_PAT}@github.com/o/r`), 'git clone https://[redacted]@github.com/o/r')
  assert.equal(redact(`slack token ${SLACK} here`), 'slack token [redacted] here')
  assert.equal(redact(`maps key ${GOOGLE};`), 'maps key [redacted];')
  assert.equal(redact(`stripe ${STRIPE_LIVE} and ${STRIPE_TEST}`), 'stripe [redacted] and [redacted]')
})

test('the password in a URL is redacted; the user and the host stay', () => {
  assert.equal(redact('git clone https://deploy:s3cretpass@git.example.com/repo.git'), 'git clone https://deploy:[redacted]@git.example.com/repo.git')
  assert.equal(redact('DATABASE_URL=postgres://app:pw@localhost:5432/db'), 'DATABASE_URL=postgres://app:[redacted]@localhost:5432/db')
})

test('an Authorization: Basic value is redacted', () => {
  assert.equal(redact('curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" https://x'), 'curl -H "Authorization: Basic [redacted]" https://x')
  assert.equal(redact('authorization:basic YWRtaW46YWRtaW4='), 'authorization:basic [redacted]')
})

test('passwords in mysql -p<value>, curl -u user:pass and --password or --token <value> are redacted', () => {
  assert.equal(redact('mysql -u root -phunter2 shop'), 'mysql -u root -p[redacted] shop')
  assert.equal(redact("mysqldump -h db -p'two words' shop"), 'mysqldump -h db -p[redacted] shop')
  assert.equal(redact("mysql -p'a;b|c' shop; mysql -px2 && ls -p1"), 'mysql -p[redacted] shop; mysql -p[redacted] && ls -p1', 'a quoted value may hold ; and |; the command ends at the next one')
  assert.equal(redact('curl -u admin:hunter2 https://x'), 'curl -u admin:[redacted] https://x')
  assert.equal(redact('curl -sS --user admin:hunter2 https://x'), 'curl -sS --user admin:[redacted] https://x')
  assert.equal(redact('gh auth login --token abc123def'), 'gh auth login --token [redacted]')
  assert.equal(redact('mysql --password "p@ss word" -u root'), 'mysql --password [redacted] -u root')
})

const BCRYPT = fake('$2b', '$12$', 'a'.repeat(22), 'b'.repeat(31))

test('a value that only starts like a placeholder is redacted; only a whole placeholder stays', () => {
  assert.equal(redact('{"password": "$ecretP@ss"}'), '{"password": "[redacted]"}')
  assert.equal(redact(`{"password": "${BCRYPT}"}`), '{"password": "[redacted]"}')
  assert.equal(redact('postgres://u:%40bc123@host/db'), 'postgres://u:[redacted]@host/db')
  assert.equal(redact('gh auth login --token %3Dabc'), 'gh auth login --token [redacted]')
  assert.equal(redact('mysql -p<abc>def shop'), 'mysql -p[redacted] shop')
  assert.equal(redact('curl -u admin:%40pw https://x'), 'curl -u admin:[redacted] https://x')
  assert.equal(redact('--token ${PGPASSWORD:-hunter2} x'), '--token [redacted] x', 'a default value is a literal, not a placeholder')
})

test('a hyphenated value after --password or --token is a secret, not a prose word', () => {
  assert.equal(redact('--password correct-horse-battery-staple'), '--password [redacted]')
  assert.equal(redact('gh auth login --token abc-def x'), 'gh auth login --token [redacted] x')
})

test('a $( value runs to its matching ) and is redacted whole', () => {
  assert.equal(redact('--token $(echo hunter2) x'), '--token [redacted] x')
  assert.equal(redact('gh auth login --token $(gh auth token)'), 'gh auth login --token [redacted]')
  assert.equal(redact('--token $(cat $(ls ~/k)) x'), '--token [redacted] x', 'one nested $( stays inside')
  assert.equal(redact('mysql -p$(cat ~/.pw) shop'), 'mysql -p[redacted] shop')
  assert.equal(redact('curl -u admin:$(cat pw) https://x'), 'curl -u admin:[redacted] https://x')
  assert.equal(redact('mysql -p$(echo aHVudGVy | base64 -d) shop'), 'mysql -p[redacted] shop', 'a | inside $( does not end the command')
  assert.equal(redact('curl -u admin:$(echo aHVudGVy | base64 -d) https://x'), 'curl -u admin:[redacted] https://x')
})

test('a double-quoted variable after a password flag stays, as the bare one does; a quoted literal is redacted', () => {
  for (const text of ['gh auth login --token "$GH_TOKEN"', 'mysql -p"$MYSQL_PWD" shop', '--password "$DB_PASS" x', '--token "${GH_TOKEN}" x', 'curl -u admin:"$PASS" https://x']) {
    assert.equal(redact(text), text)
  }
  assert.equal(redact('--password "hunter2"'), '--password [redacted]')
  assert.equal(redact('--password "$ecret pass"'), '--password [redacted]', 'only a whole variable is kept')
  assert.equal(redact('--token "${X:-hunter2}"'), '--token [redacted]')
  assert.equal(redact('--token "$(echo hunter2)" x'), '--token [redacted] x')
  assert.equal(redact("--token '$GH_TOKEN'"), '--token [redacted]', 'only double quotes')
})

test('the new patterns stay fast on long runs that almost match', () => {
  const runs = [
    'mysql '.repeat(80 * 1024), 'curl '.repeat(100 * 1024), 'a-'.repeat(256 * 1024), `http://${'x'.repeat(512 * 1024)}`, 'a://b:c '.repeat(64 * 1024),
    '"password":"'.repeat(40 * 1024), `"password": "${'x'.repeat(512 * 1024)}`, 'Authorization: Basic '.repeat(24 * 1024), '--token  '.repeat(56 * 1024),
    `"password": "$${'x'.repeat(512 * 1024)}`, `mysql${' -p$a'.repeat(80 * 1024)}`, 'a://b:%c%x '.repeat(64 * 1024),
    '--token $('.repeat(24 * 1024), `--token $(${'x'.repeat(256 * 1024)}`, `--token $(${' $(y)'.repeat(40 * 1024)}`,
    `mysql${' -p$('.repeat(40 * 1024)}`, `mysql $(${' $(y)'.repeat(40 * 1024)}`, `curl${' -u a:$('.repeat(32 * 1024)}`,
  ]
  const started = performance.now()
  for (const run of runs) redact(run)
  assert.ok(performance.now() - started < 1000, `took ${performance.now() - started} ms`)
})

// The false-positive gate: command lines and text that hold no secret come back exactly as they are.
const PLAIN = [
  'mkdir -p dir', 'mkdir -pv a/b', 'cp -pr src dst', 'ls -la', 'npm test', 'node --test x.mjs', 'grep -rn foo .', 'find . -print -prune',
  'docker run -p 8080:80 img', 'docker run -u 1000:1000 img', 'ssh -p 22 host', 'psql -U user -d db', 'pip install -r requirements.txt',
  'git -c user.name=X commit', 'git push -u origin main', 'docker login --password-stdin', 'mysql -u root -p shop', 'mysql --port=3306 -h db',
  'curl -sS https://example.com', 'curl -u admin https://example.com', 'https://example.com/path?q=1#frag', 'http://localhost:3000/@scope/pkg',
  'ssh://git@github.com/org/repo.git', 'git@github.com:org/repo.git',
  'Enter your password when asked, and keep the API token safe.', 'a basic internationalization layer', 'Send an Authorization: Basic header with credentials.',
  'the --token flag is required', 'use --token instead.', '--password --verbose', 'pass --token <value> or --token $GITHUB_TOKEN',
  'mysql -u root -p<password> shop', 'mysql -p$MYSQL_PWD shop', 'curl -u user:<password> https://x', 'curl -u "$USER:$PASS" https://x',
  'postgres://user:<password>@host/db', 'postgres://user:${PGPASSWORD}@host/db', 'https://user:%PASS%@host/',
  'Set up `mysql`, then run `mkdir -pv data`.', 'Fetch it with `curl`, then `docker run -u 1000:1000 img`.',
  "With mysql it's easy: run `mkdir -pv data` if it doesn't exist.", "curl's fine, it doesn't matter: docker run -u 1000:1000 img", 'Start mysql. Then run mkdir -pv data.',
  'Authorization: Basic credentials go in base64', '--token [value]', '--password (optional)',
  '{"tokens": 1350, "key": "ctrl+s", "keywords": ["a"], "max_tokens": 4096, "tokenizer": "bpe"}', '{"apiKey": "<YOUR_API_KEY>", "token": "${TOKEN}"}',
  'Run `gh auth login --token <token>`.', '--token <value>.', '--password <pw>)', 'echo "--token $GH_TOKEN"', 'gh auth login --token $GH_TOKEN; next',
  'see `--token $TOKEN`', 'mysql -u root -p<password>.', 'mysql -p${{ secrets.DB }} x', 'curl -u a:$env:PASS https://x',
  'gh auth login --token $env:GH_TOKEN', 'gh auth login --token ${{ secrets.GH_TOKEN }}', '{"password":"${secrets.wrong}"}', 'postgres://u:${db.pass}@h/d',
  'mysqldump shop > out/$(date +%F | tr - _; mkdir -pv out).sql', 'mysql shop $(cat a | grep -px y)', 'curl https://x/$(echo a | docker run -u 1:2 img)',
]

test('command lines and prose with no secret come back the same', () => {
  for (const text of PLAIN) assert.equal(redact(text), text)
  assert.equal(redact('max_tokens=4096'), 'max_tokens=[redacted]', 'today a NAME=value whose name says token is redacted, so it is not in the list above')
})

// JSX key= attributes in two old plans already match NAME=value; that pattern is not weakened, so those two files keep exactly that change.
const KEY_ATTRIBUTE = /(?<![\w.-])key=("[^"]*"|'[^']*'|\S+)/g
const KEY_ATTRIBUTE_FILES = new Set(['docs/plans/2026-10-12-claude-team-plan.md', 'docs/plans/2026-10-24-section-team-v3-plan.md'])

// Every tracked task prompt and doc, read at test time, so a prompt added later is checked too. A failure names the file only,
// never its text: some task files are written blind.
test('every tracked bench task, README.md, CONTRIBUTING.md and doc comes back the same', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'bench/tasks/*.md', 'README.md', 'CONTRIBUTING.md', 'docs/*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
  assert.ok(files.includes('README.md') && files.some(f => f.startsWith('bench/tasks/')) && files.some(f => f.startsWith('docs/')), 'the corpus is not empty')
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const expected = KEY_ATTRIBUTE_FILES.has(file) ? text.replace(KEY_ATTRIBUTE, 'key=[redacted]') : text
    assert.ok(redact(text) === expected, `${file} is changed by redact`)
  }
})
