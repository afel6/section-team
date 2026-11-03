// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
// Node.js built-ins only. Run: node server.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const MAX_BODY_BYTES = 10000;
const MAX_PORT = 65535;
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_FILE = 'bookings.json';
const JSON_TYPE = 'application/json; charset=utf-8';
const BOOKING_KEYS = Object.freeze(['date', 'end', 'id', 'room', 'start', 'title']);
const BOOKINGS_PREFIX = '/api/bookings/';

const PAGE_FILES = Object.freeze({
  '/': { url: new URL('./public/index.html', import.meta.url), type: 'text/html; charset=utf-8' },
  '/app.js': { url: new URL('./public/app.js', import.meta.url), type: 'text/javascript; charset=utf-8' },
});

const MSG = Object.freeze({
  notFound: 'not found',
  methodNotAllowed: 'method not allowed',
  bookingNotFound: 'booking not found',
  internal: 'internal error',
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

// ---------- field validation (pure) ----------

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME_RE = /^([0-9]{2}):([0-9]{2})$/;

function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 2000 || year > 2099 || month < 1 || month > 12) return false;
  const febDays = year % 4 === 0 ? 29 : 28;
  const daysInMonth = [31, febDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function isValidTime(value) {
  if (typeof value !== 'string') return false;
  const match = TIME_RE.exec(value);
  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function isValidTitle(title) {
  return typeof title === 'string' && title.length >= 1 && title.length <= 80;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function overlaps(a, b) {
  return a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;
}

// Rules 4-9. Returns { error } or { fields } with the trimmed title.
function validateFields(input) {
  const { room, title, date, start, end } = input;
  if (typeof room !== 'string' || !ROOMS.includes(room)) return { error: MSG.room };
  const trimmed = typeof title === 'string' ? title.trim() : null;
  if (!isValidTitle(trimmed)) return { error: MSG.title };
  if (!isValidDate(date)) return { error: MSG.date };
  if (!isValidTime(start)) return { error: MSG.start };
  if (!isValidTime(end)) return { error: MSG.end };
  if (end <= start) return { error: MSG.order };
  return { fields: { room, title: trimmed, date, start, end } };
}

// Rule 10: the overlapping booking that starts earliest, or undefined.
function findConflict(bookings, candidate) {
  return bookings
    .filter((b) => overlaps(b, candidate))
    .reduce((first, b) => (first === undefined || b.start < first.start ? b : first), undefined);
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- startup ----------

function fail(line) {
  process.stderr.write(`${line}\n`, () => process.exit(1));
}

function parsePort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return port <= MAX_PORT ? port : null;
}

function isStoredBooking(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== BOOKING_KEYS.length || keys.some((k, i) => k !== BOOKING_KEYS[i])) return false;
  if (!Number.isSafeInteger(value.id) || value.id < 1) return false;
  const check = validateFields(value);
  return check.fields !== undefined && check.fields.title === value.title;
}

function isValidStore(data) {
  if (!isPlainObject(data)) return false;
  const keys = Object.keys(data).sort();
  if (keys.length !== 2 || keys[0] !== 'bookings' || keys[1] !== 'nextId') return false;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return false;
  if (!bookings.every((b) => isStoredBooking(b) && b.id < nextId)) return false;
  if (new Set(bookings.map((b) => b.id)).size !== bookings.length) return false;
  return bookings.every((b, i) => bookings.slice(i + 1).every((o) => !overlaps(b, o)));
}

// Returns the store, or null when the file cannot be used.
function loadStore(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? { nextId: 1, bookings: [] } : null;
  }
  try {
    const data = JSON.parse(text);
    return isValidStore(data) ? { nextId: data.nextId, bookings: data.bookings } : null;
  } catch {
    return null;
  }
}

// ---------- replies ----------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

// Reads the whole body; buffers at most MAX_BODY_BYTES + 1 bytes but always drains it all.
function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    let buffered = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (buffered <= MAX_BODY_BYTES) {
        chunks.push(chunk);
        buffered += chunk.length;
      }
    });
    req.on('end', () => resolveBody({ total, buffer: Buffer.concat(chunks) }));
    req.on('error', rejectBody);
  });
}

function isJsonContentType(header) {
  if (typeof header !== 'string') return false;
  const media = header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return media.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'application/json';
}

// Rules 1-3. Returns { status, error } or { value } with the parsed object.
function parseJsonBody(req, body) {
  if (!isJsonContentType(req.headers['content-type'])) return { status: 415, error: MSG.contentType };
  if (body.total > MAX_BODY_BYTES) return { status: 413, error: MSG.tooLarge };
  let value;
  try {
    value = JSON.parse(body.buffer.toString('utf8'));
  } catch {
    return { status: 400, error: MSG.notObject };
  }
  return isPlainObject(value) ? { value } : { status: 400, error: MSG.notObject };
}

