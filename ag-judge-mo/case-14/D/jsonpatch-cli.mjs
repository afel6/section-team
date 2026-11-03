#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const CHUNK = 65536;

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Reads at most MAX_BYTES + 1 bytes from fd; returns a Buffer or throws an fs error.
function readFd(fd) {
  const chunks = [];
  let total = 0;
  for (;;) {
    const buf = Buffer.alloc(CHUNK);
    let n;
    try {
      n = fs.readSync(fd, buf, 0, CHUNK, null);
    } catch (err) {
      if (err.code === 'EAGAIN') {
        sleep(10);
        continue;
      }
      throw err;
    }
    if (n === 0) break;
    chunks.push(buf.subarray(0, n));
    total += n;
    if (total > MAX_BYTES) break;
  }
  return Buffer.concat(chunks, total);
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

function readInput(arg) {
  if (arg === '-') {
    try {
      return readFd(0);
    } catch {
      throw readError('stdin', 'cannot read');
    }
  }
  let fd;
  try {
    fd = fs.openSync(arg, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw readError(arg, 'no such file');
    throw readError(arg, err.code === 'EISDIR' || isDirectory(arg) ? 'is a directory' : 'cannot read');
  }
  try {
    if (fs.fstatSync(fd).isDirectory()) throw readError(arg, 'is a directory');
    return readFd(fd);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError(arg, err.code === 'EISDIR' ? 'is a directory' : 'cannot read');
  } finally {
    fs.closeSync(fd);
  }
}

// Depth of a parsed JSON value, computed without recursion.
function depthOf(value) {
  let max = 0;
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    const depth = d + 1;
    if (depth > max) max = depth;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth]);
  }
  return max;
}

function loadJson(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = readInput(arg);
  if (bytes.length > MAX_BYTES) throw readError(name, 'too large');
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
  if (depthOf(value) > MAX_DEPTH) throw new CliError(`Error: ${name}: too deep`, 3);
  return value;
}

function run(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const [patchArg, docArg = '-'] = args;
  if (patchArg === '-' && docArg === '-') throw new CliError(USAGE, 2);
  const patch = loadJson(patchArg);
  const doc = loadJson(docArg);
  try {
    return applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new CliError(`Error: ${err.message}`, 4);
    throw err;
  }
}

try {
  const result = run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = 0;
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  process.stderr.write(err.message + '\n');
  process.exitCode = err.code;
}
