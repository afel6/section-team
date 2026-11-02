// Builds .team/near-miss/<n>-<file> copies, swaps each in, runs the suite, always restores.
// Usage: node .team/scratch/near-miss-run.mjs [make|run] [n,n,...]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEAR_MISSES, TARGETS } from './near-miss-defs.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, '.team', 'near-miss');
const BACKUP = join(ROOT, '.team', 'scratch', 'originals');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const out = (line) => process.stdout.write(`${line}\n`);

function comment(file, bug) {
  return file.endsWith('.html') ? `<!-- near-miss: ${bug} -->\n` : `// near-miss: ${bug}\n`;
}

function make() {
  mkdirSync(DIR, { recursive: true });
  for (const [n, file, bug, edits] of NEAR_MISSES) {
    let text = readFileSync(join(ROOT, TARGETS[file]), 'utf8');
    for (const [from, to] of edits) {
      const count = text.split(from).length - 1;
      if (count !== 1) throw new Error(`near-miss ${n}: edit found ${count} times: ${from.slice(0, 60)}`);
      text = text.replace(from, () => to);
    }
    writeFileSync(join(DIR, `${n}-${file}`), comment(file, bug) + text);
  }
  out(`made ${NEAR_MISSES.length} near-miss copies`);
}

function runOne(n, file) {
  const target = join(ROOT, TARGETS[file]);
  const original = readFileSync(target);
  const originalSha = sha(original);
  const hadRootStore = existsSync(join(ROOT, 'bookings.json'));
  let status;
  try {
    writeFileSync(target, readFileSync(join(DIR, `${n}-${file}`)));
    const res = spawnSync(process.execPath, ['--test', '--test-timeout=30000', '--test-reporter=dot', ...testFiles()], {
      cwd: ROOT, encoding: 'utf8', timeout: 300000,
    });
    status = res.status;
  } finally {
    writeFileSync(target, original);
    // A near-miss may write files next to server.mjs; remove what the run created.
    if (!hadRootStore) rmSync(join(ROOT, 'bookings.json'), { force: true });
  }
  if (sha(readFileSync(target)) !== originalSha) throw new Error(`RESTORE FAILED for ${target}`);
  return status;
}

const testFiles = () => readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => join('test', f));

function run(only) {
  mkdirSync(BACKUP, { recursive: true });
  for (const file of Object.keys(TARGETS)) writeFileSync(join(BACKUP, file), readFileSync(join(ROOT, TARGETS[file])));
  const survivors = [];
  for (const [n, file, bug] of NEAR_MISSES) {
    if (only && !only.includes(n)) continue;
    const status = runOne(n, file);
    const caught = status !== 0;
    if (!caught) survivors.push(n);
    out(`${caught ? 'caught  ' : 'SURVIVED'} ${n}-${file}: ${bug} (exit ${status})`);
  }
  out(`survivors: ${survivors.length ? survivors.join(',') : 'none'}`);
  for (const file of Object.keys(TARGETS)) {
    const same = sha(readFileSync(join(BACKUP, file))) === sha(readFileSync(join(ROOT, TARGETS[file])));
    out(`original ${TARGETS[file]} ${same ? 'restored (sha256 match)' : 'MISMATCH'}`);
  }
}

const [mode = 'run', list] = process.argv.slice(2);
if (mode === 'make') make();
else run(list ? list.split(',').map(Number) : null);
