import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { childEnv, cleanSettings, commonArgs } from './clean-run.mjs'
import {
  ALLOWED, BLIND_KEY, JUDGE_TIMEOUT_MS, checkLeakScan, countedEdges, edgeCounts, fillPrompt, judgeArgs, judgeCall, judgeCheck, judgeFiles, judgeOptions,
  judgeSpawnOptions, mirrorSwap, parseVerdict, pendingJobs, prepareJob, runJobs, taskTextOf, unswap, withCopy,
} from './judge.mjs'
import { projectDirFor } from './run-attempts.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const LABELS = ['X', 'Y']
const LABELS4 = ['W', 'X', 'Y', 'Z']
const scores = (overall, extra = {}) => ({ correctness: 8, codeQuality: 7, tests: 6, robustnessSecurity: 7, docsUsability: 5, overall, notes: 'src/a.mjs:3 ok', ...extra })
const fenced = v => `I ran both test suites.\n\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\`\n`
const good = { X: scores(6), Y: scores(8), ranking: ['Y', 'X'] }
const good4 = { W: scores(7), X: scores(5), Y: scores(8), Z: scores(6), ranking: ['Y', 'W', 'Z', 'X'] }
const envelope = text => JSON.stringify({ type: 'result', result: text, total_cost_usd: 1.25 })
// A pin and the init of a judge that matches it (judges are held to solo's lists).
const PIN = { version: '2.1.296', apiKeySource: 'none', builtins: ['b@builtin'], pluginDir: 'C:/plug', setups: { solo: { plugins: ['b@builtin'], agents: ['a'], skills: ['s'] } } }
const INIT = { type: 'system', subtype: 'init', plugins: [{ source: 'b@builtin', path: 'builtin' }], mcp_servers: [], agents: ['a'], skills: ['s'], model: 'claude-opus-5-5', claude_code_version: '2.1.296', apiKeySource: 'none', permissionMode: 'default' }
// `claude -p --output-format json --verbose` stdout: every message as one array, the init first and the result last.
const verbose = (text, init = INIT) => JSON.stringify([init, { type: 'assistant', message: { content: [] } }, JSON.parse(envelope(text))])
const transcriptOf = (effort = 'medium', before = []) => [...before, { type: 'assistant', effort, message: { model: 'claude-opus-5-5' } }].map(line => `${JSON.stringify(line)}\n`).join('')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const quiet = () => {}

function tempFiles(t) {
  const dir = mkdtempSync(join(tmpdir(), 'judge-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return judgeFiles(dir, 't')
}

// call(job, attempt) answering from a script keyed '<pair>#<judge>', one answer per attempt; it records each call.
function scripted(answers, calls = []) {
  return async (job, attempt) => {
    calls.push(`${job.pair}#${job.judge}a${attempt}`)
    return answers[`${job.pair}#${job.judge}`][attempt - 1]
  }
}

function pairFolder(t, labels) {
  const source = mkdtempSync(join(tmpdir(), 'judge-pair-'))
  t.after(() => rmSync(source, { recursive: true, force: true }))
  for (const label of labels) {
    mkdirSync(join(source, label))
    writeFileSync(join(source, label, 'who.txt'), label)
  }
  return source
}

test('parseVerdict on valid text returns the row', () => {
  assert.deepEqual(parseVerdict(fenced(good), 'h1-r1', LABELS), { pair: 'h1-r1', ...good })
})

test('parseVerdict uses the last json block when there are two', () => {
  const draft = { X: scores(2), Y: scores(3), ranking: ['X', 'Y'] }
  assert.deepEqual(parseVerdict(fenced(draft) + 'On second thought:\n' + fenced(good), 'h1-r1', LABELS), { pair: 'h1-r1', ...good })
})

test('parseVerdict keeps notes that quote a ``` fence', () => {
  const quoting = { ...good, X: scores(6, { notes: 'README.md:4 shows ```json\n``` usage' }) }
  assert.deepEqual(parseVerdict(fenced(quoting), 'h1-r1', LABELS), { pair: 'h1-r1', ...quoting })
})

test('parseVerdict throws on a missing tests field', () => {
  const { tests, ...noTests } = scores(6)
  assert.throws(() => parseVerdict(fenced({ ...good, X: noTests }), 'h1-r1', LABELS), /tests/)
})

test('parseVerdict throws on a score of 11', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, Y: scores(11) }), 'h1-r1', LABELS), /Y\.overall/)
})

test('parseVerdict throws on a score that is not an integer', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, X: scores(7.5) }), 'h1-r1', LABELS), /X\.overall/)
  assert.throws(() => parseVerdict(fenced({ ...good, X: scores('7') }), 'h1-r1', LABELS), /X\.overall/)
})

test('parseVerdict throws on notes that are not a string', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, X: scores(6, { notes: undefined }) }), 'h1-r1', LABELS), /notes/)
})

test('parseVerdict throws on a ranking that repeats a label', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, ranking: ['X', 'X'] }), 'h1-r1', LABELS), /ranking/)
})

test('parseVerdict throws on text with no JSON', () => {
  assert.throws(() => parseVerdict('Both solutions look fine.', 'h1-r1', LABELS), /json/)
})

// The reason goes into -reasks.json, -left-out.json and the log lines: one line, even when Node quotes the bad text.
test('parseVerdict says on one line why the json block does not parse', () => {
  const broken = '```json\n{\n  "X": {\n    "correctness": oops\n  }\n}\n```'
  assert.throws(() => parseVerdict(broken, 'h1-r1', LABELS), err => {
    assert.match(err.message, /^judge json does not parse: \S/)
    assert.doesNotMatch(err.message, /\s{2}|[\r\n\t]/)
    return true
  })
})

test('pendingJobs lists every (pair, judge) not yet in the rows, pair by pair', () => {
  assert.deepEqual(pendingJobs(['h1-r1', 'h1-r2'], [{ pair: 'h1-r1', judge: 1 }], 2), [
    { pair: 'h1-r1', judge: 2 },
    { pair: 'h1-r2', judge: 1 },
    { pair: 'h1-r2', judge: 2 },
  ])
})

