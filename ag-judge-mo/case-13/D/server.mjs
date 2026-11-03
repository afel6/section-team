// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const MAX_BODY_BYTES = 10000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const JSON_TYPE = 'application/json; charset=utf-8';
const PAGE_FILES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
});
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const BOOKINGS_PREFIX = '/api/bookings/';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- field validation (shared by requests and the data file) ----------

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
  return typeof value === 'string' && value.length >= 1 && value.length <= 80;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function overlaps(a, b) {
  return a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;
}

// ---------- data file ----------

function isStoredBooking(b, nextId) {
  if (!isPlainObject(b)) return false;
  const keys = Object.keys(b);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => Object.hasOwn(b, k))) return false;
  return Number.isSafeInteger(b.id) && b.id >= 1 && b.id < nextId
    && ROOMS.includes(b.room)
    && isValidTitle(b.title) && b.title === b.title.trim()
    && isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.end > b.start;
}

function hasConflicts(bookings) {
  const ids = new Set(bookings.map((b) => b.id));
  if (ids.size !== bookings.length) return true;
  return bookings.some((a, i) => bookings.slice(i + 1).some((b) => overlaps(a, b)));
}

function parseStore(text) {
  const data = JSON.parse(text);
  const valid = isPlainObject(data)
    && Object.keys(data).length === 2
    && Number.isSafeInteger(data.nextId) && data.nextId >= 1
    && Array.isArray(data.bookings)
    && data.bookings.every((b) => isStoredBooking(b, data.nextId))
    && !hasConflicts(data.bookings);
  if (!valid) throw new Error('invalid data layout');
  return Object.freeze({ nextId: data.nextId, bookings: Object.freeze(data.bookings.map((b) => Object.freeze({ ...b }))) });
}

async function loadStore(filePath) {
  try {
    return parseStore(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return Object.freeze({ nextId: 1, bookings: Object.freeze([]) });
    throw err;
  }
}

function serializeStore(store) {
  return `${JSON.stringify({ nextId: store.nextId, bookings: store.bookings }, null, 2)}\n`;
}

// ---------- request helpers ----------

function readBody(req, keep) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (keep && received <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => resolve({ received, buffer: Buffer.concat(chunks) }));
    req.on('error', reject);
  });
}

