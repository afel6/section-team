// ini2json.mjs: convert an INI file to JSON. Usage: node ini2json.mjs <file>
import { readFileSync } from 'node:fs';

const USAGE = 'Usage: node ini2json.mjs <file>';
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const INTEGER = /^(?:0|-?[1-9][0-9]*)$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const BAD_QUOTE = Symbol('bad quoted value');
const READ_REASONS = new Map([
  ['ENOENT', 'no such file'],
  ['ENOTDIR', 'no such file'], // a path through a regular file, e.g. a.ini/x on POSIX
  ['EISDIR', 'is a directory'],
]);

// Null-prototype objects, so __proto__ and constructor are ordinary keys.
const newObject = () => Object.create(null);
const has = (obj, key) => Object.hasOwn(obj, key);

// Strips the whitespace around a line or field.
function trimBlank(text) {
  return text.trim();
}

function isSafeInteger(digits) {
  const n = BigInt(digits);
  return n >= -MAX_SAFE && n <= MAX_SAFE;
}

// A loop, not a regex: a backtracking regex overflows the stack on a 10M-character value.
// Returns the unescaped inner text, or BAD_QUOTE.
function parseQuoted(text) {
  if (text.length < 2 || !text.endsWith('"')) return BAD_QUOTE;
  const inner = text.slice(1, -1);
  const parts = [];
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '"') return BAD_QUOTE;
    if (inner[i] !== '\\') continue;
    const next = inner[i + 1];
    if (next !== '"' && next !== '\\') return BAD_QUOTE; // undefined: the closing quote was escaped
    parts.push(inner.slice(start, i));
    start = i + 1; // the escaped character opens the next run
    i++;
  }
  parts.push(inner.slice(start));
  return parts.join('');
}

// Returns the typed value, or BAD_QUOTE for a broken quoted value.
function parseValue(text) {
  if (text.startsWith('"')) return parseQuoted(text);
  if (text === 'true' || text === 'false') return text === 'true';
  if (INTEGER.test(text) && isSafeInteger(text)) return Number(text);
  return text;
}

// Each apply* returns an error reason, or null when the line was accepted.
function applyHeader(line, state) {
  const name = line.endsWith(']') ? trimBlank(line.slice(1, -1)) : '';
  if (!NAME.test(name)) return 'bad section name';
  if (!state.sections.has(name)) {
    if (has(state.result, name)) return `conflict ${name}`;
    state.sections.set(name, newObject());
    state.result[name] = state.sections.get(name);
  }
  state.current = state.sections.get(name);
  return null;
}

function applyEntry(line, state) {
  const eq = line.indexOf('=');
  if (eq === -1) return 'missing =';
  const key = trimBlank(line.slice(0, eq));
  if (!NAME.test(key)) return 'bad key';
  const value = parseValue(trimBlank(line.slice(eq + 1)));
  if (value === BAD_QUOTE) return 'bad quoted value';
  const target = state.current ?? state.result;
  if (has(target, key)) return `duplicate key ${key}`;
  target[key] = value;
  return null;
}

function parseIni(text) {
  const state = { result: newObject(), sections: new Map(), current: null };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = trimBlank(lines[i]);
    if (line === '' || line[0] === ';' || line[0] === '#') continue;
    const reason = line[0] === '[' ? applyHeader(line, state) : applyEntry(line, state);
    if (reason !== null) return { error: `line ${i + 1}: ${reason}` };
  }
  return { result: state.result };
}

// Default TextDecoder drops a leading BOM and turns invalid bytes into U+FFFD.
// Decoding is inside the try: a file too big for one string (ERR_STRING_TOO_LONG) is "cannot read".
function readInput(file) {
  try {
    return { text: new TextDecoder('utf-8').decode(readFileSync(file)) };
  } catch (err) {
    return { error: `${file}: ${READ_REASONS.get(err?.code) ?? 'cannot read'}` };
  }
}

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function main(args) {
  if (args.length !== 1) return fail(USAGE, 2);
  const input = readInput(args[0]);
  if (input.error !== undefined) return fail(`Error: ${input.error}`, 1);
  const parsed = parseIni(input.text);
  if (parsed.error !== undefined) return fail(`Error: ${parsed.error}`, 3);
  // A reader that closed the pipe early (`| head`) is not an error; any other write failure is one plain line.
  process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') fail('Error: cannot write output', 1); });
  // ponytail: output over V8's string limit (~512 MB of JSON) still throws RangeError; the spec defines no message for it.
  process.stdout.write(`${JSON.stringify(parsed.result, null, 2)}\n`);
  process.exitCode = 0;
}

main(process.argv.slice(2));
