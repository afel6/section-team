// near-miss: /api/bookings/1/ treated as the DELETE route
// Meeting-room booking server: JSON API, static page, one JSON data file.
// Node.js built-ins only.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_FILE = 'bookings.json';
const MAX_BODY_BYTES = 10000;
const JSON_TYPE = 'application/json; charset=utf-8';
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);
const BOOKINGS_PREFIX = '/api/bookings/';
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC_FILES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
});

const MSG = Object.freeze({
  internal: 'internal error',
  notFound: 'not found',
  method: 'method not allowed',
  bookingNotFound: 'booking not found',
  contentType: 'content type must be application/json',
  tooLarge: 'body too large',
  notObject: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
});

// ---------- validation helpers ----------

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function isValidDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isValidTime(value) {
  if (typeof value !== 'string' || !/^[0-9]{2}:[0-9]{2}$/.test(value)) return false;
  return Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59;
}

/** A title is valid when, trimmed, it holds 1 to 80 UTF-16 code units. */
function isValidTitle(value) {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= 1 && length <= 80;
}

const overlaps = (a, b) =>
  a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Returns an error message for the first failing field rule (4-9), or null. */
function fieldError(body) {
  if (!ROOMS.includes(body.room)) return MSG.room;
  if (!isValidTitle(body.title)) return MSG.title;
  if (!isValidDate(body.date)) return MSG.date;
  if (!isValidTime(body.start)) return MSG.start;
  if (!isValidTime(body.end)) return MSG.end;
  if (body.end <= body.start) return MSG.order;
  return null;
}

// ---------- data file ----------

function isStoredBooking(b, nextId) {
  if (!isPlainObject(b)) return false;
  const keys = Object.keys(b);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => Object.hasOwn(b, k))) {
    return false;
  }
  if (!Number.isSafeInteger(b.id) || b.id < 1 || b.id >= nextId) return false;
  if (!ROOMS.includes(b.room) || !isValidDate(b.date)) return false;
  if (!isValidTitle(b.title) || b.title !== b.title.trim()) return false;
  return isValidTime(b.start) && isValidTime(b.end) && b.start < b.end;
}

/** Strict check that `data` is exactly what this server writes. */
function isValidStore(data) {
  if (!isPlainObject(data)) return false;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !Object.hasOwn(data, 'nextId') || !Object.hasOwn(data, 'bookings')) {
    return false;
  }
  const { nextId, bookings } = data;
  // nextId must stay safe after one more booking, so a saved file always reloads.
  if (!Number.isSafeInteger(nextId + 1) || nextId < 1 || !Array.isArray(bookings)) return false;
  if (!bookings.every((b) => isStoredBooking(b, nextId))) return false;
  if (new Set(bookings.map((b) => b.id)).size !== bookings.length) return false;
  return bookings.every((b, i) => bookings.slice(i + 1).every((o) => !overlaps(b, o)));
}

const emptyStore = () => Object.freeze({ nextId: 1, bookings: Object.freeze([]) });

/** Resolves to the loaded store, or null when the file exists but is unusable. */
async function loadStore(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyStore();
    return null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isValidStore(data)) return null;
  return Object.freeze({
    nextId: data.nextId,
    bookings: Object.freeze(data.bookings.map((b) => Object.freeze({ ...b }))),
  });
}

const saveStore = (path, store) => writeFile(path, JSON.stringify(store));

// ---------- HTTP helpers ----------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const sendError = (res, status, message) => sendJson(res, status, { error: message });

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

/** Reads the whole body; keeps at most MAX_BODY_BYTES + 1 bytes, counts all of them. */
function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let kept = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (kept <= MAX_BODY_BYTES) {
        chunks.push(chunk);
        kept += chunk.length;
      }
    });
    req.on('end', () => resolveBody({ size, buffer: Buffer.concat(chunks) }));
    req.on('error', rejectBody);
    req.on('close', () => {
      if (!req.complete) rejectBody(new Error('request closed before its body was read'));
    });
  });
}

function mediaType(header) {
  if (typeof header !== 'string') return null;
  return header
    .split(';')[0]
    .replace(/^[ \t]+|[ \t]+$/g, '')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function parseObject(buffer) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

const compareByStart = (a, b) => compareText(a.start, b.start);

function compareBookings(a, b) {
  return (
    compareText(a.date, b.date) ||
    compareByStart(a, b) ||
    ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room) ||
    a.id - b.id
  );
}

// ---------- application ----------

/**
 * Holds the in-memory store (the source of truth after startup) and runs
 * mutations one at a time. `commit` saves first and only then replaces the
 * store, so a failed save changes nothing, the next id included.
 */
