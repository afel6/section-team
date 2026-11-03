// Meeting-room booking server: JSON API, browser page, one JSON data file.
// Node.js built-ins only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const MAX_BODY_BYTES = 10000;
const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const JSON_TYPE = 'application/json; charset=utf-8';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PAGES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
});
const DELETE_ROUTE = /^\/api\/bookings\/[^/]+$/;
const ID_PATTERN = /^[1-9][0-9]*$/;
const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_PATTERN = /^([0-9]{2}):([0-9]{2})$/;

const MSG = Object.freeze({
  contentType: 'content type must be application/json',
  tooLarge: 'body too large',
  notObject: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
  bookingNotFound: 'booking not found',
  notFound: 'not found',
  method: 'method not allowed',
  internal: 'internal error',
});

/** Thrown for a request that must get a specific error reply. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

// ---------- field validation (shared by the API and the data-file check) ----------

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const febDays = year % 4 === 0 ? 29 : 28;
  const monthDays = [31, febDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

function isValidTime(value) {
  if (typeof value !== 'string') return false;
  const match = TIME_PATTERN.exec(value);
  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function isValidTitle(value) {
  if (typeof value !== 'string') return false;
  const { length } = value.trim();
  return length >= 1 && length <= 80;
}

const overlaps = (a, b) =>
  a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;

/** Rules 4-9 on a parsed body; returns the new booking fields or throws HttpError. */
function validateFields(body) {
  if (typeof body.room !== 'string' || !ROOMS.includes(body.room)) throw new HttpError(400, MSG.room);
  if (!isValidTitle(body.title)) throw new HttpError(400, MSG.title);
  if (!isValidDate(body.date)) throw new HttpError(400, MSG.date);
  if (!isValidTime(body.start)) throw new HttpError(400, MSG.start);
  if (!isValidTime(body.end)) throw new HttpError(400, MSG.end);
  if (!(body.end > body.start)) throw new HttpError(400, MSG.order);
  return { room: body.room, title: body.title.trim(), date: body.date, start: body.start, end: body.end };
}

// ---------- data file ----------

const emptyState = () => Object.freeze({ nextId: 1, bookings: Object.freeze([]) });

function isStoredBooking(b) {
  if (!isPlainObject(b)) return false;
  const keys = Object.keys(b);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => keys.includes(k))) return false;
  return Number.isSafeInteger(b.id) && b.id >= 1 && ROOMS.includes(b.room)
    && isValidTitle(b.title) && b.title === b.title.trim()
    && isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.end > b.start;
}

/** Strict check that `data` is exactly the layout this server writes. */
function isValidLayout(data) {
  if (!isPlainObject(data)) return false;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !keys.includes('nextId') || !keys.includes('bookings')) return false;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return false;
  if (!bookings.every(isStoredBooking)) return false;
  const ids = new Set(bookings.map((b) => b.id));
  if (ids.size !== bookings.length || bookings.some((b) => b.id >= nextId)) return false;
  return !bookings.some((b, i) => bookings.slice(i + 1).some((other) => overlaps(b, other)));
}

/** Reads the data file once; returns the state or null when it cannot be used. */
function loadState(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? emptyState() : null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isValidLayout(data)) return null;
  return Object.freeze({ nextId: data.nextId, bookings: Object.freeze(data.bookings.map((b) => Object.freeze({ ...b }))) });
}

/** Writes a temp file beside the data file, then renames it over, so a failed save leaves the old file intact. */
async function saveState(filePath, state) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify({ nextId: state.nextId, bookings: state.bookings }));
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {}); // best-effort cleanup; the save error below is what matters
    throw err;
  }
}

// ---------- request plumbing ----------

/** Reads the whole body; keeps at most MAX_BODY_BYTES + 1 bytes but counts every byte received. */
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
    req.on('aborted', () => reject(new Error('request aborted')));
  });
}

function send(res, status, payload) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const sendError = (res, status, message) => send(res, status, { error: message });

function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  const media = header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return media.toLowerCase() === 'application/json';
}

function parseObjectBody(buffer) {
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new HttpError(400, MSG.notObject);
  }
  if (!isPlainObject(parsed)) throw new HttpError(400, MSG.notObject);
  return parsed;
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- application ----------

