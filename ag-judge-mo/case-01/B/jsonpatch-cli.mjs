#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const STDIN = '-';

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
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

// Reads at most MAX_BYTES + 1 bytes from a file, so oversized inputs stop early.
function readFile(path) {
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
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buf.length) {
      const n = fs.readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    if (total > MAX_BYTES) throw readError(path, 'too large');
    return buf.subarray(0, total);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError(path, err.code === 'EISDIR' ? 'is a directory' : 'cannot read');
  } finally {
    fs.closeSync(fd);
  }
}

async function readStdin() {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of process.stdin) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        process.stdin.destroy();
        throw readError('stdin', 'too large');
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError('stdin', 'cannot read');
  }
  return Buffer.concat(chunks);
}

// Depth of a parsed JSON value, stopping as soon as it exceeds MAX_DEPTH.
function tooDeep(value) {
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (depth + 1 > MAX_DEPTH) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

async function load(arg) {
  const name = arg === STDIN ? 'stdin' : arg;
  const bytes = arg === STDIN ? await readStdin() : readFile(arg);
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
  if (tooDeep(value)) throw new CliError(`Error: ${name}: too deep`, 3);
  return value;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const [patchArg, docArg = STDIN] = args;
  if (patchArg === STDIN && docArg === STDIN) throw new CliError(USAGE, 2);
  const patch = await load(patchArg);
  const doc = await load(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new CliError(`Error: ${err.message}`, 4);
    throw err;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

try {
  await main(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  process.stderr.write(err.message + '\n');
  process.exitCode = err.code;
}
