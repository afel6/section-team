// near-miss: 413 checked before 415
// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
// Node.js built-ins only. Run with `node server.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const DEFAULT_DATA_FILE = 'bookings.json';
const MAX_BODY_BYTES = 10000;
const MAX_TITLE_LENGTH = 80;
const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const JSON_TYPE = 'application/json; charset=utf-8';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC_FILES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
});
const BOOKING_PREFIX = '/api/bookings/';

const MSG = Object.freeze({
  notFound: 'not found',
  methodNotAllowed: 'method not allowed',
  internal: 'internal error',
  bookingNotFound: 'booking not found',
  contentType: 'content type must be application/json',
  tooLarge: 'body too large',
  notObject: 'body must be a JSON object',
  room: `room must be one of ${ROOMS.join(', ')}`,
  title: `title must be 1 to ${MAX_TITLE_LENGTH} characters`,
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation ----------

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 2000 || year > 2099 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function isValidTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(body, key) {
  return Object.hasOwn(body, key) ? body[key] : undefined;
}

/** Applies booking rules 4-9; returns the normalised fields or throws HttpError 400. */
function validateFields(body) {
  const room = field(body, 'room');
  if (typeof room !== 'string' || !ROOMS.includes(room)) throw new HttpError(400, MSG.room);
  const rawTitle = field(body, 'title');
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : null;
  if (title === null || title.length < 1 || title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, MSG.title);
  }
  const date = field(body, 'date');
  if (!isValidDate(date)) throw new HttpError(400, MSG.date);
  const start = field(body, 'start');
  if (!isValidTime(start)) throw new HttpError(400, MSG.start);
  const end = field(body, 'end');
  if (!isValidTime(end)) throw new HttpError(400, MSG.end);
  if (!(end > start)) throw new HttpError(400, MSG.order);
  return { room, title, date, start, end };
}

function findOverlap(bookings, candidate) {
  const clashes = bookings.filter((b) => b.room === candidate.room && b.date === candidate.date
    && b.start < candidate.end && candidate.start < b.end);
  return clashes.reduce((first, b) => (first === null || b.start < first.start ? b : first), null);
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- data file ----------

const STATE_KEYS = Object.freeze(['nextId', 'bookings']);

function hasExactKeys(obj, expected) {
  const keys = Object.keys(obj);
  return keys.length === expected.length && expected.every((k) => keys.includes(k));
}

function isStoredBooking(b, nextId) {
  if (!isPlainObject(b) || !hasExactKeys(b, BOOKING_KEYS)) return false;
  if (!Number.isSafeInteger(b.id) || b.id < 1 || b.id >= nextId) return false;
  try {
    const fields = validateFields(b);
    return fields.title === b.title;
  } catch (err) {
    if (err instanceof HttpError) return false;
    throw err;
  }
}

/** Returns a frozen state or null when the content is not in this server's layout. */
function parseState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null; // invalid JSON is reported by the caller as an unreadable data file
  }
  if (!isPlainObject(data) || !hasExactKeys(data, STATE_KEYS)) return null;
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) return null;
  if (!Array.isArray(data.bookings)) return null;
  if (!data.bookings.every((b) => isStoredBooking(b, data.nextId))) return null;
  if (new Set(data.bookings.map((b) => b.id)).size !== data.bookings.length) return null;
  const clash = data.bookings.some((b, i) => findOverlap(data.bookings.slice(0, i), b) !== null);
  if (clash) return null;
  return freezeState({ nextId: data.nextId, bookings: data.bookings });
}

function freezeState({ nextId, bookings }) {
  return Object.freeze({ nextId, bookings: Object.freeze(bookings.map((b) => Object.freeze({ ...b }))) });
}

/** Reads the data file once; returns the state or null when it cannot be used. */
function loadState(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return freezeState({ nextId: 1, bookings: [] });
    return null;
  }
  return parseState(text);
}

let tempCounter = 0;

async function saveState(filePath, state) {
  tempCounter += 1;
  const tempPath = `${filePath}.${process.pid}.${tempCounter}.tmp`;
  const json = JSON.stringify({ nextId: state.nextId, bookings: state.bookings });
  try {
    await fsp.writeFile(tempPath, json, { flag: 'wx' });
    await fsp.rename(tempPath, filePath);
  } catch (err) {
    await fsp.rm(tempPath, { force: true }).catch((rmErr) => logError('temp cleanup failed', rmErr));
    throw err;
  }
}

// ---------- HTTP plumbing ----------

