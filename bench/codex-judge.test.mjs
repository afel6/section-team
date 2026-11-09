import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CODEX_PROMPT, caseLabels, codexArgs, runCases, sheetValues } from './codex-judge.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const SHEET = join(BENCH, 'outside-run-sheet.md')
const VALUES = { codexBin: 'C:/codex/codex.exe', model: 'gpt-6.1-sol', effort: 'ultra', sandbox: 'read-only' }
const scores = overall => ({ correctness: 8, codeQuality: 7, tests: 6, robustnessSecurity: 7, docsUsability: 5, overall, notes: 'A/x.mjs:1 ok' })
const GOOD = { A: scores(8), B: scores(6), ranking: ['A', 'B'] }
const fenced = json => 'Both solutions read.\n\n```json\n' + JSON.stringify(json, null, 2) + '\n```\n'
const sheetWith = fields => '# sheet\n\n```json\n' + JSON.stringify({ ...VALUES, ...fields }) + '\n```\n'

// A case set of two-solution cases; `judged` cases already hold a usable verdict.json.
function caseSet(t, names, judged = []) {
  const root = mkdtempSync(join(tmpdir(), 'bench-codex-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const setDir = join(root, 'codex-judge-mo')
  for (const name of names) {
    for (const folder of ['A', 'B', 'scratch']) mkdirSync(join(setDir, name, folder), { recursive: true })
    writeFileSync(join(setDir, name, 'JUDGE.md'), 'judge A and B')
    if (judged.includes(name)) writeFileSync(join(setDir, name, 'verdict.json'), JSON.stringify(GOOD))
  }
  return { setDir, logDir: join(root, 'logs', 'codex-judge-mo') }
}

// A stand-in for spawnSync: each call runs the next answer with the case folder and the last-message path it was given,
// writes one --json event to the stdout file, and returns the answer's result ({ status } or { error }).
function fakeCodex(answers) {
  const calls = []
  const run = (bin, args, options) => {
    calls.push({ bin, args, options })
    writeSync(options.stdio[1], '{"type":"thread.started"}\n')
    const answer = answers[Math.min(calls.length, answers.length) - 1]
    const events = list => list.forEach(event => writeSync(options.stdio[1], `${JSON.stringify(event)}\n`))
    return answer({ caseDir: args[args.indexOf('-C') + 1], last: args[args.indexOf('-o') + 1], attempt: calls.length, events })
  }
  return { run, calls }
}

const lines = () => {
  const logged = []
  return { log: line => logged.push(line), logged }
}

test('codexArgs carries model, effort, no memories, the Windows sandbox, the case folder and the sandbox mode', () => {
  const args = codexArgs({ caseDir: 'C:/sets/case-01', model: 'gpt-6.1-sol', effort: 'ultra', sandbox: 'read-only', lastMessage: 'C:/logs/case-01-a1.last.txt' })
  assert.deepEqual(args, [
    'exec', '--ephemeral', '--ignore-user-config', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="ultra"', '--disable', 'memories',
    '-c', 'windows.sandbox="unelevated"', '--skip-git-repo-check', '-C', 'C:/sets/case-01', '-s', 'read-only', '--json', '-o', 'C:/logs/case-01-a1.last.txt', CODEX_PROMPT,
  ])
  // Frozen with the round: the run-sheet test checks that Antigravity's text block in the sheet is exactly this string.
  assert.equal(CODEX_PROMPT, 'You are a blind code reviewer. The current folder is one case. Read JUDGE.md here and follow it exactly, '
    + 'without asking questions. Work only inside this folder, and put probes only in scratch/. Never edit, create or delete '
    + 'anything in the solution folders or in SEED. Do not use the network. End your answer with your verdict as one fenced json block.')
})

test('caseLabels lists the single-letter solution folders, sorted, without SEED or scratch', t => {
  const { setDir } = caseSet(t, ['case-01'])
  for (const folder of ['D', 'C', 'SEED']) mkdirSync(join(setDir, 'case-01', folder))
  assert.deepEqual(caseLabels(join(setDir, 'case-01')), ['A', 'B', 'C', 'D'])
})

test('sheetValues reads the json block', () => {
  assert.deepEqual(sheetValues(sheetWith({}) + '\n```json\n{ "model": "later block" }\n```\n'), VALUES)
  for (const sandbox of ['workspace-write', 'danger-full-access']) assert.equal(sheetValues(sheetWith({ sandbox })).sandbox, sandbox)
  const sheet = readFileSync(SHEET, 'utf8')
  // The frozen sheet holds the sandbox probe's result (read-only); codexBin moved to 0.167.0-alpha.3.2 on 2026-11-09.
  const frozen = sheetValues(sheet)
  assert.deepEqual(frozen, { ...VALUES, codexBin: 'C:/Users/Asus/AppData/Local/OpenAI/Codex/bin/f71a721e0e6193a9/codex.exe' })
  assert.equal(sheet.split(/\r?\n/)[0], 'Freeze: tag mo-freeze-cloud')
  // The sheet's command line is codexArgs with placeholders for the paths and the prompt.
  const args = codexArgs({ caseDir: '<case folder>', ...frozen, lastMessage: '<log>.last.txt' })
  const line = ['codex.exe', ...args.slice(0, -1), '"<CODEX_PROMPT>"'].join(' ')
  assert.ok(sheet.includes('`' + line + '`'), `the run sheet should hold the command line ${line}`)
})

// The frozen procedure, whole line by whole line, under its section: a change to any of these lines, or a sentence
// added to one, fails the test.
const PROCEDURE = {
  '## Both judges': [
    '- The judge never opens anything outside its own case folder.',
    '- When a verdict is not usable, re-ask: start a new session on the same case. A case gets at most two re-asks.',
    '- A fresh or rebuilt set always gets a new folder name. Attempt records are kept per set name, in `bench/results/codex-logs/<case set>/` and `bench/results/ag-logs/<case set>/`, so a log folder is never emptied or given to another set.',
    '- The held-out set is judged, imported and checked (`node bench/external-judge.mjs check --as=<held-out name>`) before any mode-round set is imported; the importer refuses otherwise.',
  ],
  '## Codex': [
    '- If the same case stops the runner twice for the same reason, stop and report it to the coordinator. Do not hand-write attempt files.',
  ],
  '## Antigravity': [
    '- To re-ask a case, first record the attempt in `bench/results/ag-logs/<case set>/<case>-a<n>.txt`, where n is that attempt\'s number. Move the text of its `verdict.json` into that file and delete `verdict.json` from the case folder, or write the words "no verdict" in it when there is no `verdict.json`. Empty the case\'s `scratch/` folder. Then open a new conversation on that case.',
    '- If any case was judged in a conversation that had seen another case, stop and tell the coordinator: Antigravity is reported as not used.',
    '- After the last case, run `node bench/external-judge.mjs import --round=<r> --out=<ag set> --as=<name>`, for example `--round=mo --out=C:/Users/Asus/ag-judge-mo --as=moag`.',
    '- The import lists every case that is not usable. Re-ask each one as above, then run the import again.',
    '- A case still not usable after its second re-ask is left as it is. Antigravity is then reported as "not usable (k of 18)".',
    '- k is the usable count the last import wrote to `bench/results/outside-usable-<name>.json`; that file stays.',
  ],
}

// A section's text: from its heading to the next "## " heading.
const section = (sheet, heading) => {
  const start = sheet.indexOf(`\n${heading}\n`)
  assert.ok(start >= 0, `the run sheet has a ${heading} section`)
  const end = sheet.indexOf('\n## ', start + 1)
  return sheet.slice(start, end < 0 ? undefined : end)
}

test('the run sheet pins the procedure line by line, and Antigravity\'s prompt block is CODEX_PROMPT exactly', () => {
  const sheet = readFileSync(SHEET, 'utf8')
  for (const [heading, lines] of Object.entries(PROCEDURE)) {
    const own = section(sheet, heading).split(/\r?\n/)
    for (const line of lines) assert.ok(own.includes(line), `${heading} holds: ${line}`)
  }
  const block = /```text\r?\n([\s\S]*?)\r?\n *```/.exec(section(sheet, '## Antigravity'))
  assert.ok(block, 'the Antigravity section has a fenced text block')
  assert.equal(block[1].trim(), CODEX_PROMPT)
})

test('sheetValues refuses a placeholder sandbox and anything else off, with one line', () => {
  const refusals = [
    ['# no block here', /no fenced json block/],
    ['```json\n{ "model": \n```', /json block does not parse/],
    ['```json\n[1]\n```', /json block is not an object/],
    [sheetWith({ sandbox: '<set in Task 27>' }), /sandbox is "<set in Task 27>"/],
    [sheetWith({ sandbox: undefined }), /sandbox is undefined/],
    [sheetWith({ sandbox: 'workspace_write' }), /sandbox is "workspace_write"/],
    [sheetWith({ sandbox: 'full-access' }), /sandbox is "full-access"/],
    [sheetWith({ codexBin: '' }), /codexBin/],
    [sheetWith({ model: 7 }), /model must be a plain name/],
    [sheetWith({ effort: 'ultra" -c x="y' }), /effort must be a plain name/],
  ]
  for (const [text, message] of refusals) {
    assert.throws(() => sheetValues(text), err => message.test(err.message) && !err.message.includes('\n'), text)
  }
})

test('runCases skips judged cases and writes verdict.json from the last message', t => {
  const { setDir, logDir } = caseSet(t, ['case-01', 'case-02'], ['case-01'])
  const { run, calls } = fakeCodex([({ last }) => {
    writeFileSync(last, fenced({ draft: 'first thoughts' }) + fenced(GOOD))
    return { status: 0 }
  }])
  const { log, logged } = lines()
  const results = runCases({ setDir, logDir, values: VALUES, run, log })

  const caseDir = join(setDir, 'case-02')
  const lastMessage = join(logDir, 'case-02-a1.last.txt')
  const args = codexArgs({ caseDir, ...VALUES, lastMessage })
  assert.equal(calls.length, 1, 'only the case without a verdict is asked')
  assert.equal(calls[0].bin, VALUES.codexBin)
  assert.deepEqual(calls[0].args, args)
  assert.equal(calls[0].options.cwd, caseDir)
  assert.deepEqual(JSON.parse(readFileSync(join(caseDir, 'verdict.json'), 'utf8')), GOOD, 'the final json block, not an earlier one')
  assert.deepEqual(JSON.parse(readFileSync(join(logDir, 'case-02-a1.cmd.txt'), 'utf8')), [VALUES.codexBin, ...args])
  assert.equal(readFileSync(join(logDir, 'case-02-a1.jsonl'), 'utf8'), '{"type":"thread.started"}\n')
  assert.ok(existsSync(join(logDir, 'case-02-a1.err')))
  assert.deepEqual(results.map(({ seconds, ...rest }) => ({ ...rest, verdict: rest.verdict?.ranking })), [
    { case: 'case-01', exitCode: null, attempts: 1, verdict: ['A', 'B'] },
    { case: 'case-02', exitCode: 0, attempts: 1, verdict: ['A', 'B'] },
  ])
  assert.ok(results.every(r => Number.isFinite(r.seconds)))
  assert.equal(results[1].verdict.pair, 'case-02')
  assert.deepEqual(logged.map(line => line.split(':')[0]), ['case-01', 'case-02'])
})

test('a verdict.json Codex wrote itself is checked as it is, not replaced by its last message', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const own = { ...GOOD, ranking: ['B', 'A'] }
  const { run } = fakeCodex([({ caseDir, last }) => {
    writeFileSync(join(caseDir, 'verdict.json'), '\uFEFF' + JSON.stringify(own))
    writeFileSync(last, fenced(GOOD))
    return { status: 0 }
  }])
  const [result] = runCases({ setDir, logDir, values: VALUES, run, log: () => {} })
  assert.deepEqual(result.verdict.ranking, ['B', 'A'])
})

test('an unusable verdict is moved aside and re-asked twice, then the case is reported unusable', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const caseDir = join(setDir, 'case-01')
  const bad = attempt => ({ ...GOOD, ranking: ['A'], attempt })
  const scratchSeen = []
  const { run, calls } = fakeCodex([({ caseDir: dir, attempt }) => {
    scratchSeen.push(readdirSync(join(dir, 'scratch')))
    writeFileSync(join(dir, 'scratch', `probe-${attempt}.mjs`), 'probe')
    writeFileSync(join(dir, 'verdict.json'), JSON.stringify(bad(attempt)))
    return { status: 0 }
  }])
  const { log, logged } = lines()
  const [result] = runCases({ setDir, logDir, values: VALUES, run, log })

  assert.equal(calls.length, 3, 'a first ask and two re-asks')
  assert.deepEqual(scratchSeen, [[], [], []], 'every re-ask starts with an empty scratch/')
  assert.deepEqual(calls.map(c => c.args[c.args.indexOf('-o') + 1]), [1, 2, 3].map(n => join(logDir, `case-01-a${n}.last.txt`)))
  for (const n of [1, 2, 3]) {
    assert.deepEqual(JSON.parse(readFileSync(join(logDir, `case-01-a${n}.verdict.json`), 'utf8')), bad(n))
    assert.match(readFileSync(join(logDir, `case-01-a${n}.unusable.txt`), 'utf8'), /ranking must list A, B/)
  }
  assert.equal(existsSync(join(caseDir, 'verdict.json')), false)
  assert.deepEqual({ ...result, seconds: 0 }, { case: 'case-01', exitCode: 0, seconds: 0, attempts: 3, verdict: null })
  assert.match(logged[0], /^case-01: not usable after 3 attempts: ranking must list A, B/)

  const again = runCases({ setDir, logDir, values: VALUES, run, log })
  assert.equal(calls.length, 3, 'a resumed run never asks a case a fourth time')
  assert.deepEqual(again.map(r => [r.attempts, r.verdict]), [[3, null]])
})