function createRepository(dataPath, initialStore) {
  let store = initialStore;
  let queue = Promise.resolve();
  return Object.freeze({
    current: () => store,
    // The returned promise carries the task's own result or error to the
    // caller; the chain only needs to settle so the next task can run.
    serialize(task) {
      const run = queue.then(task);
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async commit(next) {
      await saveStore(dataPath, next);
      store = next;
    },
  });
}

function listBookings(repo, res, query) {
  const params = new URLSearchParams(query);
  let bookings = repo.current().bookings;
  if (params.has('date')) {
    const date = params.get('date');
    if (!isValidDate(date)) return sendError(res, 400, MSG.date);
    bookings = bookings.filter((b) => b.date === date);
  }
  return sendJson(res, 200, { bookings: [...bookings].sort(compareBookings) });
}

/** Applies booking rules 1-9; returns the booking fields, or null after replying. */
function readBookingInput(req, res, body) {
  if (mediaType(req.headers['content-type']) !== 'application/json') {
    sendError(res, 415, MSG.contentType);
    return null;
  }
  if (body.size > MAX_BODY_BYTES) {
    sendError(res, 413, MSG.tooLarge);
    return null;
  }
  const input = parseObject(body.buffer);
  const invalid = input === null ? MSG.notObject : fieldError(input);
  if (invalid !== null) {
    sendError(res, 400, invalid);
    return null;
  }
  const { room, title, date, start, end } = input;
  return Object.freeze({ room, title: title.trim(), date, start, end });
}

function createBooking(repo, req, res, body) {
  const fields = readBookingInput(req, res, body);
  if (fields === null) return undefined;
  return repo.serialize(async () => {
    const store = repo.current();
    const [clash] = store.bookings.filter((b) => overlaps(b, fields)).sort(compareByStart);
    if (clash) {
      return sendError(res, 409, `room is already booked from ${clash.start} to ${clash.end}`);
    }
    const booking = Object.freeze({ id: store.nextId, ...fields });
    await repo.commit(
      Object.freeze({
        nextId: store.nextId + 1,
        bookings: Object.freeze([...store.bookings, booking]),
      }),
    );
    return sendJson(res, 201, booking);
  });
}

function deleteBooking(repo, res, idText) {
  return repo.serialize(async () => {
    const store = repo.current();
    const found =
      /^[1-9][0-9]*$/.test(idText) && store.bookings.some((b) => String(b.id) === idText);
    if (!found) return sendError(res, 404, MSG.bookingNotFound);
    await repo.commit(
      Object.freeze({
        nextId: store.nextId,
        bookings: Object.freeze(store.bookings.filter((b) => String(b.id) !== idText)),
      }),
    );
    return sendNoContent(res);
  });
}

async function serveStatic(res, entry) {
  const content = await readFile(join(PUBLIC_DIR, entry.file));
  res.writeHead(200, { 'Content-Type': entry.type, 'Content-Length': content.length });
  res.end(content);
}

/** Splits the raw request target at the first `?`; nothing is decoded. */
function splitTarget(target) {
  const qIndex = target.indexOf('?');
  return qIndex === -1
    ? { path: target, query: '' }
    : { path: target.slice(0, qIndex), query: target.slice(qIndex + 1) };
}

function route(repo, req, res, body) {
  const { path, query } = splitTarget(req.url ?? '');
  const { method } = req;
  const notAllowed = () => sendError(res, 405, MSG.method);

  if (path === '/api/rooms') {
    return method === 'GET' ? sendJson(res, 200, { rooms: [...ROOMS] }) : notAllowed();
  }
  if (path === '/api/bookings') {
    if (method === 'GET') return listBookings(repo, res, query);
    if (method === 'POST') return createBooking(repo, req, res, body);
    return notAllowed();
  }
  if (path.startsWith(BOOKINGS_PREFIX)) {
    const idText = path.slice(BOOKINGS_PREFIX.length);
    if (idText === '') return sendError(res, 404, MSG.notFound);
    return method === 'DELETE' ? deleteBooking(repo, res, idText) : notAllowed();
  }
  if (Object.hasOwn(STATIC_FILES, path)) {
    return method === 'GET' ? serveStatic(res, STATIC_FILES[path]) : notAllowed();
  }
  return sendError(res, 404, MSG.notFound);
}

function replyInternalError(res) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendError(res, 500, MSG.internal);
}

function createHandler(repo) {
  return async function handle(req, res) {
    try {
      const body = await readBody(req);
      await route(repo, req, res, body);
    } catch (err) {
      // Any unexpected failure (save error, unreadable page, broken request)
      // becomes a generic 500; the cause goes to stderr, never to the client.
      reportServerError(err);
      replyInternalError(res);
    }
  };
}

// ---------- startup ----------

function fail(line) {
  process.stderr.write(`${line}\n`, () => process.exit(1));
}

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= 65535 ? port : null;
}

async function main() {
  const port = parsePort(process.env.PORT);
  // JSON.stringify keeps a value holding line breaks on one stderr line.
  if (port === null) return fail(`invalid PORT ${JSON.stringify(process.env.PORT)}`);

  const dataName = process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const dataPath = resolve(process.cwd(), dataName);
  const store = await loadStore(dataPath);
  if (store === null) return fail(`cannot read data file ${dataName}`);

  const handle = createHandler(createRepository(dataPath, store));
  const server = createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  const onListenError = (err) => fail(`cannot listen on ${HOST}:${port}: ${err.code ?? 'error'}`);
  server.once('error', onListenError);
  server.listen(port, HOST, () => {
    server.off('error', onListenError);
    server.on('error', reportServerError);
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
  return undefined;
}

/** A failure after startup is reported on stderr; the server keeps running. */
function reportServerError(err) {
  process.stderr.write(`server error: ${err?.code ?? err?.message ?? 'unknown'}\n`);
}

main().catch(() => fail('server failed to start'));
