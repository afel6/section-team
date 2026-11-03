import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const MAX_BODY_BYTES = 10000;
const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_FILE = 'bookings.json';
const JSON_TYPE = 'application/json; charset=utf-8';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC_FILES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
});
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const DATA_KEYS = Object.freeze(['bookings', 'nextId']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation ----------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const febDays = year % 4 === 0 ? 29 : 28;
  const monthDays = [31, febDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function isValidTime(value) {
  if (typeof value !== 'string' || !/^[0-9]{2}:[0-9]{2}$/.test(value)) return false;
  return Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59;
}

function isValidTitle(value) {
  if (typeof value !== 'string') return false;
  const { length } = value.trim();
  return length >= 1 && length <= 80;
}

/** Applies booking rules 4-9 to a parsed body; returns the normalised fields. */
function validateFields(body) {
  if (typeof body.room !== 'string' || !ROOMS.includes(body.room)) {
    throw new HttpError(400, 'room must be one of Aurora, Borealis, Cosmos');
  }
  if (!isValidTitle(body.title)) throw new HttpError(400, 'title must be 1 to 80 characters');
  if (!isValidDate(body.date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  if (!isValidTime(body.start)) throw new HttpError(400, 'start must be HH:MM');
  if (!isValidTime(body.end)) throw new HttpError(400, 'end must be HH:MM');
  if (body.end <= body.start) throw new HttpError(400, 'end must be after start');
  return { room: body.room, title: body.title.trim(), date: body.date, start: body.start, end: body.end };
}

function hasExactKeys(obj, keys) {
  const own = Object.keys(obj).sort();
  return own.length === keys.length && own.every((key, i) => key === keys[i]);
}

function isStoredBooking(b) {
  return isPlainObject(b) && hasExactKeys(b, [...BOOKING_KEYS].sort())
    && Number.isSafeInteger(b.id) && b.id >= 1
    && ROOMS.includes(b.room) && isValidTitle(b.title) && b.title === b.title.trim()
    && isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.end > b.start;
}

function findOverlaps(bookings, candidate) {
  return bookings.filter((b) => b.room === candidate.room && b.date === candidate.date
    && b.start < candidate.end && candidate.start < b.end);
}

/** Returns the stored state if `data` is exactly the layout this server writes, else null. */
function parseStoredData(data) {
  if (!isPlainObject(data) || !hasExactKeys(data, DATA_KEYS)) return null;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return null;
  const seen = new Set();
  for (const [index, b] of bookings.entries()) {
    if (!isStoredBooking(b) || b.id >= nextId || seen.has(b.id)) return null;
    if (findOverlaps(bookings.slice(0, index), b).length > 0) return null;
    seen.add(b.id);
  }
  return { nextId, bookings: bookings.map((b) => ({ ...b })) };
}

// ---------- storage ----------

function createStore(filePath, initial) {
  let state = initial;
  let queue = Promise.resolve();

  async function save(next) {
    await writeFile(filePath, JSON.stringify(next));
    state = next;
  }

  /** Runs mutations one at a time so concurrent requests see a consistent state. */
  function serialize(task) {
    const result = queue.then(() => task(state, save));
    queue = result.catch(() => {});
    return result;
  }

  return { get: () => state, serialize };
}

async function loadState(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { nextId: 1, bookings: [] };
    return null;
  }
  try {
    return parseStoredData(JSON.parse(text));
  } catch {
    return null;
  }
}

// ---------- HTTP helpers ----------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

/** Reads the whole body; keeps at most MAX_BODY_BYTES + 1 bytes and counts the rest. */
async function readBody(req) {
  const chunks = [];
  let kept = 0;
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (kept <= MAX_BODY_BYTES) {
      const piece = chunk.subarray(0, MAX_BODY_BYTES + 1 - kept);
      chunks.push(piece);
      kept += piece.length;
    }
  }
  return { buffer: Buffer.concat(chunks), total };
}

function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  const media = header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return media.toLowerCase() === 'application/json';
}

function compareText(key) {
  return (a, b) => {
    if (a[key] === b[key]) return 0;
    return a[key] < b[key] ? -1 : 1;
  };
}

const byDate = compareText('date');
const byStart = compareText('start');

function compareBookings(a, b) {
  return byDate(a, b) || byStart(a, b) || ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- handlers ----------

function listBookings(store, query, res) {
  const params = new URLSearchParams(query);
  const date = params.has('date') ? params.get('date') : null;
  if (date !== null && !isValidDate(date)) {
    throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  }
  const bookings = store.get().bookings.filter((b) => date === null || b.date === date);
  sendJson(res, 200, { bookings: bookings.sort(compareBookings) });
}

function parseBookingBody(req, body) {
  if (!isJsonContentType(req.headers['content-type'])) {
    throw new HttpError(415, 'content type must be application/json');
  }
  if (body.total > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  let parsed;
  try {
    parsed = JSON.parse(body.buffer.toString('utf8'));
  } catch {
    parsed = undefined;
  }
  if (!isPlainObject(parsed)) throw new HttpError(400, 'body must be a JSON object');
  return validateFields(parsed);
}

async function createBooking(store, req, body, res) {
  const fields = parseBookingBody(req, body);
  const booking = await store.serialize(async (state, save) => {
    const overlaps = findOverlaps(state.bookings, fields).sort(compareText('start'));
    if (overlaps.length > 0) {
      throw new HttpError(409, `room is already booked from ${overlaps[0].start} to ${overlaps[0].end}`);
    }
    const created = { id: state.nextId, ...fields };
    await save({ nextId: state.nextId + 1, bookings: [...state.bookings, created] });
    return created;
  });
  sendJson(res, 201, booking);
}

async function deleteBooking(store, idText, res) {
  if (!/^[1-9][0-9]*$/.test(idText)) throw new HttpError(404, 'booking not found');
  await store.serialize(async (state, save) => {
    const remaining = state.bookings.filter((b) => String(b.id) !== idText);
    if (remaining.length === state.bookings.length) throw new HttpError(404, 'booking not found');
    await save({ nextId: state.nextId, bookings: remaining });
  });
  res.writeHead(204);
  res.end();
}

async function serveStatic(entry, res) {
  const content = await readFile(path.join(PUBLIC_DIR, entry.file));
  res.writeHead(200, { 'Content-Type': entry.type, 'Content-Length': content.length });
  res.end(content);
}

const BOOKING_PREFIX = '/api/bookings/';

/** Dispatches by exact path bytes and method; throws 404/405 when no route matches. */
async function route(store, req, res, body) {
  const target = req.url;
  const q = target.indexOf('?');
  const pathname = q === -1 ? target : target.slice(0, q);
  const query = q === -1 ? '' : target.slice(q + 1);
  const { method } = req;
  const expect = (allowed) => {
    if (!allowed.includes(method)) throw new HttpError(405, 'method not allowed');
  };
  if (Object.hasOwn(STATIC_FILES, pathname)) {
    expect(['GET']);
    return serveStatic(STATIC_FILES[pathname], res);
  }
  if (pathname === '/api/rooms') {
    expect(['GET']);
    return sendJson(res, 200, { rooms: [...ROOMS] });
  }
  if (pathname === '/api/bookings') {
    expect(['GET', 'POST']);
    return method === 'GET' ? listBookings(store, query, res) : createBooking(store, req, body, res);
  }
  const rest = pathname.startsWith(BOOKING_PREFIX) ? pathname.slice(BOOKING_PREFIX.length) : '';
  if (rest !== '' && !rest.includes('/')) {
    expect(['DELETE']);
    return deleteBooking(store, rest, res);
  }
  throw new HttpError(404, 'not found');
}

function createHandler(store) {
  return async (req, res) => {
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.destroy();
      return;
    }
    try {
      await route(store, req, res, body);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
      } else if (err instanceof HttpError) {
        sendError(res, err.status, err.message);
      } else {
        sendError(res, 500, 'internal error');
      }
    }
  };
}

// ---------- startup ----------

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= 65535 ? port : null;
}

function fail(line) {
  process.stderr.write(`${line}\n`);
  process.exitCode = 1;
}

async function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) return fail('invalid PORT');

  const dataName = process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const dataPath = path.resolve(process.cwd(), dataName);
  const initial = await loadState(dataPath);
  if (initial === null) return fail(`cannot read data file ${dataName}`);

  const store = createStore(dataPath, initial);
  const server = http.createServer(createHandler(store));
  server.on('error', (err) => {
    const reason = err && err.code === 'EADDRINUSE' ? 'is already in use' : 'cannot be used';
    fail(`port ${port} ${reason}`);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

main().catch(() => {
  fail('server failed to start');
  process.exit(1);
});
