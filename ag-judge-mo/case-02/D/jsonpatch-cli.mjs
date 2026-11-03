#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function readError(name, reason) {
  return new CliError(`Error: ${name}: ${reason}`, 1);
}

function isDirectory(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readFileLimited(path) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw readError(path, 'no such file');
    if (err.code === 'EISDIR' || isDirectory(path)) throw readError(path, 'is a directory');
    throw readError(path, 'cannot read');
  }
  try {
    if (fs.fstatSync(fd).isDirectory()) throw readError(path, 'is a directory');
    const chunks = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.alloc(65536);
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_BYTES) throw readError(path, 'too large');
      chunks.push(buf.subarray(0, n));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err.code === 'EISDIR') throw readError(path, 'is a directory');
    throw readError(path, 'cannot read');
  } finally {
    fs.closeSync(fd);
  }
}

function readStdinLimited() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let stream;
    try {
      stream = process.stdin;
    } catch {
      reject(readError('stdin', 'cannot read'));
      return;
    }
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        stream.destroy();
        reject(readError('stdin', 'too large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', () => reject(readError('stdin', 'cannot read')));
  });
}

function jsonDepth(value) {
  let max = 0;
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    const d = depth + 1;
    if (d > max) max = d;
    if (max > MAX_DEPTH) return max;
    for (const child of Object.values(v)) stack.push([child, d]);
  }
  return max;
}

async function loadJson(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = arg === '-' ? await readStdinLimited() : readFileLimited(arg);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CliError(`Error: ${name}: invalid UTF-8`, 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`Error: ${name}: invalid JSON`, 3);
  }
  if (jsonDepth(value) > MAX_DEPTH) throw new CliError(`Error: ${name}: too deep`, 3);
  return value;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const [patchArg, docArg = '-'] = args;
  if (patchArg === '-' && docArg === '-') throw new CliError(USAGE, 2);
  const patch = await loadJson(patchArg);
  const doc = await loadJson(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new CliError(`Error: ${err.message}`, 4);
    throw err;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((err) => {
  if (!(err instanceof CliError)) throw err;
  process.stderr.write(`${err.message}\n`);
  process.exitCode = err.exitCode;
});