function logError(context, err) {
  process.stderr.write(`${context}: ${err && err.message ? err.message : String(err)}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => resolve({ size, buffer: size <= MAX_BODY_BYTES ? Buffer.concat(chunks) : null }));
    req.on('error', reject);
  });
}

function send(res, status, body, type = JSON_TYPE) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendError(res, status, message) {
  send(res, status, { error: message });
}

function mediaType(header) {
  if (typeof header !== 'string') return null;
  return header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
}

function parseJsonObject(buffer) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    return isPlainObject(value) ? value : null;
  } catch {
    return null; // any parse failure means the body is not a JSON object (rule 3)
  }
}

// ---------- app ----------

function createApp(dataPath, initialState) {
  let state = initialState;
  let queue = Promise.resolve();

  /** Runs mutations one at a time so concurrent requests behave sequentially. */
  function serialize(task) {
    const run = queue.then(task);
    queue = run.catch(() => undefined); // the failure is handled by the caller awaiting `run`
    return run;
  }

  async function commit(nextState) {
    const frozen = freezeState(nextState);
    await saveState(dataPath, frozen);
    state = frozen;
  }

  function listBookings(query) {
    const params = new URLSearchParams(query);
    let bookings = [...state.bookings];
    if (params.has('date')) {
      const date = params.get('date');
      if (!isValidDate(date)) throw new HttpError(400, MSG.date);
      bookings = bookings.filter((b) => b.date === date);
    }
    return { bookings: bookings.sort(compareBookings) };
  }

  function createBooking(req, body) {
    if (body.size > MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);
    if (mediaType(req.headers['content-type']) !== 'application/json') {
      throw new HttpError(415, MSG.contentType);
    }
    const parsed = parseJsonObject(body.buffer);
    if (parsed === null) throw new HttpError(400, MSG.notObject);
    const fields = validateFields(parsed);
    return serialize(async () => {
      const clash = findOverlap(state.bookings, fields);
      if (clash) throw new HttpError(409, `room is already booked from ${clash.start} to ${clash.end}`);
      const booking = { id: state.nextId, ...fields };
      await commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] });
      return booking;
    });
  }

  function deleteBooking(idText) {
    return serialize(async () => {
      const id = /^[1-9][0-9]*$/.test(idText) ? Number(idText) : NaN;
      if (!state.bookings.some((b) => b.id === id)) throw new HttpError(404, MSG.bookingNotFound);
      await commit({ nextId: state.nextId, bookings: state.bookings.filter((b) => b.id !== id) });
    });
  }

  async function serveStatic(res, entry) {
    const content = await fsp.readFile(path.join(PUBLIC_DIR, entry.file));
    send(res, 200, content, entry.type);
  }

  /** Resolves the route for a raw path; returns null when the path is unknown. */
  function route(pathName, query, req, body, res) {
    if (pathName === '/api/rooms') return { GET: () => send(res, 200, { rooms: ROOMS }) };
    if (pathName === '/api/bookings') {
      return {
        GET: () => send(res, 200, listBookings(query)),
        POST: async () => send(res, 201, await createBooking(req, body)),
      };
    }
    if (pathName.startsWith(BOOKING_PREFIX)) {
      const id = pathName.slice(BOOKING_PREFIX.length);
      if (id === '' || id.includes('/')) return null;
      return { DELETE: async () => { await deleteBooking(id); send(res, 204); } };
    }
    if (Object.hasOwn(STATIC_FILES, pathName)) {
      return { GET: () => serveStatic(res, STATIC_FILES[pathName]) };
    }
    return null;
  }

  async function handle(req, res) {
    const body = await readBody(req);
    const target = req.url;
    const queryStart = target.indexOf('?');
    const pathName = queryStart === -1 ? target : target.slice(0, queryStart);
    const query = queryStart === -1 ? '' : target.slice(queryStart + 1);
    const handlers = route(pathName, query, req, body, res);
    if (handlers === null) return sendError(res, 404, MSG.notFound);
    if (!Object.hasOwn(handlers, req.method)) return sendError(res, 405, MSG.methodNotAllowed);
    return handlers[req.method]();
  }

  return async function onRequest(req, res) {
    try {
      await handle(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(res, err.status, err.message);
        return;
      }
      logError('request failed', err);
      if (!res.headersSent) sendError(res, 500, MSG.internal);
      else res.destroy();
    }
  };
}

// ---------- startup ----------

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= MAX_PORT ? port : null;
}

/** Writes one stderr line and lets the process exit with code 1 (nothing else keeps it alive). */
function failStartup(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) return failStartup(`invalid PORT: ${JSON.stringify(process.env.PORT)}`);
  const dataName = process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const dataPath = path.resolve(process.cwd(), dataName);
  const state = loadState(dataPath);
  if (state === null) return failStartup(`cannot read data file ${dataName}`);
  const server = http.createServer(createApp(dataPath, state));
  server.on('error', (err) => failStartup(`cannot listen on ${HOST}:${port}: ${err.code || err.message}`));
  server.listen(port, HOST, () => {
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

main();