function mediaType(header) {
  if (typeof header !== 'string') return null;
  const semi = header.indexOf(';');
  const raw = semi === -1 ? header : header.slice(0, semi);
  return raw.replace(/^[ \t]+|[ \t]+$/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- booking validation ----------

function parseBookingBody(req, received, buffer) {
  if (mediaType(req.headers['content-type']) !== 'application/json') {
    throw new HttpError(415, 'content type must be application/json');
  }
  if (received > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  let body;
  try {
    body = JSON.parse(buffer.toString('utf8'));
  } catch {
    body = null;
  }
  if (!isPlainObject(body)) throw new HttpError(400, 'body must be a JSON object');
  return body;
}

function validateBooking(body) {
  const field = (key) => (Object.hasOwn(body, key) ? body[key] : undefined);
  const room = field('room');
  if (typeof room !== 'string' || !ROOMS.includes(room)) {
    throw new HttpError(400, `room must be one of ${ROOMS.join(', ')}`);
  }
  const rawTitle = field('title');
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : rawTitle;
  if (!isValidTitle(title)) throw new HttpError(400, 'title must be 1 to 80 characters');
  const date = field('date');
  if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  const start = field('start');
  if (!isValidTime(start)) throw new HttpError(400, 'start must be HH:MM');
  const end = field('end');
  if (!isValidTime(end)) throw new HttpError(400, 'end must be HH:MM');
  if (end <= start) throw new HttpError(400, 'end must be after start');
  return { room, title, date, start, end };
}

// ---------- app ----------

function createApp(initialStore, dataPath) {
  let store = initialStore;
  let queue = Promise.resolve();

  // Runs mutations one at a time; a failed task does not block later ones.
  function serialize(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  async function commit(next) {
    try {
      await writeFile(dataPath, serializeStore(next));
    } catch {
      throw new HttpError(500, 'internal error');
    }
    store = next;
  }

  function createBooking(fields) {
    return serialize(async () => {
      const clash = store.bookings
        .filter((b) => overlaps(b, fields))
        .sort((a, b) => (a.start < b.start ? -1 : 1))[0];
      if (clash) throw new HttpError(409, `room is already booked from ${clash.start} to ${clash.end}`);
      const booking = Object.freeze({ id: store.nextId, ...fields });
      await commit(Object.freeze({ nextId: store.nextId + 1, bookings: Object.freeze([...store.bookings, booking]) }));
      return booking;
    });
  }

  function deleteBooking(idText) {
    return serialize(async () => {
      const found = /^[1-9][0-9]*$/.test(idText) && store.bookings.some((b) => String(b.id) === idText);
      if (!found) throw new HttpError(404, 'booking not found');
      const bookings = Object.freeze(store.bookings.filter((b) => String(b.id) !== idText));
      await commit(Object.freeze({ nextId: store.nextId, bookings }));
    });
  }

  function listBookings(query) {
    const params = new URLSearchParams(query);
    let list = store.bookings;
    if (params.has('date')) {
      const date = params.get('date');
      if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
      list = list.filter((b) => b.date === date);
    }
    return [...list].sort(compareBookings);
  }

  async function servePage(res, page) {
    const content = await readFile(path.join(PUBLIC_DIR, page.file));
    res.writeHead(200, { 'Content-Type': page.type, 'Content-Length': content.length });
    res.end(content);
  }

  async function route(req, res) {
    const target = req.url;
    const q = target.indexOf('?');
    const pathname = q === -1 ? target : target.slice(0, q);
    const query = q === -1 ? '' : target.slice(q + 1);
    const method = req.method;
    const isPost = pathname === '/api/bookings' && method === 'POST';
    const { received, buffer } = await readBody(req, isPost);

    if (Object.hasOwn(PAGE_FILES, pathname)) {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      return servePage(res, PAGE_FILES[pathname]);
    }
    if (pathname === '/api/rooms') {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      return sendJson(res, 200, { rooms: ROOMS });
    }
    if (pathname === '/api/bookings') {
      if (method === 'GET') return sendJson(res, 200, { bookings: listBookings(query) });
      if (!isPost) throw new HttpError(405, 'method not allowed');
      const fields = validateBooking(parseBookingBody(req, received, buffer));
      return sendJson(res, 201, await createBooking(fields));
    }
    if (pathname.startsWith(BOOKINGS_PREFIX)) {
      const idText = pathname.slice(BOOKINGS_PREFIX.length);
      if (idText === '' || idText.includes('/')) throw new HttpError(404, 'not found');
      if (method !== 'DELETE') throw new HttpError(405, 'method not allowed');
      await deleteBooking(idText);
      res.writeHead(204);
      return res.end();
    }
    throw new HttpError(404, 'not found');
  }

  return async function handle(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) sendError(res, err.status, err.message);
      else sendError(res, 500, 'internal error');
    }
  };
}

// ---------- startup ----------

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parsePort(raw) {
  if (raw === undefined || raw === '') return 3000;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= 65535 ? port : null;
}

async function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) return fail(`invalid PORT ${process.env.PORT}`);

  const dataName = process.env.DATA_FILE || 'bookings.json';
  const dataPath = path.resolve(process.cwd(), dataName);
  let store;
  try {
    store = await loadStore(dataPath);
  } catch {
    return fail(`cannot read data file ${dataName}`);
  }

  const server = http.createServer(createApp(store, dataPath));
  server.on('error', (err) => fail(`cannot listen on port ${port}: ${err.code || 'error'}`));
  server.listen(port, HOST, () => {
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

main();
