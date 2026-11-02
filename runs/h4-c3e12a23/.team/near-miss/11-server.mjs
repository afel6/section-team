// near-miss: DELETE id parsed with Number()
// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
// Node built-ins only. Run with `node server.mjs`.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const MAX_BODY_BYTES = 10000;
const MAX_TITLE_LENGTH = 80;
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const BOOKINGS_PATH = '/api/bookings';
const BOOKING_ITEM_PREFIX = '/api/bookings/';
const JSON_TYPE = 'application/json; charset=utf-8';
const PAGE_FILES = Object.freeze({
  '/': { url: new URL('./public/index.html', import.meta.url), type: 'text/html; charset=utf-8' },
  '/app.js': { url: new URL('./public/app.js', import.meta.url), type: 'text/javascript; charset=utf-8' },
});

const MSG = Object.freeze({
  contentType: 'content type must be application/json',
  tooLarge: 'body too large',
  notObject: 'body must be a JSON object',
  room: `room must be one of ${ROOMS.join(', ')}`,
  title: `title must be 1 to ${MAX_TITLE_LENGTH} characters`,
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
  bookingNotFound: 'booking not found',
  notFound: 'not found',
  method: 'method not allowed',
  internal: 'internal error',
});

/** Thrown by a POST rule; carries the reply status and message. */
class RuleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- field validation ----------

function isValidDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isValidTime(value) {
  if (typeof value !== 'string' || !/^[0-9]{2}:[0-9]{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours <= 23 && minutes <= 59;
}

function isValidTitle(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_TITLE_LENGTH;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(object, keys) {
  const own = Object.keys(object);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(object, key));
}

function ownField(object, key) {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function findOverlap(bookings, { room, date, start, end }) {
  return bookings
    .filter((b) => b.room === room && b.date === date && b.start < end && start < b.end)
    .reduce((earliest, b) => (earliest === undefined || b.start < earliest.start ? b : earliest), undefined);
}

// ---------- data file ----------

function isStoredBooking(value, nextId) {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, BOOKING_KEYS) &&
    Number.isSafeInteger(value.id) && value.id >= 1 && value.id < nextId &&
    ROOMS.includes(value.room) &&
    isValidTitle(value.title) && value.title === value.title.trim() &&
    isValidDate(value.date) && isValidTime(value.start) && isValidTime(value.end) &&
    value.start < value.end
  );
}

function isValidState(data) {
  if (!isPlainObject(data) || !hasExactKeys(data, ['nextId', 'bookings'])) return false;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return false;
  if (!bookings.every((b) => isStoredBooking(b, nextId))) return false;
  if (new Set(bookings.map((b) => b.id)).size !== bookings.length) return false;
  return bookings.every((b, i) => findOverlap(bookings.slice(0, i), b) === undefined);
}

/** Returns the stored state, an empty state on ENOENT, or null when the file is unusable. */
function loadState(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { nextId: 1, bookings: [] };
    return null;
  }
  try {
    const data = JSON.parse(text);
    return isValidState(data) ? data : null;
  } catch {
    return null;
  }
}

function saveState(path, state) {
  return writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
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

/** Reads the whole body; keeps at most MAX_BODY_BYTES but counts every byte received. */
function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      if (received + chunk.length <= MAX_BODY_BYTES) chunks.push(chunk);
      received += chunk.length;
    });
    req.on('end', () => resolveBody({ size: received, buffer: Buffer.concat(chunks) }));
    req.on('error', rejectBody);
    req.on('close', () => {
      if (!req.complete) rejectBody(new Error('request aborted'));
    });
  });
}

function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  const media = header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return media.toLowerCase() === 'application/json';
}

// ---------- booking logic ----------

function sortBookings(bookings) {
  const key = (b) => [b.date, b.start, ROOMS.indexOf(b.room)];
  return [...bookings].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    const index = ka.findIndex((value, i) => value !== kb[i]);
    if (index === -1) return 0;
    return ka[index] < kb[index] ? -1 : 1;
  });
}

function parseBookingRequest(headers, body, bookings) {
  if (!isJsonContentType(headers['content-type'])) throw new RuleError(415, MSG.contentType);
  if (body.size > MAX_BODY_BYTES) throw new RuleError(413, MSG.tooLarge);
  let data;
  try {
    data = JSON.parse(body.buffer.toString('utf8'));
  } catch {
    throw new RuleError(400, MSG.notObject);
  }
  if (!isPlainObject(data)) throw new RuleError(400, MSG.notObject);
  const [room, rawTitle, date, start, end] = ['room', 'title', 'date', 'start', 'end'].map((k) => ownField(data, k));
  if (typeof room !== 'string' || !ROOMS.includes(room)) throw new RuleError(400, MSG.room);
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : undefined;
  if (!isValidTitle(title)) throw new RuleError(400, MSG.title);
  if (!isValidDate(date)) throw new RuleError(400, MSG.date);
  if (!isValidTime(start)) throw new RuleError(400, MSG.start);
  if (!isValidTime(end)) throw new RuleError(400, MSG.end);
  if (end <= start) throw new RuleError(400, MSG.order);
  const clash = findOverlap(bookings, { room, date, start, end });
  if (clash) throw new RuleError(409, `room is already booked from ${clash.start} to ${clash.end}`);
  return { room, title, date, start, end };
}

// ---------- route handlers ----------

