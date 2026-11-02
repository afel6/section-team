// Meeting-room booking server: JSON API, static page, one JSON data file.
// Only Node.js built-ins. Request handling after the body is read is fully
// synchronous (including the save), so requests are handled one at a time.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const MAX_BODY = 10000;
const JSON_TYPE = 'application/json; charset=utf-8';
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const BOOKINGS_PREFIX = '/api/bookings/';
const STATIC_FILES = Object.freeze({
  '/': { url: new URL('./public/index.html', import.meta.url), type: 'text/html; charset=utf-8' },
  '/app.js': { url: new URL('./public/app.js', import.meta.url), type: 'text/javascript; charset=utf-8' },
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation helpers ----------

const isString = (v) => typeof v === 'string';

function isValidDate(value) {
  if (!isString(value) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

const isValidTime = (value) => isString(value) && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);

function isValidTitle(value) {
  if (!isString(value)) return false;
  const { length } = value.trim();
  return length >= 1 && length <= 80;
}

const overlaps = (a, b) => a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;

const ownValue = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj, keys) {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

// ---------- data file ----------

function isStoredBooking(b, nextId) {
  return isPlainObject(b) && hasExactKeys(b, BOOKING_KEYS)
    && Number.isSafeInteger(b.id) && b.id >= 1 && b.id < nextId
    && ROOMS.includes(b.room) && isValidTitle(b.title) && b.title === b.title.trim()
    && isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.start < b.end;
}

function isValidState(data) {
  if (!isPlainObject(data) || !hasExactKeys(data, ['nextId', 'bookings'])) return false;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return false;
  if (!bookings.every((b) => isStoredBooking(b, nextId))) return false;
  if (new Set(bookings.map((b) => b.id)).size !== bookings.length) return false;
  return bookings.every((b, i) => bookings.every((o, j) => i === j || !overlaps(b, o)));
}

/** Returns the loaded state, or null when the file cannot be used. */
function loadState(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { nextId: 1, bookings: [] };
    return null;
  }
  try {
    const data = JSON.parse(text);
    return isValidState(data) ? { nextId: data.nextId, bookings: data.bookings } : null;
  } catch {
    return null;
  }
}

// Writes the file without creating folders; throws on failure.
function saveState(filePath, state) {
  fs.writeFileSync(filePath, JSON.stringify(state));
}

// ---------- routing ----------

function splitTarget(target) {
  const q = target.indexOf('?');
  return q === -1 ? { path: target, query: null } : { path: target.slice(0, q), query: target.slice(q + 1) };
}

/** Returns { handler, params } or throws HttpError 404/405. */
function route(method, pathname, routes) {
  if (Object.hasOwn(routes, pathname)) {
    const handler = routes[pathname][method];
    if (!handler) throw new HttpError(405, 'method not allowed');
    return { handler, id: null };
  }
  if (pathname.startsWith(BOOKINGS_PREFIX)) {
    const id = pathname.slice(BOOKINGS_PREFIX.length);
    if (id.length > 0 && !id.includes('/')) {
      if (method !== 'DELETE') throw new HttpError(405, 'method not allowed');
      return { handler: 'deleteBooking', id };
    }
  }
  throw new HttpError(404, 'not found');
}

const ROUTES = Object.freeze({
  '/api/rooms': { GET: 'listRooms' },
  '/api/bookings': { GET: 'listBookings', POST: 'createBooking' },
  '/': { GET: 'static' },
  '/app.js': { GET: 'static' },
});

// ---------- handlers ----------

function sortBookings(bookings) {
  const byText = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return [...bookings].sort((a, b) => byText(a.date, b.date)
    || byText(a.start, b.start)
    || ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room));
}

function listBookings(state, query) {
  const params = new URLSearchParams(query ?? '');
  if (!params.has('date')) return { status: 200, body: { bookings: sortBookings(state.bookings) } };
  const date = params.get('date');
  if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  return { status: 200, body: { bookings: sortBookings(state.bookings.filter((b) => b.date === date)) } };
}

function checkContentType(header) {
  const media = isString(header) ? header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase() : '';
  if (media !== 'application/json') throw new HttpError(415, 'content type must be application/json');
}

function parseBookingInput(body) {
  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'body must be a JSON object');
  }
  if (!isPlainObject(data)) throw new HttpError(400, 'body must be a JSON object');
  const [room, title, date, start, end] = ['room', 'title', 'date', 'start', 'end'].map((k) => ownValue(data, k));
  if (!isString(room) || !ROOMS.includes(room)) throw new HttpError(400, 'room must be one of Aurora, Borealis, Cosmos');
  if (!isValidTitle(title)) throw new HttpError(400, 'title must be 1 to 80 characters');
  if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  if (!isValidTime(start)) throw new HttpError(400, 'start must be HH:MM');
  if (!isValidTime(end)) throw new HttpError(400, 'end must be HH:MM');
  if (end <= start) throw new HttpError(400, 'end must be after start');
  return { room, title: title.trim(), date, start, end };
}

