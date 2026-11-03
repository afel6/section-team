// Meeting-room booking server: JSON API + static page, data kept in one JSON file.
// Only Node.js built-ins. Request handling is synchronous once a body is fully read,
// so requests are handled one at a time (saves use synchronous fs calls).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);
const MAX_BODY = 10000;
const HOST = '127.0.0.1';
const JSON_TYPE = 'application/json; charset=utf-8';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = Object.freeze({
  '/': { file: path.join(HERE, 'public', 'index.html'), type: 'text/html; charset=utf-8' },
  '/app.js': { file: path.join(HERE, 'public', 'app.js'), type: 'text/javascript; charset=utf-8' },
});
const BOOKING_KEYS = Object.freeze(['id', 'room', 'title', 'date', 'start', 'end']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation ----------

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

function isValidTitle(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function overlaps(a, b) {
  return a.room === b.room && a.date === b.date && a.start < b.end && b.start < a.end;
}

// Applies Booking rules 4-10 to a parsed body; returns the fields to store.
function validateBookingFields(body, bookings) {
  if (typeof body.room !== 'string' || !ROOMS.includes(body.room)) {
    throw new HttpError(400, 'room must be one of Aurora, Borealis, Cosmos');
  }
  if (!isValidTitle(body.title)) throw new HttpError(400, 'title must be 1 to 80 characters');
  if (!isValidDate(body.date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  if (!isValidTime(body.start)) throw new HttpError(400, 'start must be HH:MM');
  if (!isValidTime(body.end)) throw new HttpError(400, 'end must be HH:MM');
  if (!(body.end > body.start)) throw new HttpError(400, 'end must be after start');
  const fields = {
    room: body.room, title: body.title.trim(), date: body.date, start: body.start, end: body.end,
  };
  const clash = bookings
    .filter((b) => overlaps(b, fields))
    .reduce((first, b) => (first === null || b.start < first.start ? b : first), null);
  if (clash !== null) {
    throw new HttpError(409, `room is already booked from ${clash.start} to ${clash.end}`);
  }
  return fields;
}

function isStoredBooking(b, nextId) {
  if (!isPlainObject(b)) return false;
  const keys = Object.keys(b);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => keys.includes(k))) return false;
  return Number.isSafeInteger(b.id) && b.id >= 1 && b.id < nextId
    && ROOMS.includes(b.room) && isValidTitle(b.title) && b.title === b.title.trim()
    && isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.end > b.start;
}

// Returns the state held in the file text, or null when it is not in our layout.
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
  if (!bookings.every((b) => isStoredBooking(b, nextId))) return null;
  if (new Set(bookings.map((b) => b.id)).size !== bookings.length) return null;
  const clash = bookings.some((a, i) => bookings.some((b, j) => i < j && overlaps(a, b)));
  return clash ? null : { nextId, bookings: bookings.map((b) => ({ ...b })) };
}

// ---------- startup ----------

function fail(line) {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function readPort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return 3000;
  if (!/^[0-9]+$/.test(raw) || Number(raw) > 65535) {
    fail('PORT must be a whole number from 0 to 65535');
  }
  return Number(raw);
}

function loadState(name, file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return { nextId: 1, bookings: [] };
    return fail(`cannot read data file ${name}`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return fail(`cannot read data file ${name}`);
  }
  const state = parseState(text);
  return state === null ? fail(`cannot read data file ${name}`) : state;
}

function saveState(file, state) {
  const tmp = `${file}.tmp-${process.pid}`;
  const text = `${JSON.stringify(state, null, 2)}\n`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best-effort cleanup; the original save error is the one reported.
    }
    throw err;
  }
}

function listenErrorLine(err, port) {
  const lines = {
    EADDRINUSE: `port ${port} is already in use`,
    EACCES: `permission denied to listen on port ${port}`,
    EADDRNOTAVAIL: `address ${HOST} is not available`,
  };
  return lines[err.code] ?? `cannot listen on port ${port}`;
}

// ---------- replies ----------

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendPage(res, page) {
  const body = fs.readFileSync(page.file);
  res.writeHead(200, { 'Content-Type': page.type, 'Content-Length': body.length });
  res.end(body);
}

// ---------- handlers ----------

function sortBookings(bookings) {
  return [...bookings].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
  });
}

