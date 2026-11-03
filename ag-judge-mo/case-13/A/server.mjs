import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];
const MAX_BODY = 10000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const MSG = {
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
};

function fail(line) {
  try {
    fs.writeSync(2, line + '\n');
  } catch {
    // nothing more we can do
  }
  process.exit(1);
}

// ---- validation ----

function isValidDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function isValidTime(value) {
  if (typeof value !== 'string' || !/^[0-9]{2}:[0-9]{2}$/.test(value)) return false;
  return Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59;
}

// Checks rules 4-9. Returns { error } or { booking } (without id, title trimmed).
function validateFields(data) {
  if (typeof data.room !== 'string' || !ROOMS.includes(data.room)) return { error: MSG.room };
  if (typeof data.title !== 'string') return { error: MSG.title };
  const title = data.title.trim();
  if (title.length < 1 || title.length > 80) return { error: MSG.title };
  if (!isValidDate(data.date)) return { error: MSG.date };
  if (!isValidTime(data.start)) return { error: MSG.start };
  if (!isValidTime(data.end)) return { error: MSG.end };
  if (!(data.end > data.start)) return { error: MSG.order };
  return { booking: { room: data.room, title, date: data.date, start: data.start, end: data.end } };
}

function findOverlap(bookings, b) {
  let found = null;
  for (const other of bookings) {
    if (other.room !== b.room || other.date !== b.date) continue;
    if (b.start < other.end && other.start < b.end) {
      if (found === null || other.start < found.start) found = other;
    }
  }
  return found;
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

const BOOKING_KEYS = ['id', 'room', 'title', 'date', 'start', 'end'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Parses the data file content; returns the state or null when it is not in our layout.
function parseData(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data).sort();
  if (keys.length !== 2 || keys[0] !== 'bookings' || keys[1] !== 'nextId') return null;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return null;
  const ids = new Set();
  const loaded = [];
  for (const item of bookings) {
    if (!isPlainObject(item)) return null;
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => Object.hasOwn(item, k))) return null;
    if (!Number.isSafeInteger(item.id) || item.id < 1 || item.id >= nextId || ids.has(item.id)) return null;
    const checked = validateFields(item);
    if (checked.error || checked.booking.title !== item.title) return null;
    if (findOverlap(loaded, item)) return null;
    ids.add(item.id);
    loaded.push({ id: item.id, ...checked.booking });
  }
  return { nextId, bookings: loaded };
}

// ---- startup: PORT, then data file, then listen ----

const portEnv = process.env.PORT ?? '';
let port = 3000;
if (portEnv !== '') {
  if (!/^[0-9]+$/.test(portEnv) || Number(portEnv) > 65535) fail(`invalid PORT: ${portEnv}`);
  port = Number(portEnv);
}