test('a re-asked case that answers well is usable on its second attempt', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const { run, calls } = fakeCodex([
    ({ last }) => {
      writeFileSync(last, 'I could not decide.')
      return { status: 0 }
    },
    ({ last }) => {
      writeFileSync(last, fenced(GOOD))
      return { status: 0 }
    },
  ])
  const [result] = runCases({ setDir, logDir, values: VALUES, run, log: () => {} })
  assert.equal(calls.length, 2)
  assert.equal(result.attempts, 2)
  assert.deepEqual(result.verdict.ranking, ['A', 'B'])
  assert.match(readFileSync(join(logDir, 'case-01-a1.unusable.txt'), 'utf8'), /no verdict/)
  assert.equal(existsSync(join(logDir, 'case-01-a1.verdict.json')), false, 'nothing to move when there was no verdict')
})

// Codex --json events as `codex exec` logs them: an item per command run, and the agent's messages.
const command = (cmd, output = '') => ({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: cmd, aggregated_output: output, exit_code: 0, status: 'completed' } })
const message = text => ({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text } })

// Codex's sandbox limits writes, not reads: an attempt whose commands name a blind key or bench/results is unusable.
test('an attempt whose logged commands name a blind key is unusable and re-asked, even with a good verdict', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const { run, calls } = fakeCodex([
    ({ last, events }) => {
      events([command('cat C:/Users/Asus/claude-team-moderound/bench/results/external-key-mo.json'), message('done')])
      writeFileSync(last, fenced(GOOD))
      return { status: 0 }
    },
    ({ last, events }) => {
      events([command('node --test'), message('I did not open blind-key-mo.json')])
      writeFileSync(last, fenced(GOOD))
      return { status: 0 }
    },
  ])
  const [result] = runCases({ setDir, logDir, values: VALUES, run, log: () => {} })
  assert.equal(calls.length, 2, 'the peeking attempt is re-asked')
  assert.deepEqual([result.attempts, result.verdict.ranking], [2, ['A', 'B']])
  assert.equal(readFileSync(join(logDir, 'case-01-a1.unusable.txt'), 'utf8'), 'judge touched a blind key\n')
  assert.deepEqual(JSON.parse(readFileSync(join(logDir, 'case-01-a1.verdict.json'), 'utf8')), GOOD, 'its verdict is moved aside')
  assert.ok(!existsSync(join(logDir, 'case-01-a2.unusable.txt')), 'only commands count, not the agent text')
})