test('fillPrompt fills every placeholder of the committed prompt, and the SEED note only for a seeded pair', () => {
  const template = readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8')
  for (const name of ['{{LABELS}}', '{{TASK}}', '{{SEED_NOTE}}']) assert.ok(template.includes(name), name)
  const task = 'Build a cron library. Use $& and $1 literally.'
  const seeded = fillPrompt(template, { labels: LABELS, task, seed: true })
  const plain = fillPrompt(template, { labels: LABELS, task, seed: false })
  for (const text of [seeded, plain]) {
    assert.ok(!text.includes('{{'), 'no placeholder left')
    assert.ok(text.includes(task), 'task text copied as is')
    assert.ok(text.includes('X, Y'))
  }
  const note = 'SEED/ is the repo before the change; judge only what each solution changed and whether it broke anything'
  assert.ok(seeded.includes(note))
  assert.ok(!plain.includes('SEED/'))
})

test('runJobs re-asks a verdict that does not parse, saves each unusable output raw, and goes on with the other jobs', async t => {
  const files = tempFiles(t)
  const partial = verbose(fenced({ X: scores(6), ranking: ['X', 'Y'] }))
  const ok = { stdout: verbose(fenced(good)), transcript: transcriptOf() }
  const answers = { 'h1-r1#1': [ok], 'h1-r1#2': [{ stdout: partial, transcript: transcriptOf() }, { stdout: 'claude crashed', transcript: transcriptOf() }, ok] }
  const jobs = [1, 2].map(judge => ({ pair: 'h1-r1', judge, labels: LABELS }))
  const calls = []
  const lines = []
  const left = await runJobs(jobs, { rows: Object.freeze([]), call: scripted(answers, calls), check: () => [], files, log: line => lines.push(line) })

  assert.equal(left, 0)
  assert.deepEqual(calls, ['h1-r1#1a1', 'h1-r1#2a1', 'h1-r1#2a2', 'h1-r1#2a3'])
  assert.deepEqual(readJson(files.rows), [{ pair: 'h1-r1', ...good, judge: 1, costUSD: 1.25 }, { pair: 'h1-r1', ...good, judge: 2, costUSD: 1.25 }])
  const reasks = readJson(files.reasks)
  assert.deepEqual(reasks.map(({ pair, judge, attempt }) => [pair, judge, attempt]), [['h1-r1', 2, 1], ['h1-r1', 2, 2]])
  assert.deepEqual(reasks[0].reasons, ['Y: missing scores'])
  assert.deepEqual(reasks[1].reasons, ['claude output has no result text'])
  assert.equal(readFileSync(join(files.raw, 'h1-r1-2-a1.json'), 'utf8'), partial)
  assert.equal(readFileSync(join(files.raw, 'h1-r1-2-a2.json'), 'utf8'), 'claude crashed')
  assert.ok(!existsSync(join(files.raw, 'h1-r1-2-a3.json')), 'a usable attempt is not saved raw')
  assert.ok(!existsSync(files.leftOut))
  assert.equal(lines.filter(line => line.includes('re-ask')).length, 2)
})

test('a void judge session (stray plugin or high effort) is re-asked, listed, then left out after three attempts', async t => {
  const files = tempFiles(t)
  const stray = { ...INIT, plugins: [...INIT.plugins, { source: 'stray@market', path: 'C:/stray' }] }
  const answer = verbose(fenced(good4))
  const answers = {
    'h4-r1#1': [
      { stdout: verbose(fenced(good4), stray), transcript: transcriptOf() },
      { stdout: answer, transcript: transcriptOf('high') },
      { stdout: verbose(fenced(good4), stray), transcript: transcriptOf() },
    ],
    'h4-r1#2': [{ stdout: answer, transcript: transcriptOf() }],
  }
  const jobs = [1, 2].map(judge => ({ pair: 'h4-r1', judge, labels: LABELS4 }))
  const calls = []
  const left = await runJobs(jobs, { rows: [], call: scripted(answers, calls), check: judgeCheck(PIN), files, log: quiet })

  assert.equal(left, 1)
  assert.deepEqual(calls, ['h4-r1#1a1', 'h4-r1#1a2', 'h4-r1#1a3', 'h4-r1#2a1'])
  const strayReason = 'plugins differ from the pin (extra: stray@market; missing: none)'
  assert.deepEqual(readJson(files.reasks), [
    { pair: 'h4-r1', judge: 1, attempt: 1, reasons: [strayReason] },
    { pair: 'h4-r1', judge: 1, attempt: 2, reasons: ['assistant effort high, expected medium'] },
  ])
  assert.deepEqual(readJson(files.leftOut), [{ pair: 'h4-r1', judge: 1, attempt: 3, reasons: [strayReason] }])
  assert.deepEqual(readJson(files.rows), [{ pair: 'h4-r1', ...good4, judge: 2, costUSD: 1.25 }])
  for (const attempt of [1, 2, 3]) assert.ok(existsSync(join(files.raw, `h4-r1-1-a${attempt}.json`)), `raw output of attempt ${attempt}`)
})

test('a left-out job is not asked again on resume', async t => {
  const files = tempFiles(t)
  const unusable = { stdout: 'claude crashed', transcript: transcriptOf() }
  await runJobs([{ pair: 'h4-r1', judge: 1, labels: LABELS4 }], { rows: [], call: async () => unusable, check: () => [], files, log: quiet })
  const leftOut = readJson(files.leftOut)
  assert.deepEqual(pendingJobs(['h4-r1', 'h4-r2'], [{ pair: 'h4-r2', judge: 1 }], 2, leftOut), [{ pair: 'h4-r1', judge: 2 }, { pair: 'h4-r2', judge: 2 }])
  assert.deepEqual(pendingJobs(['h4-r1'], [], 2), [{ pair: 'h4-r1', judge: 1 }, { pair: 'h4-r1', judge: 2 }], 'leftOut defaults to none')
})

