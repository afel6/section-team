// near-miss: depth check off by one (>= 1000 fails)
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;

class InputError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

// Reads chunks from a stream until it ends or holds more than MAX_BYTES.
async function readCapped(stream) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      total += chunk.length;
      if (total > MAX_BYTES) return null;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

function openFile(path) {
  try {
    return fs.openSync(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new InputError('no such file', 1);
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(path).isDirectory();
    } catch {
      // Fall through to "cannot read".
    }
    throw new InputError(isDirectory ? 'is a directory' : 'cannot read', 1);
  }
}

async function readInput(arg) {
  const isStdin = arg === '-';
  const fd = isStdin ? 0 : openFile(arg);
  let bytes;
  try {
    bytes = await readCapped(fs.createReadStream(null, { fd, autoClose: !isStdin }));
  } catch (err) {
    throw new InputError(err.code === 'EISDIR' && !isStdin ? 'is a directory' : 'cannot read', 1);
  }
  if (bytes === null) throw new InputError('too large', 1);
  return bytes;
}

// Depth of valid JSON text, counted without recursion.
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

async function loadJson(arg) {
  const bytes = await readInput(arg);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputError('invalid UTF-8', 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError('invalid JSON', 3);
  }
  if (jsonDepth(text) >= MAX_DEPTH) throw new InputError('too deep', 3);
  return value;
}

function fail(message, exitCode) {
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}

async function main(args) {
  const [patchArg, docArg = '-'] = args;
  if (args.length < 1 || args.length > 2 || (patchArg === '-' && docArg === '-')) {
    fail(USAGE, 2);
    return;
  }
  const inputs = [];
  for (const arg of [patchArg, docArg]) {
    try {
      inputs.push(await loadJson(arg));
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      fail(`Error: ${arg === '-' ? 'stdin' : arg}: ${err.message}`, err.exitCode);
      return;
    }
  }
  const [patch, doc] = inputs;
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (!(err instanceof PatchError)) throw err;
    fail(`Error: ${err.message}`, 4);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main(process.argv.slice(2));