// Like a parse failure: an error exit stops the run without using the attempt, and its verdict is still moved aside.
test('a peeking attempt that exits with an error stops the run without using an attempt', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const peeking = fakeCodex([({ last, events }) => {
    events([command('type C:\\Users\\Asus\\claude-team-moderound\\bench\\results\\blind-key-mo.json')])
    writeFileSync(last, fenced(GOOD))
    return { status: 1 }
  }])
  assert.throws(() => runCases({ setDir, logDir, values: VALUES, run: peeking.run, log: () => {} }), /case-01 attempt 1: codex exited with 1 and no usable verdict, so no attempt was used/)
  assert.deepEqual(JSON.parse(readFileSync(join(logDir, 'case-01-a1.verdict.json'), 'utf8')), GOOD)
  assert.ok(!existsSync(join(logDir, 'case-01-a1.unusable.txt')), 'no attempt used')
  const clean = fakeCodex([({ last }) => {
    writeFileSync(last, fenced(GOOD))
    return { status: 0 }
  }])
  const [result] = runCases({ setDir, logDir, values: VALUES, run: clean.run, log: () => {} })
  assert.equal(clean.calls[0].args[clean.calls[0].args.indexOf('-o') + 1], join(logDir, 'case-01-a2.last.txt'), 'the resume asks a2')
  assert.equal(result.attempts, 1)
})

