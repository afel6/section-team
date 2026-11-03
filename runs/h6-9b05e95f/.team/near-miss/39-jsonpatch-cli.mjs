// near-miss: file size checked via stat and read unlimited
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import { open, stat } from 'node:fs/promises';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const STDIN = '-';

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function readError(name, reason) {
  return new CliError(`Error: ${name}: ${reason}`, 1);
}

// Collects chunks from an async iterable, stopping once the byte limit is passed.
async function collect(chunks, name) {
  const parts = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > MAX_BYTES) throw readError(name, 'too large');
    parts.push(chunk);
  }
  return Buffer.concat(parts, total);
}

async function* fileChunks(handle) {
  const buffer = Buffer.alloc(65536);
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) return;
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readFile(path) {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw readError(path, 'no such file');
    if (err.code === 'EISDIR' || (await isDirectory(path))) throw readError(path, 'is a directory');
    throw readError(path, 'cannot read');
  }
  try {
    const info = await handle.stat();
    if (info.isDirectory()) throw readError(path, 'is a directory');
    if (info.size > MAX_BYTES) throw readError(path, 'too large');
    return Buffer.concat(await Array.fromAsync(fileChunks(handle)));
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError(path, err.code === 'EISDIR' ? 'is a directory' : 'cannot read');
  } finally {
    await handle.close().catch(() => {});
  }
}

async function readStdin() {
  try {
    return await collect(process.stdin, 'stdin');
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError('stdin', 'cannot read');
  } finally {
    process.stdin.destroy();
  }
}

function depthExceeds(value, limit) {
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (depth + 1 > limit) return true;
    for (const item of Object.values(current)) stack.push([item, depth + 1]);
  }
  return false;
}

async function loadJson(arg) {
  const name = arg === STDIN ? 'stdin' : arg;
  const bytes = arg === STDIN ? await readStdin() : await readFile(arg);
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
  if (depthExceeds(value, MAX_DEPTH)) throw new CliError(`Error: ${name}: too deep`, 3);
  return value;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const [patchArg, docArg = STDIN] = args;
  if (patchArg === STDIN && docArg === STDIN) throw new CliError(USAGE, 2);
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
