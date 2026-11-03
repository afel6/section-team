// near-miss: body of exactly 10000 bytes rejected (>= instead of >)
// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
// Node.js built-ins only. Run with `node server.mjs`.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_FILE = 'bookings.json';
const MAX_BODY_BYTES = 10000;
const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const JSON_TYPE = 'application/json; charset=utf-8';
const BOOKINGS_PREFIX = '/api/bookings/';
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const STATIC_FILES = Object.freeze({
  '/': { url: new URL('./public/index.html', import.meta.url), type: 'text/html; charset=utf-8' },
  '/app.js': { url: new URL('./public/app.js', import.meta.url), type: 'text/javascript; charset=utf-8' },
});

const MSG = Object.freeze({
  notFound: 'not found',
  method: 'method not allowed',
  internal: 'internal error',
  bookingNotFound: 'booking not found',
  contentType: 'content type must be application/json',
  tooLarge: 'body too large',
  notObject: 'body must be a JSON object',
  room: `room must be one of ${ROOMS.join(', ')}`,
  title: 'title must be 1 to 80 characters',
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

// ---------- field validation (pure) ----------

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const febDays = year % 4 === 0 ? 29 : 28;
  const monthDays = [31, febDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function isValidTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

function isValidTitle(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Applies booking rules 4-9 in order; returns the cleaned fields or throws HttpError 400. */
function validateBookingInput(body) {
  if (typeof body.room !== 'string' || !ROOMS.includes(body.room)) throw new HttpError(400, MSG.room);
  const title = typeof body.title === 'string' ? body.title.trim() : undefined;
  if (!isValidTitle(title)) throw new HttpError(400, MSG.title);
  if (!isValidDate(body.date)) throw new HttpError(400, MSG.date);
  if (!isValidTime(body.start)) throw new HttpError(400, MSG.start);
  if (!isValidTime(body.end)) throw new HttpError(400, MSG.end);
  if (!(body.end > body.start)) throw new HttpError(400, MSG.order);
  return { room: body.room, title, date: body.date, start: body.start, end: body.end };
}

function overlaps(a, b) {
  return a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;
}

function findEarliestOverlap(bookings, candidate) {
  return bookings
    .filter((b) => overlaps(b, candidate))
    .reduce((earliest, b) => (earliest === null || b.start < earliest.start ? b : earliest), null);
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  const byRoom = ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
  return byRoom !== 0 ? byRoom : a.id - b.id;
}

// ---------- data file ----------

function isStoredBooking(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => keys.includes(k))) return false;
  return Number.isSafeInteger(value.id) && value.id >= 1
    && ROOMS.includes(value.room)
    && isValidTitle(value.title) && value.title === value.title.trim()
    && isValidDate(value.date) && isValidTime(value.start) && isValidTime(value.end)
    && value.end > value.start;
}

/** True when `data` is exactly the layout this server writes: {nextId, bookings}. */
function isValidStore(data) {
  if (!isPlainObject(data)) return false;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !keys.includes('nextId') || !keys.includes('bookings')) return false;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return false;
  if (!bookings.every(isStoredBooking)) return false;
  const ids = new Set(bookings.map((b) => b.id));
  if (ids.size !== bookings.length || bookings.some((b) => b.id >= nextId)) return false;
  return bookings.every((b, i) => bookings.every((other, j) => i === j || !overlaps(b, other)));
}

function freezeStore(store) {
  return Object.freeze({
    nextId: store.nextId,
    bookings: Object.freeze(store.bookings.map((b) => Object.freeze({ ...b }))),
  });
}

/** Reads the data file synchronously at startup. Returns the store, or null when unreadable. */
function loadStore(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return freezeStore({ nextId: 1, bookings: [] });
    return null;
  }
  try {
    const data = JSON.parse(text);
    return isValidStore(data) ? freezeStore(data) : null;
  } catch {
    return null; // invalid JSON is reported by the caller as "cannot read data file"
  }
}

// ---------- state + serialized saves ----------

function createRepository(filePath, initialStore) {
  let store = initialStore;
  let queue = Promise.resolve();

  /** Runs `change(store)` -> next store (or an HttpError), saves it, then commits it. One at a time. */
  function mutate(change) {
    const run = queue.then(async () => {
      const next = freezeStore(change(store));
      await writeFile(filePath, JSON.stringify(next));
      store = next;
      return next;
    });
    queue = run.catch(() => undefined); // keep the chain alive; the caller handles `run`'s rejection
    return run;
  }

  return { current: () => store, mutate };
}

// ---------- HTTP helpers ----------

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': body.length });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