function createHandlers(store) {
  function listBookings(res, query) {
    const params = new URLSearchParams(query);
    const all = store.get().bookings;
    if (!params.has('date')) return sendJson(res, 200, { bookings: sortBookings(all) });
    const date = params.get('date');
    if (!isValidDate(date)) return sendError(res, 400, MSG.date);
    return sendJson(res, 200, { bookings: sortBookings(all.filter((b) => b.date === date)) });
  }

  async function createBooking(req, res, body) {
    const state = store.get();
    let fields;
    try {
      fields = parseBookingRequest(req.headers, body, state.bookings);
    } catch (error) {
      if (error instanceof RuleError) return sendError(res, error.status, error.message);
      throw error;
    }
    const booking = { id: state.nextId, ...fields };
    await store.commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] });
    return sendJson(res, 201, booking);
  }

  async function deleteBooking(res, idText) {
    const state = store.get();
    const target = idText !== ''
      ? state.bookings.find((b) => b.id === Number(idText))
      : undefined;
    if (!target) return sendError(res, 404, MSG.bookingNotFound);
    await store.commit({ ...state, bookings: state.bookings.filter((b) => b !== target) });
    res.writeHead(204);
    return res.end();
  }

  async function servePage(res, page) {
    const content = await readFile(page.url);
    res.writeHead(200, { 'Content-Type': page.type, 'Content-Length': content.length });
    res.end(content);
  }

  return { listBookings, createBooking, deleteBooking, servePage };
}

function isBookingItemPath(path) {
  if (!path.startsWith(BOOKING_ITEM_PREFIX)) return false;
  const rest = path.slice(BOOKING_ITEM_PREFIX.length);
  return rest.length > 0 && !rest.includes('/');
}

/** Splits a raw request target at the first `?`, with no decoding or normalisation. */
function splitTarget(target) {
  const mark = target.indexOf('?');
  if (mark === -1) return { path: target, query: '' };
  return { path: target.slice(0, mark), query: target.slice(mark + 1) };
}

function isKnownPath(path) {
  return path === '/api/rooms' || path === BOOKINGS_PATH || isBookingItemPath(path) || Object.hasOwn(PAGE_FILES, path);
}

/**
 * CONNECT never reaches the request listener, so it is answered here on the raw socket:
 * 405 on a known path, 404 otherwise. Any data after the headers is discarded.
 */
function answerConnect(req, socket) {
  socket.on('error', (error) => process.stderr.write(`connect socket error: ${error.code ?? 'unknown'}\n`));
  const known = isKnownPath(splitTarget(req.url).path);
  const [status, reason, message] = known ? [405, 'Method Not Allowed', MSG.method] : [404, 'Not Found', MSG.notFound];
  const body = JSON.stringify({ error: message });
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: ${JSON_TYPE}\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

/** Picks the handler for a request; returns a function producing the reply. */
function route(handlers, req, res, body) {
  const target = req.url;
  const { path, query } = splitTarget(target);
  const { method } = req;
  const only = (allowed, run) => () => (method === allowed ? run() : sendError(res, 405, MSG.method));

  if (path === '/api/rooms') return only('GET', () => sendJson(res, 200, { rooms: ROOMS }));
  if (path === BOOKINGS_PATH) {
    if (method === 'POST') return () => handlers.createBooking(req, res, body);
    return only('GET', () => handlers.listBookings(res, query));
  }
  if (isBookingItemPath(path)) {
    return only('DELETE', () => handlers.deleteBooking(res, path.slice(BOOKING_ITEM_PREFIX.length)));
  }
  if (Object.hasOwn(PAGE_FILES, path)) return only('GET', () => handlers.servePage(res, PAGE_FILES[path]));
  return () => sendError(res, 404, MSG.notFound);
}

// ---------- server ----------

/** Runs tasks one at a time, in arrival order. */
function createQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    // The caller handles run's failure; the tail only needs to settle so the next task can start.
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

function createStore(path, initial) {
  let state = initial;
  return {
    get: () => state,
    async commit(next) {
      await saveState(path, next);
      state = next;
    },
  };
}

function createRequestListener(store) {
  const handlers = createHandlers(store);
  const enqueue = createQueue();
  return async (req, res) => {
    let body;
    try {
      body = await readBody(req);
    } catch {
      req.destroy();
      return;
    }
    try {
      await enqueue(() => route(handlers, req, res, body)());
    } catch (error) {
      process.stderr.write(`internal error: ${error?.code ?? error?.name ?? 'unknown'}\n`);
      if (!res.headersSent) sendError(res, 500, MSG.internal);
      else res.destroy();
    }
  };
}

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= MAX_PORT ? port : null;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) return fail(`invalid PORT ${JSON.stringify(process.env.PORT)}`);
  const dataName = process.env.DATA_FILE || 'bookings.json';
  const dataPath = resolve(process.cwd(), dataName);
  const initial = loadState(dataPath);
  if (initial === null) return fail(`cannot read data file ${dataName}`);

  const listener = createRequestListener(createStore(dataPath, initial));
  const server = createServer(listener);
  // Unknown Expect values go to the normal route instead of Node's automatic 417.
  server.on('checkExpectation', listener);
  server.on('connect', answerConnect);
  const onBindError = (error) => fail(`cannot listen on port ${port}: ${error.code ?? 'unknown error'}`);
  server.once('error', onBindError);
  server.listen(port, HOST, () => {
    server.off('error', onBindError);
    server.on('error', (error) => process.stderr.write(`server error: ${error.code ?? 'unknown'}\n`));
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
  return undefined;
}

main();