test('an attempt whose commands stay in the case folder is checked as before', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const { run, calls } = fakeCodex([({ last, events }) => {
    events([command('cat JUDGE.md', 'Never read bench/results/blind-key-mo.json.'), command('node --test A'), message('bench/results is not mine to read')])
    writeFileSync(last, fenced(GOOD))
    return { status: 0 }
  }])
  const [result] = runCases({ setDir, logDir, values: VALUES, run, log: () => {} })
  assert.deepEqual([calls.length, result.attempts, result.verdict.ranking], [1, 1, ['A', 'B']])
})

test('a Codex that fails stops the run without using an attempt, and the next run resumes', t => {
  const { setDir, logDir } = caseSet(t, ['case-01', 'case-02'])
  const failing = fakeCodex([({ caseDir }) => {
    writeFileSync(join(caseDir, 'verdict.json'), '{ "half":')
    return { status: 1 }
  }])
  const { log, logged } = lines()
  assert.throws(() => runCases({ setDir, logDir, values: VALUES, run: failing.run, log }), err => {
    assert.match(err.message, /^case-01 attempt 1: codex exited with 1 and no usable verdict, so no attempt was used/)
    assert.ok(err.message.includes(join(logDir, 'case-01-a1.err')))
    return !err.message.includes('\n')
  })
  assert.equal(failing.calls.length, 1, 'the run stops at the first failure')
  assert.deepEqual(logged, [])
  assert.equal(existsSync(join(setDir, 'case-01', 'verdict.json')), false, 'the half verdict is moved aside')
  assert.equal(readFileSync(join(logDir, 'case-01-a1.verdict.json'), 'utf8'), '{ "half":')
  assert.equal(existsSync(join(logDir, 'case-01-a1.unusable.txt')), false)

  const working = fakeCodex([({ last }) => {
    writeFileSync(last, fenced(GOOD))
    return { status: 0 }
  }])
  const results = runCases({ setDir, logDir, values: VALUES, run: working.run, log: () => {} })
  assert.equal(working.calls[0].args[working.calls[0].args.indexOf('-o') + 1], join(logDir, 'case-01-a2.last.txt'), 'logs are never overwritten')
  assert.deepEqual(results.map(r => [r.case, r.attempts, r.verdict !== null]), [['case-01', 1, true], ['case-02', 1, true]])
})