test('a resumed job goes on from the attempts its saved re-asks used, so the cap holds across runs', async t => {
  const files = tempFiles(t)
  writeFileSync(files.reasks, JSON.stringify([
    { pair: 'h4-r1', judge: 1, attempt: 1, reasons: ['no init message'] },
    { pair: 'h4-r2', judge: 1, attempt: 1, reasons: ['no init message'] },
    { pair: 'h4-r1', judge: 1, attempt: 2, reasons: ['no init message'] },
  ]))
  const calls = []
  const call = async (job, attempt) => { calls.push(attempt); return { stdout: 'claude crashed', transcript: transcriptOf() } }
  const left = await runJobs([{ pair: 'h4-r1', judge: 1, labels: LABELS4 }], { rows: [], call, check: () => [], files, log: quiet })
  assert.equal(left, 1)
  assert.deepEqual(calls, [3])
  assert.deepEqual(readJson(files.leftOut).map(e => e.attempt), [3])
  assert.equal(readJson(files.reasks).length, 3, 'the last attempt is not a re-ask')
})

test('a judge whose session compacted is listed and still counts', async t => {
  const files = tempFiles(t)
  const transcript = transcriptOf('medium', [{ type: 'system', subtype: 'compact_boundary' }])
  const job = { pair: 'h4-r1', judge: 1, labels: LABELS4 }
  const left = await runJobs([job], { rows: [], call: async () => ({ stdout: verbose(fenced(good4)), transcript }), check: judgeCheck(PIN), files, log: quiet })
  assert.equal(left, 0)
  assert.deepEqual(readJson(files.compacted), [{ pair: 'h4-r1', judge: 1, attempt: 1 }])
  assert.equal(readJson(files.rows).length, 1)
})

test('a corrupt re-ask list stops runJobs with one line naming it, before any call', async t => {
  const files = tempFiles(t)
  writeFileSync(files.reasks, '[{"pair": ')
  const calls = []
  await assert.rejects(runJobs([{ pair: 'h4-r1', judge: 1, labels: LABELS4 }], { rows: [], call: scripted({}, calls), check: () => [], files, log: quiet }), {
    message: `${files.reasks} is not valid JSON: fix it before judging resumes`,
  })
  assert.deepEqual(calls, [])
  // A list that cannot be read is not reported as bad JSON.
  rmSync(files.reasks)
  mkdirSync(files.reasks)
  await assert.rejects(runJobs([{ pair: 'h4-r1', judge: 1, labels: LABELS4 }], { rows: [], call: scripted({}, calls), check: () => [], files, log: quiet }), {
    message: `cannot read ${files.reasks} (EISDIR)`,
  })
})

test('judgeCheck holds a judge to the pin and to the round effort', () => {
  const stdout = verbose(fenced(good4))
  assert.deepEqual(judgeCheck(PIN)({ stdout, transcript: transcriptOf() }), [])
  assert.deepEqual(judgeCheck(PIN)({ stdout, transcript: transcriptOf('high') }), ['assistant effort high, expected medium'])
  assert.deepEqual(judgeCheck(PIN)({ stdout: 'claude crashed', transcript: transcriptOf() }), ['no init message'])
  const live = { ...INIT, plugins: [...INIT.plugins, { source: 'section-team@inline', path: 'C:/plug' }] }
  assert.ok(judgeCheck(PIN)({ stdout: verbose('x', live), transcript: transcriptOf() }).includes('section-team loaded in judge'))
})

// --permission-mode default must have taken effect: the user's own default ("auto") would approve more tools.
test('judgeCheck fails a judge whose init shows a permission mode other than default or manual', () => {
  const check = permissionMode => judgeCheck(PIN)({ stdout: verbose(fenced(good4), { ...INIT, permissionMode }), transcript: transcriptOf() })
  assert.deepEqual([check('default'), check('manual')], [[], []])
  assert.deepEqual(check('auto'), ['judge ran in permission mode auto'])
  assert.deepEqual(check('bypassPermissions'), ['judge ran in permission mode bypassPermissions'])
  assert.deepEqual(check(undefined), ['judge ran in permission mode none'])
})

// Read, Glob, Grep and cat are not confined to the copy: a tool call that names a blind key fails the attempt.
test('judgeCheck fails a judge whose tool calls, in its session or a subagent, name a blind key', () => {
  const stdout = verbose(fenced(good4))
  const toolCall = input => ({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input }] } })
  const peek = transcriptOf('medium', [toolCall({ file_path: 'C:/Users/Asus/claude-team-moderound/bench/results/blind-key-mo.json' })])
  assert.deepEqual(judgeCheck(PIN)({ stdout, transcript: peek }), ['judge touched a blind key'])
  const shell = transcriptOf('medium', [toolCall({ command: 'cat ../../bench/results/External-Key-mo.json' })])
  assert.deepEqual(judgeCheck(PIN)({ stdout, transcript: transcriptOf(), subagentTranscripts: [shell] }), ['judge touched a blind key'])
  const said = transcriptOf('medium', [{ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'no blind-key here' }] } }])
  assert.deepEqual(judgeCheck(PIN)({ stdout, transcript: said }), [], 'only tool calls count, not the answer text')
  // A judge working in its temp copy has no reason to name the results folder: a wildcard or a folder-wide search there counts.
  for (const input of [{ command: 'cat ../../Bench/Results/*.json' }, { path: 'C:\\Users\\Asus\\claude-team-moderound\\bench\\\\results', pattern: 'W' }, { pattern: '**/bench/results/**' }]) {
    assert.deepEqual(judgeCheck(PIN)({ stdout, transcript: transcriptOf('medium', [toolCall(input)]) }), ['judge touched a blind key'], JSON.stringify(input))
  }
})

test('BLIND_KEY matches key file names, bench/results in either slash, and the cloud sync copy, any case', () => {
  for (const hit of ['blind-key-mo.json', 'EXTERNAL-KEY', 'bench/results', 'bench\\results', 'bench//results', 'Bench\\\\Results\\x', '/root/bench-sync/bench-mode-round-cloud-results/results', 'BENCH-SYNC']) assert.match(hit, BLIND_KEY, hit)
  for (const miss of ['bench/result', 'benchresults', 'blindkey', 'results/h4', 'bench results', 'benchsync']) assert.doesNotMatch(miss, BLIND_KEY, miss)
})

