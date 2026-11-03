#!/usr/bin/env node
// Applies a JSON Patch to a JSON document: node jsonpatch-cli.mjs <patch> [<doc>]

import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const CHUNK_SIZE = 65536;

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fileError(code) {
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'no such file';
  if (code === 'EISDIR') return 'is a directory';
  return 'cannot read';
}

function isDirectory(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readFileBytes(path) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
  } catch (err) {
    const reason = fileError(err.code);
    return reason === 'cannot read' && isDirectory(path) ? 'is a directory' : reason;
  }
  try {
    if (fs.fstatSync(fd).isDirectory()) return 'is a directory';
    const chunks = [];
    let total = 0;
    while (total <= MAX_BYTES) {
      const chunk = Buffer.alloc(CHUNK_SIZE);
      const n = fs.readSync(fd, chunk, 0, CHUNK_SIZE, null);
      if (n === 0) break;
      chunks.push(chunk.subarray(0, n));
      total += n;
    }
    return total > MAX_BYTES ? 'too large' : Buffer.concat(chunks, total);
  } catch (err) {
    return fileError(err.code);
  } finally {
    fs.closeSync(fd);
  }
}

async function readStdinBytes() {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
      total += chunk.length;
      if (total > MAX_BYTES) return 'too large';
    }
  } catch {
    return 'cannot read';
  }
  return Buffer.concat(chunks, total);
}

// Depth of a parsed JSON value, computed without recursion.
function exceedsDepth(value, limit) {
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (depth > limit) return true;
    for (const child of Object.values(current)) stack.push([child, depth + 1]);
  }
  return false;
}

async function loadJson(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = arg === '-' ? await readStdinBytes() : readFileBytes(arg);
  if (typeof bytes === 'string') throw new CliError(`Error: ${name}: ${bytes}`, 1);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes);
  } catch {
    throw new CliError(`Error: ${name}: invalid UTF-8`, 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`Error: ${name}: invalid JSON`, 3);
  }
  if (exceedsDepth(value, MAX_DEPTH)) throw new CliError(`Error: ${name}: too deep`, 3);
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
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// A closed stdout (for example `| head`) ends the run quietly instead of crashing.
process.stdout.on('error', () => {
  process.exitCode = 1;
});

main(process.argv.slice(2)).catch((err) => {
  if (!(err instanceof CliError)) throw err;
  process.stderr.write(err.message + '\n');
  process.exitCode = err.exitCode;
});
