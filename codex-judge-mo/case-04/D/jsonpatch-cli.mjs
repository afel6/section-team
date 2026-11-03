#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;

class InputError extends Error {
  constructor(name, reason, exitCode) {
    super(`${name}: ${reason}`);
    this.exitCode = exitCode;
  }
}

function readFile(path) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new InputError(path, 'no such file', 1);
    let isDir = false;
    try {
      isDir = fs.statSync(path).isDirectory();
    } catch {
      // Not a directory we can see; fall through to "cannot read".
    }
    throw new InputError(path, isDir ? 'is a directory' : 'cannot read', 1);
  }
  try {
    if (fs.fstatSync(fd).isDirectory()) throw new InputError(path, 'is a directory', 1);
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(65536);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_BYTES) throw new InputError(path, 'too large', 1);
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError(path, err.code === 'EISDIR' ? 'is a directory' : 'cannot read', 1);
  } finally {
    fs.closeSync(fd);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const stop = (err) => {
      if (settled) return;
      settled = true;
      process.stdin.destroy();
      reject(err);
    };
    process.stdin.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BYTES) stop(new InputError('stdin', 'too large', 1));
      else chunks.push(chunk);
    });
    process.stdin.on('error', () => stop(new InputError('stdin', 'cannot read', 1)));
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

// Maximum nesting of arrays and objects in text that JSON.parse has accepted.
function jsonDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '[' || c === '{') {
      depth++;
      if (depth > max) max = depth;
    } else if (c === ']' || c === '}') {
      depth--;
    }
  }
  return max;
}

async function loadInput(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = arg === '-' ? await readStdin() : readFile(arg);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputError(name, 'invalid UTF-8', 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError(name, 'invalid JSON', 3);
  }
  if (jsonDepth(text) > MAX_DEPTH) throw new InputError(name, 'too deep', 3);
  return value;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) return fail(USAGE, 2);
  const [patchArg, docArg = '-'] = args;
  if (patchArg === '-' && docArg === '-') return fail(USAGE, 2);
  let result;
  try {
    const patch = await loadInput(patchArg);
    const doc = await loadInput(docArg);
    result = applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof InputError) return fail(`Error: ${err.message}`, err.exitCode);
    if (err instanceof PatchError) return fail(`Error: ${err.message}`, 4);
    throw err;
  }
  let output;
  try {
    output = `${JSON.stringify(result, null, 2)}\n`;
  } catch {
    // Only a result nested far deeper than any input can exhaust the stack here.
    return fail('Error: result too deep to print', 1);
  }
  process.stdout.write(output);
  process.exitCode = 0;
}

function fail(line, code) {
  process.stderr.write(`${line}\n`);
  process.exitCode = code;
}

await main(process.argv.slice(2));