test('judgeOptions reads round, per-pair and limit, and rejects a bad command line', () => {
  assert.deepEqual(judgeOptions(['--round=ho', '--per-pair=2']), { round: 'ho', perPair: 2, limit: Infinity })
  assert.deepEqual(judgeOptions(['--round=ho', '--per-pair=2', '--limit=1']), { round: 'ho', perPair: 2, limit: 1 })
  for (const argv of [[], ['--round=ho'], ['--per-pair=2'], ['--round=../x', '--per-pair=2'], ['--round=ho', '--per-pair=0'], ['--round=ho', '--per-pair=2', '--limit=0']]) {
    assert.throws(() => judgeOptions(argv), /usage/, argv.join(' '))
  }
})

test('the CLI prints one usage line and exits 1 on a bad command line, without calling claude', () => {
  const res = spawnSync(process.execPath, [join(BENCH, 'judge.mjs'), '--round=ho'], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.equal(res.stdout, '')
  assert.match(res.stderr, /^judge: usage: node bench\/judge\.mjs --round=<name> --per-pair=<n> \[--limit=<n>\]\n$/)
})

test('judges get no rm or mktemp, and the prompt sends probes to scratch/ instead of asking them to delete anything', () => {
  assert.doesNotMatch(ALLOWED, /Bash\((rm|mktemp) /)
  const template = readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8')
  assert.match(template, /`scratch` folder/)
  assert.doesNotMatch(template, /mktemp|rm -rf/)
})

test('withCopy gives each judge its own copy of the pair plus an empty scratch/, and deletes it after, also on a throw', async t => {
  const source = mkdtempSync(join(tmpdir(), 'judge-pair-'))
  t.after(() => rmSync(source, { recursive: true, force: true }))
  for (const label of ['X', 'Y']) {
    mkdirSync(join(source, label))
    writeFileSync(join(source, label, 'a.mjs'), `// ${label}\n`)
  }
  let seen
  const out = await withCopy(source, async dir => {
    seen = dir
    assert.deepEqual(readdirSync(dir).sort(), ['X', 'Y', 'scratch'])
    assert.deepEqual(readdirSync(join(dir, 'scratch')), [])
    writeFileSync(join(dir, 'X', 'a.mjs'), 'changed by judge 1')
    rmSync(join(dir, 'Y'), { recursive: true })
    return 'verdict'
  })
  assert.equal(out, 'verdict')
  assert.ok(!existsSync(seen), 'copy deleted')
  assert.equal(readFileSync(join(source, 'X', 'a.mjs'), 'utf8'), '// X\n')
  assert.ok(existsSync(join(source, 'Y', 'a.mjs')), 'the next judge still gets Y')
  await assert.rejects(withCopy(source, async dir => { seen = dir; throw new Error('claude failed') }), /claude failed/)
  assert.ok(!existsSync(seen), 'copy deleted after a throw')
})

test('withCopy keeps the verdict and logs the folder when the copy cannot be deleted', async t => {
  const source = mkdtempSync(join(tmpdir(), 'judge-pair-'))
  const seen = []
  t.after(() => {
    for (const dir of [source, ...seen]) rmSync(dir, { recursive: true, force: true })
  })
  const lines = []
  const opts = { log: line => lines.push(line), remove: () => { throw new Error('EBUSY: resource busy or locked') } }
  const out = await withCopy(source, async dir => { seen.push(dir); return 'verdict' }, opts)
  assert.equal(out, 'verdict')
  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith(`could not delete judge folder ${seen[0]}: EBUSY`), lines[0])
  // When the judge itself fails too, its error wins and the stuck folder is still logged.
  await assert.rejects(withCopy(source, async dir => { seen.push(dir); throw new Error('claude failed') }, opts), /claude failed/)
  assert.equal(lines.length, 2)
  assert.ok(lines[1].startsWith(`could not delete judge folder ${seen[1]}: EBUSY`), lines[1])
})

test('withCopy keeps a relative symlink inside the copy, so a judge cannot write through it into the shared pair', async t => {
  const source = mkdtempSync(join(tmpdir(), 'judge-pair-'))
  t.after(() => rmSync(source, { recursive: true, force: true }))
  mkdirSync(join(source, 'X'))
  mkdirSync(join(source, 'Y'))
  writeFileSync(join(source, 'Y', 'data.txt'), 'original')
  try {
    symlinkSync(join('..', 'Y', 'data.txt'), join(source, 'X', 'data.txt'), 'file')
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('no permission to make symlinks here')
    throw err
  }
  await withCopy(source, async dir => writeFileSync(join(dir, 'X', 'data.txt'), 'written by judge 1'))
  assert.equal(readFileSync(join(source, 'Y', 'data.txt'), 'utf8'), 'original')
})

// Without --verbose, `claude -p --output-format json` prints the result message alone.
test('runJobs reads a verdict from a lone result object too', async t => {
  const files = tempFiles(t)
  const jobs = [{ pair: 'h1-r1', judge: 1, labels: LABELS }]
  const left = await runJobs(jobs, { rows: [], call: async () => ({ stdout: envelope(fenced(good)), transcript: transcriptOf() }), check: () => [], files, log: quiet })
  assert.equal(left, 0)
  assert.deepEqual(readJson(files.rows), [{ pair: 'h1-r1', ...good, judge: 1, costUSD: 1.25 }])
})

test('judges run the round model and effort, verbose json, only the judge tools, and clean settings with section-team off', () => {
  const opts = { sessionId: 'sid-1', installedKeys: ['a@market'], pluginDir: 'C:/plug' }
  const args = judgeArgs('the prompt', opts)
  // --permission-mode default: only ALLOWED runs, whatever the user's own default mode (Claude Code 2.1.296 accepts
  // "default" although its --help lists "manual"; an unknown mode is refused before any session starts).
  assert.deepEqual(args, [
    '-p', 'the prompt', '--output-format', 'json', '--allowedTools', ALLOWED, '--permission-mode', 'default', ...commonArgs({ sessionId: 'sid-1' }),
    '--settings', JSON.stringify(cleanSettings({ installedKeys: ['a@market'], sectionTeam: false, pluginDir: 'C:/plug' })),
  ])
  const at = flag => args[args.indexOf(flag) + 1]
  assert.deepEqual([at('--model'), at('--effort'), at('--session-id')], ['claude-opus-5-5', 'medium', 'sid-1'])
  assert.ok(args.includes('--verbose'))
  const { enabledPlugins } = JSON.parse(at('--settings'))
  assert.equal(enabledPlugins['section-team@inline'], false)
  assert.equal(enabledPlugins['a@market'], false)
})

test('mirrorSwap: judge 2 of a two-label pair sees X and Y swapped; an odd count keeps its middle label', () => {
  assert.equal(mirrorSwap(1, ['X', 'Y']), null)
  assert.deepEqual(mirrorSwap(2, ['X', 'Y']), [['X', 'Y']])
  assert.deepEqual(mirrorSwap(2, ['X']), [])
  assert.deepEqual(mirrorSwap(2, ['X', 'Y', 'Z']), [['X', 'Z']])
})

test('mirrorSwap pairs W-Z and X-Y for judge 2 and nothing for judge 1', () => {
  const labels = Object.freeze(['X', 'Y', 'Z', 'W'])
  assert.equal(mirrorSwap(1, labels), null)
  assert.equal(mirrorSwap(3, labels), null)
  assert.deepEqual(mirrorSwap(2, labels), [['W', 'Z'], ['X', 'Y']])
  assert.deepEqual(mirrorSwap(4, labels), [['W', 'Z'], ['X', 'Y']])
})

test('withCopy swaps the X and Y folders in the copy only', async t => {
  const source = pairFolder(t, ['X', 'Y'])
  const seen = await withCopy(source, async dir => ['X', 'Y'].map(l => readFileSync(join(dir, l, 'who.txt'), 'utf8')), { swap: [['X', 'Y']] })
  assert.deepEqual(seen, ['Y', 'X'])
  assert.equal(readFileSync(join(source, 'X', 'who.txt'), 'utf8'), 'X')
})

test('withCopy mirrors four folders and unswap maps scores and ranking back', async t => {
  const source = pairFolder(t, LABELS4)
  const swap = mirrorSwap(2, LABELS4)
  const seen = await withCopy(source, async dir => ({
    names: readdirSync(dir).sort(),
    who: LABELS4.map(l => readFileSync(join(dir, l, 'who.txt'), 'utf8')),
  }), { swap })
  assert.deepEqual(seen, { names: [...LABELS4, 'scratch'], who: ['Z', 'Y', 'X', 'W'] })
  assert.deepEqual(LABELS4.map(l => readFileSync(join(source, l, 'who.txt'), 'utf8')), LABELS4, 'the shared pair is untouched')
  // The judge scored the folders it saw (its W is the real Z) and ranked its Y, the real X, first.
  const row = Object.freeze({ pair: 'h4-r1', ...good4, judge: 2, costUSD: 1 })
  assert.deepEqual(unswap(row, swap), { pair: 'h4-r1', W: good4.Z, X: good4.Y, Y: good4.X, Z: good4.W, ranking: ['X', 'Z', 'W', 'Y'], judge: 2, costUSD: 1, swapped: true })
  assert.equal(unswap(row, null), row)
  assert.equal(unswap(row, []), row, 'an empty swap list leaves the row unmarked')
})

test('runJobs maps a swapped judge\'s verdict back to the real labels', async t => {
  const files = tempFiles(t)
  // The judge saw the real Y in folder X: it scored its X 6 and its Y 8, and ranked its Y first.
  const jobs = [{ pair: 'h1-r1', judge: 2, labels: LABELS, swap: [['X', 'Y']] }]
  const left = await runJobs(jobs, { rows: [], call: async () => ({ stdout: verbose(fenced(good)), transcript: transcriptOf() }), check: () => [], files, log: quiet })
  assert.equal(left, 0)
  assert.deepEqual(readJson(files.rows), [{ pair: 'h1-r1', X: good.Y, Y: good.X, ranking: ['X', 'Y'], judge: 2, costUSD: 1.25, swapped: true }])
})

test('prepareJob gives judge 2 of a two-solution pair the X/Y swap, and judge 1 none', t => {
  const judgeDir = mkdtempSync(join(tmpdir(), 'judge-dir-'))
  t.after(() => rmSync(judgeDir, { recursive: true, force: true }))
  for (const label of ['X', 'Y', 'SEED']) mkdirSync(join(judgeDir, 'h2-r1', label), { recursive: true })
  const template = 'Solutions: {{LABELS}}. {{SEED_NOTE}}\n{{TASK}}'
  const first = prepareJob({ pair: 'h2-r1', judge: 1 }, judgeDir, template)
  const second = prepareJob({ pair: 'h2-r1', judge: 2 }, judgeDir, template)
  assert.deepEqual([first.labels, first.swap], [['X', 'Y'], null])
  assert.deepEqual(second.swap, [['X', 'Y']])
  assert.equal(second.prompt, first.prompt, 'both judges get the same prompt')
  assert.match(first.prompt, /^Solutions: X, Y\. SEED\/ is the repo/)
})

test('prepareJob gives the judges of a two-stage task both prompts, and a single-stage task its file as it is', t => {
  const judgeDir = mkdtempSync(join(tmpdir(), 'judge-dir-'))
  t.after(() => rmSync(judgeDir, { recursive: true, force: true }))
  for (const pair of ['h7-r1', 'h2-r1']) for (const label of ['X', 'Y']) mkdirSync(join(judgeDir, pair, label), { recursive: true })
  const task = name => readFileSync(join(BENCH, 'tasks', `${name}.md`), 'utf8')
  const { prompt } = prepareJob({ pair: 'h7-r1', judge: 1 }, judgeDir, '{{TASK}}')
  assert.ok(prompt.startsWith(task('h7')), 'the first prompt comes first')
  assert.ok(prompt.endsWith(task('h7-s2')), 'the second prompt comes last')
  assert.equal(prepareJob({ pair: 'h2-r1', judge: 1 }, judgeDir, '{{TASK}}').prompt, task('h2'))
})

test('edgeCounts counts first and last folders per setup', () => {
  const key = { 'h4-r1': { X: 'solo', Y: 'lean', Z: 'team', W: 'max' }, 'h5-r1': { X: 'lean', Y: 'team', Z: 'max', W: 'solo' } }
  const jobs = ['h4-r1', 'h5-r1'].flatMap(pair => [1, 2].map(judge => ({ pair, judge, labels: LABELS4, swap: mirrorSwap(judge, LABELS4) })))
  // Judge 1 of h4-r1 sees max (W) first and team (Z) last; of h5-r1, solo first and max last. Judges 2 see the mirror.
  assert.deepEqual(edgeCounts(key, jobs.filter(job => job.judge === 1)), {
    lean: { first: 0, last: 0 }, max: { first: 1, last: 1 }, solo: { first: 1, last: 0 }, team: { first: 0, last: 1 },
  })
  assert.deepEqual(edgeCounts(key, jobs), {
    lean: { first: 0, last: 0 }, max: { first: 2, last: 2 }, solo: { first: 1, last: 1 }, team: { first: 1, last: 1 },
  })
  assert.throws(() => edgeCounts({ 'h4-r1': key['h4-r1'] }, jobs), /h5-r1/)
})

// edges.json counts the judgments that were saved, not the planned ones: a left-out job is not a judgment.
test('countedEdges counts only the planned jobs that have a saved row', () => {
  const key = { 'h4-r1': { X: 'solo', Y: 'lean', Z: 'team', W: 'max' }, 'h5-r1': { X: 'lean', Y: 'team', Z: 'max', W: 'solo' } }
  const planned = ['h4-r1', 'h5-r1'].flatMap(pair => [1, 2].map(judge => ({ pair, judge, labels: LABELS4, swap: mirrorSwap(judge, LABELS4) })))
  const rows = [{ pair: 'h4-r1', judge: 1 }, { pair: 'h5-r1', judge: 2 }]
  assert.deepEqual(countedEdges(key, planned, rows), edgeCounts(key, [planned[0], planned[3]]))
  assert.deepEqual(countedEdges(key, planned, rows), {
    lean: { first: 0, last: 0 }, max: { first: 2, last: 0 }, solo: { first: 0, last: 1 }, team: { first: 0, last: 1 },
  }, 'h4-r1 judge 1 sees max first and team last; h5-r1 judge 2 sees the mirror: max first, solo last')
  assert.deepEqual(countedEdges(key, planned, []), {})
})

test('checkLeakScan refuses to judge a round with groups before its leak scan is written', t => {
  const results = mkdtempSync(join(tmpdir(), 'judge-leak-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  assert.throws(() => checkLeakScan(results, 'mo', ['h4-r1']), { message: 'run node bench/leak-scan.mjs --round=mo first' })
  assert.doesNotThrow(() => checkLeakScan(results, 'mo', []), 'nothing to judge')
  writeFileSync(join(results, 'leak-scan-mo.json'), '{}')
  assert.doesNotThrow(() => checkLeakScan(results, 'mo', ['h4-r1']))
})

test('the committed prompt\'s example answer shows four labels and a full ranking', () => {
  const template = readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8')
  const example = JSON.parse(template.split('\n')[35])
  assert.deepEqual(Object.keys(example), [...LABELS4, 'ranking'])
  assert.deepEqual(example.ranking, ['Y', 'W', 'Z', 'X'])
  // parseVerdict checks all six scores and the notes of every label.
  assert.deepEqual(parseVerdict(template, 'p', LABELS4), { pair: 'p', ...example })
})

// A stand-in for the pinned binary: it writes the session transcript where Claude Code would and prints a verdict.
// With subagent set, the session also leaves <sessionId>/subagents/x.jsonl with that text, as a judge's Agent call would.
function fakeJudge({ home, calls, transcript = true, stdout = verbose(fenced(good4)), subagent = null }) {
  return (command, args, options) => {
    const sessionId = args[args.indexOf('--session-id') + 1]
    calls.push({ command, args, options, sessionId, inW: readFileSync(join(options.cwd, 'W', 'who.txt'), 'utf8') })
    const project = projectDirFor(options.cwd, home)
    mkdirSync(project, { recursive: true })
    if (transcript) writeFileSync(join(project, `${sessionId}.jsonl`), transcriptOf())
    if (subagent !== null) {
      mkdirSync(join(project, sessionId, 'subagents'), { recursive: true })
      writeFileSync(join(project, sessionId, 'subagents', 'x.jsonl'), subagent)
    }
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() })
    once(child.stdout, 'end').then(() => child.emit('close', 0))
    setImmediate(() => child.stdout.end(stdout))
    return child
  }
}

function callSetup(t, spawnFor, deps = {}) {
  const root = mkdtempSync(join(tmpdir(), 'judge-call-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const files = judgeFiles(join(root, 'results'), 't')
  const pin = { ...PIN, binary: 'C:/bench-runs/claude-2.1.296.exe' }
  const env = { PATH: 'C:/bin', CLAUDECODE: '1' }
  const call = judgeCall({ pin, installedKeys: ['a@market'], files, env, home, spawn: spawnFor(home), log: quiet, ...deps })
  const job = { pair: 'h4-r1', judge: 2, source: pairFolder(t, LABELS4), prompt: 'judge this', swap: mirrorSwap(2, LABELS4) }
  return { call, job, files, pin, env }
}

test('each judge attempt starts the pinned binary in a fresh session of a mirrored copy and keeps its transcript', async t => {
  const calls = []
  const { call, job, files, pin, env } = callSetup(t, home => fakeJudge({ home, calls }))
  const first = await call(job, 1)
  await call(job, 2)
  assert.deepEqual(first, { stdout: verbose(fenced(good4)), transcript: transcriptOf(), subagentTranscripts: [] })
  assert.deepEqual(calls.map(c => c.command), [pin.binary, pin.binary])
  assert.match(calls[0].sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.notEqual(calls[0].sessionId, calls[1].sessionId, 'a fresh session per attempt')
  assert.deepEqual(calls[0].args, judgeArgs('judge this', { sessionId: calls[0].sessionId, installedKeys: ['a@market'], pluginDir: pin.pluginDir }))
  assert.deepEqual(calls[0].options.env, childEnv(env, { pluginDir: pin.pluginDir }))
  assert.equal(calls[0].inW, 'Z', 'judge 2 sees the real Z in folder W')
  assert.equal(readFileSync(join(files.transcripts, 'h4-r1-2-a1.jsonl'), 'utf8'), transcriptOf())
  assert.ok(existsSync(join(files.transcripts, 'h4-r1-2-a2.jsonl')))
  assert.ok(!existsSync(calls[0].options.cwd), 'the copy is deleted')
})

// Both are harness or account faults, not the judge's: judging stops without using an attempt, so a resume asks again.
test('a judge session that left no transcript, or hit a usage limit, stops judging without using an attempt', async t => {
  const calls = []
  const { call, job, files } = callSetup(t, home => fakeJudge({ home, calls, transcript: false }))
  await assert.rejects(call(job, 1), { message: /^judge h4-r1 #2 left no session transcript at .+\.jsonl: fix the harness, then resume$/ })
  assert.ok(!existsSync(files.transcripts))
  assert.ok(!existsSync(calls[0].options.cwd), 'the copy is deleted')
  const limit = JSON.stringify([INIT, { type: 'result', is_error: true, result: "You've hit your usage limit · resets 5pm" }])
  const limited = callSetup(t, home => fakeJudge({ home, calls, stdout: limit }))
  const run = runJobs([{ ...limited.job, labels: LABELS4 }], { rows: [], call: limited.call, check: judgeCheck(PIN), files: limited.files, log: quiet })
  await assert.rejects(run, { message: 'judge h4-r1 #2 hit a usage or rate limit: resume judging in the next usage window' })
  assert.ok(!existsSync(limited.files.reasks) && !existsSync(limited.files.leftOut), 'no attempt used')
})

// A judge that never ends (with the background wait off, a judge's background task can keep claude -p waiting) is
// stopped at its time limit: the whole process tree is killed, and the attempt is unusable and re-asked.
function hangingJudge({ home, calls, transcript = true }) {
  return (command, args, options) => {
    const sessionId = args[args.indexOf('--session-id') + 1]
    calls.push({ command, options })
    const project = projectDirFor(options.cwd, home)
    mkdirSync(project, { recursive: true })
    if (transcript) writeFileSync(join(project, `${sessionId}.jsonl`), transcriptOf())
    const child = Object.assign(new EventEmitter(), { pid: 2147483647, stdout: new PassThrough() })
    once(child.stdout, 'end').then(() => child.emit('close', null, 'SIGKILL'))
    return child
  }
}

test('Opus judges get 60 minutes per attempt and start in the harness\'s process group, as before', () => {
  assert.equal(JUDGE_TIMEOUT_MS, 60 * 60_000)
  const env = { PATH: '/bin' }
  assert.deepEqual(judgeSpawnOptions('/tmp/c', env), { cwd: '/tmp/c', env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
})

test('a judge attempt at its time limit has its tree killed and comes back timed out, transcript kept when there is one', async t => {
  const calls = []
  const killed = []
  const kill = child => { killed.push(child.pid); child.stdout.end() }
  const { call, job, files } = callSetup(t, home => hangingJudge({ home, calls }), { kill, timeoutMs: 30 })
  const answer = await call(job, 1)
  assert.deepEqual(answer, { stdout: '', transcript: transcriptOf(), subagentTranscripts: [], timedOut: true })
  assert.deepEqual(killed, [2147483647])
  assert.deepEqual(calls[0].options, judgeSpawnOptions(calls[0].options.cwd, calls[0].options.env))
  assert.ok(existsSync(join(files.transcripts, 'h4-r1-2-a1.jsonl')))
  assert.ok(!existsSync(calls[0].options.cwd), 'the copy is deleted')
  const bare = callSetup(t, home => hangingJudge({ home, calls, transcript: false }), { kill, timeoutMs: 30 })
  assert.deepEqual(await bare.call(bare.job, 1), { stdout: '', transcript: '', subagentTranscripts: [], timedOut: true }, 'no transcript is no harness stop here')
  assert.deepEqual(judgeCheck(PIN)(answer), ['judge timed out'])
})

test('a timed-out judge attempt is unusable with the reason "judge timed out" and is re-asked; three are left out', async t => {
  const files = tempFiles(t)
  const job = { pair: 'h4-r1', judge: 1, labels: LABELS4, swap: null }
  const late = { stdout: '', transcript: transcriptOf(), subagentTranscripts: [], timedOut: true }
  const ok = { stdout: verbose(fenced(good4)), transcript: transcriptOf() }
  const calls = []
  assert.equal(await runJobs([job], { rows: [], call: scripted({ 'h4-r1#1': [late, ok] }, calls), check: judgeCheck(PIN), files, log: quiet }), 0)
  assert.deepEqual(calls, ['h4-r1#1a1', 'h4-r1#1a2'])
  assert.deepEqual(readJson(files.reasks), [{ pair: 'h4-r1', judge: 1, attempt: 1, reasons: ['judge timed out'] }])
  assert.equal(readJson(files.rows).length, 1)
  const other = tempFiles(t)
  assert.equal(await runJobs([job], { rows: [], call: async () => late, check: judgeCheck(PIN), files: other, log: quiet }), 1)
  assert.deepEqual(readJson(other.leftOut), [{ pair: 'h4-r1', judge: 1, attempt: 3, reasons: ['judge timed out'] }])
})

// Judges are checked like a solo run: their subagents' transcripts are kept and held to the round effort too.
test('a judge attempt keeps its subagent transcripts and judgeCheck holds them to the round effort; compacted reads the main one', async t => {
  const calls = []
  const { call, job, files } = callSetup(t, home => fakeJudge({ home, calls, subagent: transcriptOf('high') }))
  const answer = await call(job, 1)
  assert.deepEqual(answer.subagentTranscripts, [transcriptOf('high')])
  assert.equal(readFileSync(join(files.transcripts, 'h4-r1-2-a1', 'subagents', 'x.jsonl'), 'utf8'), transcriptOf('high'))
  assert.deepEqual(judgeCheck(PIN)(answer), ['assistant effort high, expected medium'])
  const compact = transcriptOf('medium', [{ type: 'system', subtype: 'compact_boundary' }])
  const left = await runJobs([{ ...job, labels: LABELS4 }], { rows: [], call: async () => ({ ...answer, subagentTranscripts: [compact] }), check: () => [], files, log: quiet })
  assert.equal(left, 0)
  assert.ok(!existsSync(files.compacted), 'a compacted subagent is not a compacted judge')
})

// A rerun of the same attempt number (a kill after keepTranscript) must not check the earlier session's subagents.
test('a judge attempt replaces, never merges, a subagent folder an earlier session left under the same attempt name', async t => {
  const { call, job, files } = callSetup(t, home => fakeJudge({ home, calls: [], subagent: transcriptOf('medium') }))
  mkdirSync(join(files.transcripts, 'h4-r1-2-a1', 'subagents'), { recursive: true })
  writeFileSync(join(files.transcripts, 'h4-r1-2-a1', 'subagents', 'old.jsonl'), transcriptOf('high'))
  const answer = await call(job, 1)
  assert.deepEqual(answer.subagentTranscripts, [transcriptOf('medium')])
  assert.deepEqual(readdirSync(join(files.transcripts, 'h4-r1-2-a1', 'subagents')), ['x.jsonl'])
  assert.deepEqual(judgeCheck(PIN)(answer), [])
})

// The kept folder always belongs to the session whose main transcript sits beside it, also when that one had none.
test('a judge attempt with no subagents removes a subagent folder an earlier session left under the same attempt name', async t => {
  const { call, job, files } = callSetup(t, home => fakeJudge({ home, calls: [] }))
  mkdirSync(join(files.transcripts, 'h4-r1-2-a1', 'subagents'), { recursive: true })
  writeFileSync(join(files.transcripts, 'h4-r1-2-a1', 'subagents', 'old.jsonl'), transcriptOf('high'))
  const answer = await call(job, 1)
  assert.deepEqual(answer.subagentTranscripts, [])
  assert.ok(!existsSync(join(files.transcripts, 'h4-r1-2-a1')), 'the stale folder is gone')
  assert.ok(existsSync(join(files.transcripts, 'h4-r1-2-a1.jsonl')))
})

// An API error or a missing result is not the judge's fault: judging stops and uses no attempt, so a resume asks again.
test('a judge session that ends on an API error or with no result stops judging without using an attempt', async t => {
  const oauth = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}'
  const ends = [
    [[INIT, { type: 'result', is_error: true, result: 'API Error: 529 overloaded\nretry later' }], 'API Error: 529 overloaded'],
    [[INIT, { type: 'result', is_error: true, result: oauth }], oauth],
    [[INIT], 'no result'],
  ]
  for (const [messages, said] of ends) {
    const setup = callSetup(t, home => fakeJudge({ home, calls: [], stdout: JSON.stringify(messages) }))
    const run = runJobs([{ ...setup.job, labels: LABELS4 }], { rows: [], call: setup.call, check: judgeCheck(PIN), files: setup.files, log: quiet })
    await assert.rejects(run, { message: `judge h4-r1 #2 ended with an API error or no result: fix the cause (login, outage), then resume (${said})` }, said)
    assert.ok(!existsSync(setup.files.reasks) && !existsSync(setup.files.leftOut), 'no attempt used')
  }
})

test('a binary that cannot start stops judging with one line', async t => {
  const missing = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() })
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })))
    return child
  }
  const broken = callSetup(t, () => missing)
  await assert.rejects(broken.call(broken.job, 1), { message: 'could not start claude (C:/bench-runs/claude-2.1.296.exe: ENOENT)' })
})