function listBookings(ctx, query) {
  const params = new URLSearchParams(query);
  let bookings = ctx.state.bookings;
  if (params.has('date')) {
    const date = params.get('date');
    if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
    bookings = bookings.filter((b) => b.date === date);
  }
  return { status: 200, body: { bookings: sortBookings(bookings) } };
}

function mediaTypeIsJson(header) {
  if (typeof header !== 'string') return false;
  const media = header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return media.replace(/[A-Z]/g, (c) => c.toLowerCase()) === 'application/json';
}

function createBooking(ctx, req, body) {
  if (!mediaTypeIsJson(req.headers['content-type'])) {
    throw new HttpError(415, 'content type must be application/json');
  }
  if (body.size > MAX_BODY) throw new HttpError(413, 'body too large');
  let parsed;
  try {
    parsed = JSON.parse(body.data.toString('utf8'));
  } catch {
    parsed = undefined;
  }
  if (!isPlainObject(parsed)) throw new HttpError(400, 'body must be a JSON object');
  const fields = validateBookingFields(parsed, ctx.state.bookings);
  const booking = { id: ctx.state.nextId, ...fields };
  const next = { nextId: ctx.state.nextId + 1, bookings: [...ctx.state.bookings, booking] };
  saveState(ctx.file, next);
  ctx.state = next;
  return { status: 201, body: booking };
}

function deleteBooking(ctx, idText) {
  const found = /^[1-9][0-9]*$/.test(idText)
    && ctx.state.bookings.some((b) => String(b.id) === idText);
  if (!found) throw new HttpError(404, 'booking not found');
  const next = {
    nextId: ctx.state.nextId,
    bookings: ctx.state.bookings.filter((b) => String(b.id) !== idText),
  };
  saveState(ctx.file, next);
  ctx.state = next;
  return { status: 204 };
}

function requireMethod(method, allowed) {
  if (!allowed.includes(method)) throw new HttpError(405, 'method not allowed');
}

// Routes one fully-read request; returns { status, body } or { page }.
function route(ctx, req, body) {
  const target = req.url;
  const mark = target.indexOf('?');
  const pathPart = mark === -1 ? target : target.slice(0, mark);
  const query = mark === -1 ? '' : target.slice(mark + 1);
  const { method } = req;
  if (pathPart === '/api/rooms') {
    requireMethod(method, ['GET']);
    return { status: 200, body: { rooms: [...ROOMS] } };
  }
  if (pathPart === '/api/bookings') {
    requireMethod(method, ['GET', 'POST']);
    return method === 'GET' ? listBookings(ctx, query) : createBooking(ctx, req, body);
  }
  const prefix = '/api/bookings/';
  const rest = pathPart.startsWith(prefix) ? pathPart.slice(prefix.length) : null;
  if (rest !== null && rest !== '' && !rest.includes('/')) {
    requireMethod(method, ['DELETE']);
    return deleteBooking(ctx, rest);
  }
  if (Object.hasOwn(PAGES, pathPart)) {
    requireMethod(method, ['GET']);
    return { page: PAGES[pathPart] };
  }
  throw new HttpError(404, 'not found');
}

function respond(ctx, req, res, body) {
  try {
    const result = route(ctx, req, body);
    if (result.page) return sendPage(res, result.page);
    if (result.status === 204) {
      res.writeHead(204);
      return res.end();
    }
    return sendJson(res, result.status, result.body);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    const known = err instanceof HttpError;
    return sendError(res, known ? err.status : 500, known ? err.message : 'internal error');
  }
}

function handleRequest(ctx, req, res) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    if (size <= MAX_BODY) chunks.push(chunk);
    size += chunk.length;
  });
  req.on('end', () => {
    respond(ctx, req, res, { size, data: Buffer.concat(chunks) });
  });
  // A client that aborts mid-body cannot be answered; drop its socket.
  req.on('error', () => res.destroy());
}

// ---------- main ----------

function main() {
  const port = readPort();
  const name = process.env.DATA_FILE ? process.env.DATA_FILE : 'bookings.json';
  const file = path.resolve(process.cwd(), name);
  const ctx = { file, state: loadState(name, file) };
  const server = http.createServer((req, res) => handleRequest(ctx, req, res));
  server.once('error', (err) => fail(listenErrorLine(err, port)));
  server.listen(port, HOST, () => {
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`);
  });
}

main();