function createBooking(store, req, body) {
  checkContentType(req.headers['content-type']);
  if (body.tooLarge) throw new HttpError(413, 'body too large');
  const input = parseBookingInput(body.data);
  const state = store.state;
  const clash = state.bookings.filter((b) => overlaps(b, input))
    .reduce((first, b) => (first === null || b.start < first.start ? b : first), null);
  if (clash) throw new HttpError(409, `room is already booked from ${clash.start} to ${clash.end}`);
  const booking = { id: state.nextId, ...input };
  store.commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] });
  return { status: 201, body: booking };
}

function deleteBooking(store, id) {
  const state = store.state;
  const found = /^[1-9][0-9]*$/.test(id) && state.bookings.some((b) => String(b.id) === id);
  if (!found) throw new HttpError(404, 'booking not found');
  store.commit({ nextId: state.nextId, bookings: state.bookings.filter((b) => String(b.id) !== id) });
  return { status: 204, body: null };
}

// ---------- HTTP plumbing ----------

function sendJson(res, status, body) {
  if (body === null) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': payload.length });
  res.end(payload);
}

function sendStatic(res, pathname) {
  const file = STATIC_FILES[pathname];
  fs.readFile(file.url, (err, data) => {
    if (err) {
      sendJson(res, 500, { error: 'internal error' });
      return;
    }
    res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': data.length });
    res.end(data);
  });
}

// Reads the whole body; keeps at most MAX_BODY bytes and counts every byte received.
function readBody(req, onDone) {
  const chunks = [];
  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received <= MAX_BODY) chunks.push(chunk);
  });
  req.on('end', () => onDone({ tooLarge: received > MAX_BODY, data: received > MAX_BODY ? null : Buffer.concat(chunks) }));
  req.on('error', () => req.destroy());
}

function dispatch(store, req, res, body) {
  const { path: pathname, query } = splitTarget(req.url);
  const { handler, id } = route(req.method, pathname, ROUTES);
  switch (handler) {
    case 'static': return sendStatic(res, pathname);
    case 'listRooms': return sendJson(res, 200, { rooms: [...ROOMS] });
    case 'listBookings': return send(res, listBookings(store.state, query));
    case 'createBooking': return send(res, createBooking(store, req, body));
    case 'deleteBooking': return send(res, deleteBooking(store, id));
    default: throw new Error('unknown handler');
  }
}

const send = (res, result) => sendJson(res, result.status, result.body);

function handleRequest(store, req, res) {
  readBody(req, (body) => {
    try {
      dispatch(store, req, res, body);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'internal error';
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.destroy();
    }
  });
}

/** Holds the in-memory state; commit saves first and only then swaps state. */
function createStore(filePath, initial) {
  let state = initial;
  return {
    get state() { return state; },
    commit(next) {
      saveState(filePath, next);
      state = next;
    },
  };
}

// ---------- startup ----------

function parsePort(raw) {
  if (raw === undefined || raw === '') return 3000;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= 65535 ? port : null;
}

function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) {
    // Fixed text: echoing the raw value could add line breaks to the one stderr line.
    process.stderr.write('invalid PORT: must be digits 0-9 with a value up to 65535\n');
    process.exitCode = 1;
    return;
  }
  const name = process.env.DATA_FILE || 'bookings.json';
  const filePath = path.resolve(process.cwd(), name);
  const initial = loadState(filePath);
  if (initial === null) {
    process.stderr.write(`cannot read data file ${name}\n`);
    process.exitCode = 1;
    return;
  }
  const store = createStore(filePath, initial);
  const server = http.createServer((req, res) => handleRequest(store, req, res));
  // Only listen failures (e.g. EADDRINUSE) reach here; request errors are handled per request.
  server.once('error', (err) => {
    process.stderr.write(`cannot listen on port ${port}: ${err.code ?? 'error'}\n`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`);
  });
}

main();