test('a Codex that cannot start stops the run with one line', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  const { run } = fakeCodex([() => ({ error: Object.assign(new Error('spawn C:/codex/codex.exe ENOENT'), { code: 'ENOENT' }) })])
  assert.throws(() => runCases({ setDir, logDir, values: VALUES, run, log: () => {} }), /^Error: could not start codex \(C:\/codex\/codex\.exe: ENOENT\)/)
  assert.deepEqual(readdirSync(logDir).filter(name => name.endsWith('.unusable.txt')), [])
})

test('runCases refuses a folder without case-NN folders', t => {
  const { setDir, logDir } = caseSet(t, ['A'])
  assert.throws(() => runCases({ setDir, logDir, values: VALUES, run: fakeCodex([]).run, log: () => {} }), /no case-NN folders in/)
})

test('a judged case whose verdict.json is not usable is skipped and reported, never asked', t => {
  const { setDir, logDir } = caseSet(t, ['case-01'])
  writeFileSync(join(setDir, 'case-01', 'verdict.json'), JSON.stringify({ ...GOOD, B: undefined }))
  const { run, calls } = fakeCodex([])
  const { log, logged } = lines()
  const [result] = runCases({ setDir, logDir, values: VALUES, run, log })
  assert.equal(calls.length, 0)
  assert.equal(result.verdict, null)
  assert.match(logged[0], /^case-01: not usable: B: missing scores/)
})

// Starts node, never codex: the missing set stops the CLI before any case is asked.
test('the CLI prints one line and exits 1 on a bad command line or a missing set', t => {
  const cli = args => spawnSync(process.execPath, [join(BENCH, 'codex-judge.mjs'), ...args], { encoding: 'utf8' })
  const bare = cli([])
  assert.deepEqual([bare.status, bare.stdout], [1, ''])
  assert.match(bare.stderr, /^codex-judge: usage: node bench\/codex-judge\.mjs --set=<case set folder>\n$/)

  const root = mkdtempSync(join(tmpdir(), 'bench-codex-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const missing = join(root, 'codex-judge-none')
  const res = cli([`--set=${missing}`])
  assert.deepEqual([res.status, res.stdout], [1, ''])
  assert.match(res.stderr, /^codex-judge: missing [^\n]+codex-judge-none\n$/)
})
