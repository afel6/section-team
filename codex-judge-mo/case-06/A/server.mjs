// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
// Node.js built-ins only. Startup order: PORT check -> data file read -> listen.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const MAX_BODY_BYTES = 10000;
const MAX_TITLE_LENGTH = 80;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const HOST = '127.0.0.1';
const JSON_TYPE = 'application/json; charset=utf-8';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PAGE_FILES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
});
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const BOOKINGS_PREFIX = '/api/bookings/';
const DATE_ERROR = 'date must be a valid YYYY-MM-DD date';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation helpers ----------

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

function ownField(object, key) {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function overlaps(a, b) {
  return a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;
}

// Rules 4-9: returns a new booking draft (without id) or throws HttpError 400.
function validateBookingFields(body) {
  const room = ownField(body, 'room');
  if (typeof room !== 'string' || !ROOMS.includes(room)) {
    throw new HttpError(400, 'room must be one of Aurora, Borealis, Cosmos');
  }
  const rawTitle = ownField(body, 'title');
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, 'title must be 1 to 80 characters');
  }
  const date = ownField(body, 'date');
  if (!isValidDate(date)) throw new HttpError(400, DATE_ERROR);
  const start = ownField(body, 'start');
  if (!isValidTime(start)) throw new HttpError(400, 'start must be HH:MM');
  const end = ownField(body, 'end');
  if (!isValidTime(end)) throw new HttpError(400, 'end must be HH:MM');
  if (end <= start) throw new HttpError(400, 'end must be after start');
  return { room, title, date, start, end };
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- data file ----------

function isValidStoredBooking(entry, nextId) {
  if (!isPlainObject(entry)) return false;
  const keys = Object.keys(entry);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => keys.includes(k))) return false;
  const { id, room, title, date, start, end } = entry;
  return Number.isSafeInteger(id) && id >= 1 && id < nextId
    && typeof room === 'string' && ROOMS.includes(room)
    && typeof title === 'string' && title === title.trim()
    && title.length >= 1 && title.length <= MAX_TITLE_LENGTH
    && isValidDate(date) && isValidTime(start) && isValidTime(end) && start < end;
}

// Returns a fresh state, or null when the data is not in this server's layout.
function parseState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !keys.includes('nextId') || !keys.includes('bookings')) return null;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return null;
  if (!bookings.every((b) => isValidStoredBooking(b, nextId))) return null;
  if (new Set(bookings.map((b) => b.id)).size !== bookings.length) return null;
  const clash = bookings.some((a, i) => bookings.some((b, j) => i < j && overlaps(a, b)));
  if (clash) return null;
  return Object.freeze({ nextId, bookings: Object.freeze(bookings.map((b) => Object.freeze({ ...b }))) });
}

function loadState(filePath) {
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return Object.freeze({ nextId: 1, bookings: Object.freeze([]) });
    return null;
  }
  return parseState(buffer.toString('utf8'));
}

// Writes a sibling temp file and renames it over the data file, so an
// interrupted save never leaves a truncated file behind.
async function saveState(filePath, state) {
  const payload = { nextId: state.nextId, bookings: state.bookings };
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined); // best-effort cleanup; the save error below is what matters
    throw error;
  }
}

// ---------- request / reply helpers ----------

// Reads the whole body; keeps at most MAX_BODY_BYTES + 1 bytes but counts all of them.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let kept = 0;
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (kept <= MAX_BODY_BYTES) {
        chunks.push(chunk);
        kept += chunk.length;
      }
    });
    req.on('end', () => resolve({ buffer: Buffer.concat(chunks), size: total }));
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': body.length });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function mediaTypeIsJson(header) {
  if (typeof header !== 'string') return false;
  const mediaType = header.split(';', 1)[0].replace(/^[ \t]+|[ \t]+$/g, '');
  // Fold ASCII letters only, on purpose: "letter case ignored" means A-Z here.
  return mediaType.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'application/json';
}

function parseJsonObject(buffer) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

// ---------- app ----------

