import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

process.chdir(new URL('.', import.meta.url).pathname);
writeFileSync('big.json', JSON.stringify(Array.from({ length: 150000 }, (_, i) => i)));
writeFileSync('empty-patch.json', '[]');
const child = spawn('node', ['../../jsonpatch-cli.mjs', 'empty-patch.json', 'big.json'], { stdio: ['pipe', 'pipe', 'pipe'] });
let err = '';
child.stderr.on('data', (d) => (err += d));
child.stdout.once('data', () => child.stdout.destroy());
child.stdin.end('[]');
child.on('close', (code) => console.log('exit', code, 'stderr', JSON.stringify(err)));