/** Reads the whole request body; keeps at most `limit` bytes but counts every byte received. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => resolve({ size, buffer: size <= limit ? Buffer.concat(chunks) : null }));
    req.on('error', reject);
  });
}

function mediaTypeIsJson(header) {
  if (typeof header !== 'string') return false;
  const media = header.split(';', 1)[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return media.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'application/json';
}

function parseObjectBody(buffer) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    return isPlainObject(value) ? value : null;
  } catch {
    return null; // not JSON: rule 3 reply is decided by the caller
  }
}

// ---------- route handlers ----------

function listBookings(repo, query) {
  const params = new URLSearchParams(query);
  const all = repo.current().bookings;
  if (!params.has('date')) return [...all].sort(compareBookings);
  const date = params.get('date');
  if (!isValidDate(date)) throw new HttpError(400, MSG.date);
  return all.filter((b) => b.date === date).sort(compareBookings);
}

async function createBooking(repo, req, body) {
  if (!mediaTypeIsJson(req.headers['content-type'])) throw new HttpError(415, MSG.contentType);
  if (body.size >= MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);
  const parsed = parseObjectBody(body.buffer);
  if (parsed === null) throw new HttpError(400, MSG.notObject);
  const fields = validateBookingInput(parsed);
  const next = await repo.mutate((store) => {
    const clash = findEarliestOverlap(store.bookings, fields);
    if (clash) throw new HttpError(409, `room is already booked from ${clash.start} to ${clash.end}`);
    return { nextId: store.nextId + 1, bookings: [...store.bookings, { id: store.nextId, ...fields }] };
  });
  return next.bookings.at(-1);
}

const bookingNotFound = () => new HttpError(404, MSG.bookingNotFound);

async function deleteBooking(repo, idText) {
  if (!/^[1-9][0-9]*$/.test(idText)) throw bookingNotFound();
  await repo.mutate((store) => {
    const remaining = store.bookings.filter((b) => String(b.id) !== idText);
    if (remaining.length === store.bookings.length) throw bookingNotFound();
    return { nextId: store.nextId, bookings: remaining };
  });
}

async function serveStatic(res, file) {
  const content = await readFile(file.url);
  res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': content.length });
  res.end(content);
}

// ---------- routing ----------

function splitTarget(target) {
  const at = target.indexOf('?');
  return at === -1 ? { pathname: target, query: '' } : { pathname: target.slice(0, at), query: target.slice(at + 1) };
}

/** Maps a raw path to a route name and parameter; null when no route matches. */
function matchRoute(pathname) {
  if (pathname === '/api/rooms') return { name: 'rooms', methods: ['GET'] };
  if (pathname === '/api/bookings') return { name: 'bookings', methods: ['GET', 'POST'] };
  if (Object.hasOwn(STATIC_FILES, pathname)) return { name: 'static', methods: ['GET'] };
  if (pathname.startsWith(BOOKINGS_PREFIX)) {
    const id = pathname.slice(BOOKINGS_PREFIX.length);
    if (id !== '' && !id.includes('/')) return { name: 'booking', methods: ['DELETE'], id };
  }
  return null;
}

async function dispatch(repo, req, res, body) {
  const { pathname, query } = splitTarget(req.url);
  const route = matchRoute(pathname);
  if (route === null) throw new HttpError(404, MSG.notFound);
  if (!route.methods.includes(req.method)) throw new HttpError(405, MSG.method);
  if (route.name === 'rooms') return sendJson(res, 200, { rooms: ROOMS });
  if (route.name === 'static') return serveStatic(res, STATIC_FILES[pathname]);
  if (route.name === 'booking') {
    await deleteBooking(repo, route.id);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'GET') return sendJson(res, 200, { bookings: listBookings(repo, query) });
  return sendJson(res, 201, await createBooking(repo, req, body));
}

function createHandler(repo) {
  return async function handleRequest(req, res) {
    try {
      const body = await readBody(req, MAX_BODY_BYTES);
      await dispatch(repo, req, res, body);
    } catch (err) {
      replyWithError(res, err);
    }
  };
}

function replyWithError(res, err) {
  try {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return sendError(res, err.status, err.message);
    return sendError(res, 500, MSG.internal);
  } catch {
    return res.destroy(); // the reply itself failed; drop the connection rather than crash
  }
}

/** CONNECT bypasses the request handler; answer it on the raw socket (no route allows it). */
function handleConnect(req, socket) {
  const route = matchRoute(splitTarget(req.url).pathname);
  const [status, reason, message] = route === null
    ? [404, 'Not Found', MSG.notFound]
    : [405, 'Method Not Allowed', MSG.method];
  const body = Buffer.from(JSON.stringify({ error: message }), 'utf8');
  const head = `HTTP/1.1 ${status} ${reason}\r\nContent-Type: ${JSON_TYPE}\r\n`
    + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
  socket.on('error', () => socket.destroy()); // client went away; nothing left to answer
  socket.end(Buffer.concat([Buffer.from(head, 'latin1'), body]));
}

// ---------- startup ----------

function fail(line) {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= 65535 ? port : null;
}

function start() {
  const port = parsePort(process.env.PORT);
  if (port === null) fail(`invalid PORT ${JSON.stringify(process.env.PORT)}`);

  const dataName = process.env.DATA_FILE ? process.env.DATA_FILE : DEFAULT_DATA_FILE;
  const dataPath = path.resolve(process.cwd(), dataName);
  const store = loadStore(dataPath);
  if (store === null) fail(`cannot read data file ${dataName}`);

  const repo = createRepository(dataPath, store);
  const handler = createHandler(repo);
  const server = http.createServer({ requireHostHeader: false }, handler);
  server.on('checkExpectation', handler);
  server.on('connect', handleConnect);
  let listening = false;
  server.on('error', (err) => {
    if (!listening) fail(`cannot listen on port ${port}: ${err.code || 'error'}`);
    process.stderr.write(`server error: ${err.code || 'error'}\n`);
  });
  server.listen(port, HOST, () => {
    listening = true;
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

start();