const dataName = process.env.DATA_FILE || 'bookings.json';
const dataPath = path.resolve(process.cwd(), dataName);
let state = { nextId: 1, bookings: [] };
{
  let text = null;
  try {
    text = fs.readFileSync(dataPath, 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') fail(`cannot read data file ${dataName}`);
  }
  if (text !== null) {
    const parsed = parseData(text);
    if (parsed === null) fail(`cannot read data file ${dataName}`);
    state = parsed;
  }
}

async function save(next) {
  await fs.promises.writeFile(dataPath, JSON.stringify(next, null, 2) + '\n');
}

// Runs changes one at a time.
let queue = Promise.resolve();
function exclusive(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}

// ---- HTTP ----

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function sendFile(res, name, type) {
  const content = await fs.promises.readFile(path.join(PUBLIC_DIR, name));
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
  res.end(content);
}

// Reads the whole body; keeps at most MAX_BODY + 1 bytes but counts all of them.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let kept = 0;
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve({ size, buffer: Buffer.concat(chunks) });
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (kept <= MAX_BODY) {
        chunks.push(chunk);
        kept += chunk.length;
      }
    });
    req.on('end', finish);
    req.on('close', finish);
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function mediaType(header) {
  const semi = header.indexOf(';');
  const type = semi < 0 ? header : header.slice(0, semi);
  return type.replace(/^[ \t]+|[ \t]+$/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
}

async function createBooking(req, res, body) {
  const contentType = req.headers['content-type'];
  if (contentType === undefined || mediaType(contentType) !== 'application/json') {
    return sendError(res, 415, 'content type must be application/json');
  }
  if (body.size > MAX_BODY) return sendError(res, 413, 'body too large');
  let data;
  try {
    data = JSON.parse(body.buffer.toString('utf8'));
  } catch {
    data = undefined;
  }
  if (!isPlainObject(data)) return sendError(res, 400, 'body must be a JSON object');
  const checked = validateFields(data);
  if (checked.error) return sendError(res, 400, checked.error);

  await exclusive(async () => {
    const overlap = findOverlap(state.bookings, checked.booking);
    if (overlap) {
      return sendError(res, 409, `room is already booked from ${overlap.start} to ${overlap.end}`);
    }
    const booking = { id: state.nextId, ...checked.booking };
    const next = { nextId: state.nextId + 1, bookings: [...state.bookings, booking] };
    try {
      await save(next);
    } catch {
      return sendError(res, 500, 'internal error');
    }
    state = next;
    sendJson(res, 201, booking);
  });
}

async function deleteBooking(res, idText) {
  await exclusive(async () => {
    const index = /^[1-9][0-9]*$/.test(idText)
      ? state.bookings.findIndex((b) => String(b.id) === idText)
      : -1;
    if (index < 0) return sendError(res, 404, 'booking not found');
    const next = { nextId: state.nextId, bookings: state.bookings.filter((_, i) => i !== index) };
    try {
      await save(next);
    } catch {
      return sendError(res, 500, 'internal error');
    }
    state = next;
    res.writeHead(204);
    res.end();
  });
}

function listBookings(res, query) {
  const params = new URLSearchParams(query);
  let bookings = state.bookings;
  if (params.has('date')) {
    const date = params.get('date');
    if (!isValidDate(date)) return sendError(res, 400, MSG.date);
    bookings = bookings.filter((b) => b.date === date);
  }
  sendJson(res, 200, { bookings: [...bookings].sort(compareBookings) });
}

async function handle(req, res) {
  const body = await readBody(req);
  const target = req.url;
  const q = target.indexOf('?');
  const pathname = q < 0 ? target : target.slice(0, q);
  const query = q < 0 ? '' : target.slice(q + 1);
  const method = req.method;
  const notAllowed = () => sendError(res, 405, 'method not allowed');

  if (pathname === '/') {
    return method === 'GET' ? sendFile(res, 'index.html', 'text/html; charset=utf-8') : notAllowed();
  }
  if (pathname === '/app.js') {
    return method === 'GET' ? sendFile(res, 'app.js', 'text/javascript; charset=utf-8') : notAllowed();
  }
  if (pathname === '/api/rooms') {
    return method === 'GET' ? sendJson(res, 200, { rooms: ROOMS }) : notAllowed();
  }
  if (pathname === '/api/bookings') {
    if (method === 'GET') return listBookings(res, query);
    if (method === 'POST') return createBooking(req, res, body);
    return notAllowed();
  }
  const prefix = '/api/bookings/';
  if (pathname.startsWith(prefix)) {
    const id = pathname.slice(prefix.length);
    if (id !== '' && !id.includes('/')) {
      return method === 'DELETE' ? deleteBooking(res, id) : notAllowed();
    }
  }
  return sendError(res, 404, 'not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) {
      try {
        sendError(res, 500, 'internal error');
      } catch {
        res.destroy();
      }
    } else {
      res.destroy();
    }
  });
});

let listening = false;
server.on('error', (err) => {
  if (!listening) fail(`cannot listen on port ${port}: ${err && err.code ? err.code : err}`);
});
server.listen(port, '127.0.0.1', () => {
  listening = true;
  process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`);
});