function createApp(dataPath, initialState) {
  let state = initialState;
  let lock = Promise.resolve();

  // Runs mutations one at a time so concurrent requests behave as if sequential.
  function serialized(task) {
    const run = lock.then(task);
    lock = run.then(() => undefined, () => undefined);
    return run;
  }

  async function commit(nextState) {
    await saveState(dataPath, nextState);
    state = nextState;
  }

  function listBookings(res, query) {
    const params = new URLSearchParams(query);
    let bookings = state.bookings;
    if (params.has('date')) {
      const date = params.get('date');
      if (!isValidDate(date)) throw new HttpError(400, DATE_ERROR);
      bookings = bookings.filter((b) => b.date === date);
    }
    sendJson(res, 200, { bookings: [...bookings].sort(compareBookings) });
  }

  function createBooking(req, res, body) {
    if (!mediaTypeIsJson(req.headers['content-type'])) {
      throw new HttpError(415, 'content type must be application/json');
    }
    if (body.size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    const parsed = parseJsonObject(body.buffer);
    if (parsed === null) throw new HttpError(400, 'body must be a JSON object');
    const draft = validateBookingFields(parsed);
    return serialized(async () => {
      const clashes = state.bookings.filter((b) => overlaps(b, draft)).sort(compareBookings);
      if (clashes.length > 0) {
        throw new HttpError(409, `room is already booked from ${clashes[0].start} to ${clashes[0].end}`);
      }
      const booking = Object.freeze({ id: state.nextId, ...draft });
      await commit(Object.freeze({
        nextId: state.nextId + 1,
        bookings: Object.freeze([...state.bookings, booking]),
      }));
      sendJson(res, 201, booking);
    });
  }

  function deleteBooking(res, idText) {
    return serialized(async () => {
      const valid = /^[1-9][0-9]*$/.test(idText);
      const target = valid ? state.bookings.find((b) => String(b.id) === idText) : undefined;
      if (!target) throw new HttpError(404, 'booking not found');
      await commit(Object.freeze({
        nextId: state.nextId,
        bookings: Object.freeze(state.bookings.filter((b) => b !== target)),
      }));
      res.writeHead(204);
      res.end();
    });
  }

  async function servePage(res, page) {
    const content = await readFile(path.join(PUBLIC_DIR, page.file));
    res.writeHead(200, { 'Content-Type': page.type, 'Content-Length': content.length });
    res.end(content);
  }

  async function route(req, res, body) {
    const target = req.url;
    const cut = target.indexOf('?');
    const pathname = cut === -1 ? target : target.slice(0, cut);
    const query = cut === -1 ? '' : target.slice(cut + 1);
    const { method } = req;

    if (pathname === '/api/rooms') {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      return sendJson(res, 200, { rooms: [...ROOMS] });
    }
    if (pathname === '/api/bookings') {
      if (method === 'GET') return listBookings(res, query);
      if (method === 'POST') return createBooking(req, res, body);
      throw new HttpError(405, 'method not allowed');
    }
    if (pathname.startsWith(BOOKINGS_PREFIX)) {
      const idText = pathname.slice(BOOKINGS_PREFIX.length);
      if (idText === '' || idText.includes('/')) throw new HttpError(404, 'not found');
      if (method !== 'DELETE') throw new HttpError(405, 'method not allowed');
      return deleteBooking(res, idText);
    }
    if (Object.hasOwn(PAGE_FILES, pathname)) {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      return servePage(res, PAGE_FILES[pathname]);
    }
    throw new HttpError(404, 'not found');
  }

  return async function handle(req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch {
      // The client went away mid-body; there is nobody left to reply to.
      req.destroy();
      return;
    }
    try {
      await route(req, res, body);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) sendError(res, error.status, error.message);
      else sendError(res, 500, 'internal error');
    }
  };
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
  return port <= MAX_PORT ? port : null;
}

function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) fail(`invalid PORT ${JSON.stringify(process.env.PORT)}`);

  const dataName = process.env.DATA_FILE ? process.env.DATA_FILE : 'bookings.json';
  const dataPath = path.resolve(process.cwd(), dataName);
  const state = loadState(dataPath);
  if (state === null) fail(`cannot read data file ${dataName}`);

  const server = http.createServer(createApp(dataPath, state));
  server.on('error', (error) => fail(`cannot listen on port ${port}: ${error.code || 'error'}`));
  server.listen(port, HOST, () => {
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

main();