function createApp(dataFile, initialState) {
  let state = initialState;

  function listBookings(query) {
    const params = new URLSearchParams(query);
    let bookings = state.bookings;
    if (params.has('date')) {
      const date = params.get('date');
      if (!isValidDate(date)) throw new HttpError(400, MSG.date);
      bookings = bookings.filter((b) => b.date === date);
    }
    return { status: 200, payload: { bookings: [...bookings].sort(compareBookings) } };
  }

  async function createBooking(req, body) {
    if (!isJsonContentType(req.headers['content-type'])) throw new HttpError(415, MSG.contentType);
    if (body.size > MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);
    const fields = validateFields(parseObjectBody(body.buffer));
    const clashes = state.bookings.filter((b) => overlaps(b, fields));
    if (clashes.length > 0) {
      const first = clashes.reduce((a, b) => (b.start < a.start ? b : a));
      throw new HttpError(409, `room is already booked from ${first.start} to ${first.end}`);
    }
    const booking = Object.freeze({ id: state.nextId, ...fields });
    await commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] });
    return { status: 201, payload: booking };
  }

  async function deleteBooking(rawId) {
    const id = ID_PATTERN.test(rawId) && Number.isSafeInteger(Number(rawId)) ? Number(rawId) : NaN;
    if (!state.bookings.some((b) => b.id === id)) throw new HttpError(404, MSG.bookingNotFound);
    await commit({ nextId: state.nextId, bookings: state.bookings.filter((b) => b.id !== id) });
    return { status: 204 };
  }

  /** Saves the candidate state first; memory changes only when the save succeeded. */
  async function commit(candidate) {
    const next = Object.freeze({ nextId: candidate.nextId, bookings: Object.freeze(candidate.bookings) });
    await saveState(dataFile, next);
    state = next;
  }

  return { listBookings, createBooking, deleteBooking };
}

async function servePage(page) {
  const content = await fs.promises.readFile(path.join(PUBLIC_DIR, page.file));
  return { status: 200, page: { type: page.type, content } };
}

function splitTarget(target) {
  const mark = target.indexOf('?');
  return mark === -1
    ? { pathname: target, query: '' }
    : { pathname: target.slice(0, mark), query: target.slice(mark + 1) };
}

function requireMethod(method, allowed) {
  if (method !== allowed) throw new HttpError(405, MSG.method);
}

/** Routes one request (body already read) to its result, or throws HttpError. */
async function route(app, req, body) {
  const { pathname, query } = splitTarget(req.url);
  const { method } = req;
  if (Object.hasOwn(PAGES, pathname)) {
    requireMethod(method, 'GET');
    return servePage(PAGES[pathname]);
  }
  if (pathname === '/api/rooms') {
    requireMethod(method, 'GET');
    return { status: 200, payload: { rooms: [...ROOMS] } };
  }
  if (pathname === '/api/bookings') {
    if (method === 'GET') return app.listBookings(query);
    if (method === 'POST') return app.createBooking(req, body);
    throw new HttpError(405, MSG.method);
  }
  if (DELETE_ROUTE.test(pathname)) {
    requireMethod(method, 'DELETE');
    return app.deleteBooking(pathname.slice('/api/bookings/'.length));
  }
  throw new HttpError(404, MSG.notFound);
}

function writeResult(res, result) {
  if (result.page) {
    res.writeHead(200, { 'Content-Type': result.page.type, 'Content-Length': result.page.content.length });
    res.end(result.page.content);
    return;
  }
  send(res, result.status, result.payload);
}

/** Logs an unexpected failure as one stderr line (stdout is reserved for the listening line). */
function logUnexpected(err) {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  process.stderr.write(`request failed: ${detail.replace(/\s+/g, ' ')}\n`);
}

function writeFailure(res, err) {
  if (!(err instanceof HttpError)) logUnexpected(err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) sendError(res, err.status, err.message);
  else sendError(res, 500, MSG.internal);
}

/** Serialises request handling so concurrent requests act as if handled one at a time. */
function createHandler(app) {
  let queue = Promise.resolve();
  return (req, res) => {
    // A failed write to a vanished client must not crash the server; nothing else to do.
    res.on('error', () => {});
    readBody(req).then(
      (body) => {
        queue = queue.then(() => route(app, req, body)
          .then((result) => writeResult(res, result), (err) => writeFailure(res, err))
          .catch((err) => {
            logUnexpected(err);
            res.destroy();
          }));
      },
      () => res.destroy(), // client aborted before sending its body: there is no one to reply to
    );
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
  const dataName = process.env.DATA_FILE || 'bookings.json';
  const dataFile = path.resolve(process.cwd(), dataName);
  const state = loadState(dataFile);
  if (state === null) fail(`cannot read data file ${dataName}`);

  const server = http.createServer(createHandler(createApp(dataFile, state)));
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  const onListenError = (err) => fail(`cannot listen on port ${port}: ${err.code || 'error'}`);
  server.once('error', onListenError);
  server.listen(port, HOST, () => {
    server.off('error', onListenError);
    server.on('error', logUnexpected);
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

main();