test('taskTextOf gives the judges of a three-stage task all three prompts in order, each after its own line', t => {
  const bench = mkdtempSync(join(tmpdir(), 'judge-bench-'))
  t.after(() => rmSync(bench, { recursive: true, force: true }))
  mkdirSync(join(bench, 'tasks'))
  for (const [file, text] of [['p1', 'FIRST'], ['p1-s2', 'SECOND'], ['p1-s3', 'THIRD']]) writeFileSync(join(bench, 'tasks', `${file}.md`), text)
  const text = taskTextOf(bench, 'p1-r1')
  assert.deepEqual(['FIRST', 'second request', 'SECOND', 'third request', 'THIRD'].map(part => text.indexOf(part)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1])), true, text)
  // A pair run with --stages=1 is judged on the first prompt alone; --stages=2 on the first two.
  assert.equal(taskTextOf(bench, 'p1-r1', 1), 'FIRST')
  const two = taskTextOf(bench, 'p1-r1', 2)
  assert.ok(two.includes('SECOND') && !two.includes('THIRD') && !two.includes('third request'), two)
  for (const bad of [0, 4, 1.5, '1']) assert.throws(() => taskTextOf(bench, 'p1-r1', bad), RangeError, String(bad))
})

test('prepareJob tells the judges only the stages the pair\'s runs asked for, as anonymize recorded them', t => {
  const judgeDir = mkdtempSync(join(tmpdir(), 'judge-stages-'))
  t.after(() => rmSync(judgeDir, { recursive: true, force: true }))
  for (const pair of ['p1-r1', 'p1-r2']) for (const label of ['X', 'Y']) mkdirSync(join(judgeDir, pair, label), { recursive: true })
  writeFileSync(join(judgeDir, 'stages.json'), JSON.stringify({ 'p1-r1': 1 }))
  const task = name => readFileSync(join(BENCH, 'tasks', `${name}.md`), 'utf8')
  assert.equal(prepareJob({ pair: 'p1-r1', judge: 1 }, judgeDir, '{{TASK}}').prompt, task('p1'), 'a --stages=1 pair gets only the first prompt')
  const all = prepareJob({ pair: 'p1-r2', judge: 1 }, judgeDir, '{{TASK}}').prompt
  assert.ok(all.startsWith(task('p1')) && all.endsWith(task('p1-s3')), 'a pair not listed gets every prompt')
})
