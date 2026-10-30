// ini2json.mjs: convert an INI file to JSON. Usage: node ini2json.mjs <file>
import { readFileSync } from 'node:fs';

const USAGE = 'Usage: node ini2json.mjs <file>';
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const INTEGER = /^(?:0|-?[1-9][0-9]*)$/;
const QUOTED = /^"((?:[^"\\]|\\["\\])*)"$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const BAD_QUOTE = Symbol('bad quoted value');
const READ_REASONS = new Map([
  ['ENOENT', 'no such file'],
  ['EISDIR', 'is a directory'],
]);

// Null-prototype objects, so __proto__ and constructor are ordinary keys.
const newObject = () => Object.create(null);
const has = (obj, key) => Object.hasOwn(obj, key);

// Strips spaces and tabs only (String#trim would also eat \r, U+FEFF, NBSP...).
function trimBlank(text) {
  let start = 0;
  let end = text.length;
  while (start < end && (text[start] === ' ' || text[start] === '\t')) start++;
  while (end > start && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return text.slice(start, end);
}

function isSafeInteger(digits) {
  const n = BigInt(digits);
  return n >= -MAX_SAFE && n <= MAX_SAFE;
}

// Returns the typed value, or BAD_QUOTE for a broken quoted value.
function parseValue(text) {
  if (text.startsWith('"')) {
    const match = QUOTED.exec(text);
    return match ? match[1].replace(/\\(["\\])/g, '$1') : BAD_QUOTE;
  }
  const plain = trimBlank(text.split(/[;#]/, 1)[0]); // strip an inline comment
  if (plain === 'true' || plain === 'false') return plain === 'true';
  if (INTEGER.test(plain) && isSafeInteger(plain)) return Number(plain);
  return plain;
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
function readInput(file) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    return { error: `Error: ${file}: ${READ_REASONS.get(err?.code) ?? 'cannot read'}` };
  }
  return { text: new TextDecoder('utf-8').decode(bytes) };
}

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function main(args) {
  if (args.length !== 1) return fail(USAGE, 2);
  const input = readInput(args[0]);
  if (input.error !== undefined) return fail(input.error, 1);
  const parsed = parseIni(input.text);
  if (parsed.error !== undefined) return fail(`Error: ${parsed.error}`, 3);
  process.stdout.write(`${JSON.stringify(parsed.result, null, 2)}\n`);
  process.exitCode = 0;
}

main(process.argv.slice(2));
