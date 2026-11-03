#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;

class InputError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function readFile(path, name) {
  const fail = (reason) => new InputError(`Error: ${name}: ${reason}`, 1);
  let fd;
  try {
    fd = fs.openSync(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw fail('no such file');
    let isDir = false;
    try {
      isDir = fs.statSync(path).isDirectory();
    } catch {}
    throw fail(isDir ? 'is a directory' : 'cannot read');
  }
  try {
    let isDir = false;
    try {
      isDir = fs.fstatSync(fd).isDirectory();
    } catch {}
    if (isDir) throw fail('is a directory');
    const chunks = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.allocUnsafe(65536);
      let n;
      try {
        n = fs.readSync(fd, buf, 0, buf.length, null);
      } catch (err) {
        if (err.code === 'EISDIR') throw fail('is a directory');
        throw fail('cannot read');
      }
      if (n === 0) break;
      total += n;
      if (total > MAX_BYTES) throw fail('too large');
      chunks.push(buf.subarray(0, n));
    }
    return Buffer.concat(chunks, total);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}

async function readStdin() {
  const fail = (reason) => new InputError(`Error: stdin: ${reason}`, 1);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of process.stdin) {
      total += chunk.length;
      if (total > MAX_BYTES) break;
      chunks.push(chunk);
    }
  } catch {
    throw fail('cannot read');
  }
  if (total > MAX_BYTES) throw fail('too large');
  return Buffer.concat(chunks);
}

// Maximum bracket nesting of valid JSON text, which equals the value's depth.
function textDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (inString) {
      if (c === 0x5c) k++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x5b || c === 0x7b) {
      if (++depth > max) max = depth;
    } else if (c === 0x5d || c === 0x7d) {
      depth--;
    }
  }
  return max;
}

async function readInput(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = arg === '-' ? await readStdin() : readFile(arg, name);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputError(`Error: ${name}: invalid UTF-8`, 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    // A RangeError here means the text is valid but nested too deeply to parse.
    if (err instanceof SyntaxError) throw new InputError(`Error: ${name}: invalid JSON`, 3);
    throw new InputError(`Error: ${name}: too deep`, 3);
  }
  if (textDepth(text) > MAX_DEPTH) throw new InputError(`Error: ${name}: too deep`, 3);
  return value;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new InputError(USAGE, 2);
  const patchArg = args[0];
  const docArg = args.length === 2 ? args[1] : '-';
  if (patchArg === '-' && docArg === '-') throw new InputError(USAGE, 2);
  const patch = await readInput(patchArg);
  const doc = await readInput(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new InputError(`Error: ${err.message}`, 4);
    throw err;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = 0;
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof InputError) {
    process.stderr.write(err.message + '\n');
    process.exitCode = err.code;
  } else {
    process.stderr.write(`Error: ${err && err.message}\n`);
    process.exitCode = 1;
  }
});