// ---------- app ----------

function createApp(initialStore, filePath) {
  let store = initialStore;
  let queue = Promise.resolve();

  // Runs mutations one at a time so concurrent requests behave as if sequential.
  function serialize(task) {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  // Saves next to disk, then makes it the in-memory truth. Throws on save failure.
  async function commit(next) {
    await writeFile(filePath, JSON.stringify(next));
    store = next;
  }

  function listBookings(res, query) {
    const params = new URLSearchParams(query);
    const date = params.has('date') ? params.get('date') : null;
    if (date !== null && !isValidDate(date)) return sendError(res, 400, MSG.date);
    const selected = date === null ? store.bookings : store.bookings.filter((b) => b.date === date);
    return sendJson(res, 200, { bookings: [...selected].sort(compareBookings) });
  }

  async function createBooking(req, res, body) {
    const parsed = parseJsonBody(req, body);
    if (parsed.error) return sendError(res, parsed.status, parsed.error);
    const checked = validateFields(parsed.value);
    if (checked.error) return sendError(res, 400, checked.error);
    return serialize(async () => {
      const conflict = findConflict(store.bookings, checked.fields);
      if (conflict) {
        return sendError(res, 409, `room is already booked from ${conflict.start} to ${conflict.end}`);
      }
      const booking = { id: store.nextId, ...checked.fields };
      await commit({ nextId: store.nextId + 1, bookings: [...store.bookings, booking] });
      return sendJson(res, 201, booking);
    });
  }

  async function deleteBooking(res, idText) {
    return serialize(async () => {
      const valid = /^[1-9][0-9]*$/.test(idText);
      const target = valid ? store.bookings.find((b) => String(b.id) === idText) : undefined;
      if (!target) return sendError(res, 404, MSG.bookingNotFound);
      await commit({ nextId: store.nextId, bookings: store.bookings.filter((b) => b !== target) });
      return sendNoContent(res);
    });
  }

  async function servePage(res, page) {
    const content = await readFile(page.url);
    res.writeHead(200, { 'Content-Type': page.type, 'Content-Length': content.length });
    res.end(content);
  }

  async function route(req, res, body) {
    const target = req.url;
    const cut = target.indexOf('?');
    const path = cut === -1 ? target : target.slice(0, cut);
    const query = cut === -1 ? '' : target.slice(cut + 1);
    const method = req.method;

    if (path === '/api/rooms') {
      return method === 'GET' ? sendJson(res, 200, { rooms: [...ROOMS] }) : sendError(res, 405, MSG.methodNotAllowed);
    }
    if (path === '/api/bookings') {
      if (method === 'GET') return listBookings(res, query);
      if (method === 'POST') return createBooking(req, res, body);
      return sendError(res, 405, MSG.methodNotAllowed);
    }
    if (path.startsWith(BOOKINGS_PREFIX)) {
      const idText = path.slice(BOOKINGS_PREFIX.length);
      if (idText === '' || idText.includes('/')) return sendError(res, 404, MSG.notFound);
      return method === 'DELETE' ? deleteBooking(res, idText) : sendError(res, 405, MSG.methodNotAllowed);
    }
    if (Object.hasOwn(PAGE_FILES, path)) {
      return method === 'GET' ? servePage(res, PAGE_FILES[path]) : sendError(res, 405, MSG.methodNotAllowed);
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

  return async function handle(req, res) {
    try {
      const body = await readBody(req);
      await route(req, res, body);
    } catch (err) {
      // Any unexpected failure (a failed save included) becomes a 500; the server keeps running.
      // The cause goes to stderr (never stdout); the client only sees `internal error`.
      process.stderr.write(`request failed: ${err?.code ?? err?.name ?? 'error'}\n`);
      replyInternalError(res);
    }
  };
}

function main() {
  const port = parsePort(process.env.PORT);
  if (port === null) return fail('invalid PORT: must be digits 0-9 with a value up to 65535');

  const dataName = process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const filePath = resolve(process.cwd(), dataName);
  const store = loadStore(filePath);
  if (store === null) return fail(`cannot read data file ${dataName}`);

  const server = createServer(createApp(store, filePath));
  server.on('error', (err) => fail(`cannot listen on port ${port}: ${err.code ?? 'error'}`));
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`);
  });
  return undefined;
}

main();
