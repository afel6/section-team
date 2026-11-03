// Runs the test suite against each near-miss mutant and reports KILLED or SURVIVED.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TARGETS = ['jsonpatch.mjs', 'jsonpatch-cli.mjs'];
const NAME_RE = /^\d+-(jsonpatch(?:-cli)?\.mjs)$/;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshotOriginals() {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-nm-'));
  const hashes = {};
  for (const target of TARGETS) {
    hashes[target] = sha256(path.join(ROOT, target));
    fs.copyFileSync(path.join(ROOT, target), path.join(backup, target));
  }
  return { backup, hashes };
}

function restoreAll(backup) {
  for (const target of TARGETS) {
    fs.copyFileSync(path.join(backup, target), path.join(ROOT, target));
  }
}

function listCopies(prefixes) {
  return fs
    .readdirSync(HERE)
    .filter((name) => NAME_RE.test(name))
    .filter((name) => prefixes.length === 0 || prefixes.some((p) => name.startsWith(p)))
    .sort();
}

function describeCopy(file) {
  const first = fs.readFileSync(path.join(HERE, file), 'utf8').split('\n', 1)[0];
  return first.replace(/^\/\/ near-miss: /, '');
}

function runTests() {
  return spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 300000,
  });
}

function failCount(result) {
  const match = /^# fail (\d+)/m.exec(result.stdout || '');
  return match ? match[1] : '?';
}

function runOne(file, backup) {
  const target = NAME_RE.exec(file)[1];
  try {
    fs.copyFileSync(path.join(HERE, file), path.join(ROOT, target));
    const result = runTests();
    const timedOut = result.error?.code === 'ETIMEDOUT';
    if (result.error && !timedOut) throw result.error;
    return { survived: !timedOut && result.status === 0, timedOut, fails: failCount(result) };
  } finally {
    restoreAll(backup);
  }
}

function label({ survived, timedOut }) {
  if (timedOut) return 'TIMEOUT';
  return survived ? 'SURVIVED' : 'KILLED';
}

function runAll(backup) {
  let survivors = 0;
  for (const file of listCopies(process.argv.slice(2))) {
    const outcome = runOne(file, backup);
    if (outcome.survived) survivors++;
    process.stdout.write(`${label(outcome)} ${file} — ${describeCopy(file)} (fail ${outcome.fails})\n`);
  }
  return survivors;
}

function main() {
  const { backup, hashes } = snapshotOriginals();
  const onSignal = () => {
    restoreAll(backup);
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let survivors;
  try {
    survivors = runAll(backup);
  } catch (err) {
    fs.rmSync(backup, { recursive: true, force: true });
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  const intact = TARGETS.every((t) => sha256(path.join(ROOT, t)) === hashes[t]);
  if (!intact) {
    process.stderr.write('ERROR: originals changed\n');
    process.exit(2);
  }
  fs.rmSync(backup, { recursive: true, force: true });
  process.stdout.write('originals intact\n');
  process.stdout.write(`survivors: ${survivors}\n`);
  process.exit(survivors > 0 ? 1 : 0);
}

main();
