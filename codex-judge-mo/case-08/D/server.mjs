import http from 'node:http';
import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];
const MAX_BODY = 10000;
const BOOKING_KEYS = ['id', 'room', 'title', 'date', 'start', 'end'];

const JSON_TYPE = 'application/json; charset=utf-8';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- validation helpers ----------

function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2099) return false;
  if (month < 1 || month > 12) return false;
  const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isValidTime(value) {
  return typeof value === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function isValidTitle(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
}

function isStoredBooking(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
  const keys = Object.keys(b);
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => Object.hasOwn(b, k))) return false;
  return (
    Number.isSafeInteger(b.id) && b.id >= 1 &&
    ROOMS.includes(b.room) &&
    isValidTitle(b.title) && b.title === b.title.trim() &&
    isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.end > b.start
  );
}

function parseStore(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const { nextId, bookings } = data;
  if (!Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(bookings)) return null;
  const ids = new Set();
  for (const b of bookings) {
    if (!isStoredBooking(b) || b.id >= nextId || ids.has(b.id)) return null;
    ids.add(b.id);
  }
  return { nextId, bookings: bookings.map((b) => ({ ...b })) };
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---------- HTTP helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

// Reads the whole body, keeping at most MAX_BODY + 1 bytes but counting all of them.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let kept = 0;
    let total = 0;
    let done = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (kept <= MAX_BODY) {
        chunks.push(chunk);
        kept += chunk.length;
      }
    });
    req.on('end', () => {
      done = true;
      resolve({ buffer: Buffer.concat(chunks), size: total });
    });
    req.on('error', (err) => {
      done = true;
      reject(err);
    });
    req.on('close', () => {
      if (!done) reject(new Error('request closed'));
    });
  });
}

function mediaTypeIsJson(header) {
  if (typeof header !== 'string') return false;
  const type = header.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '');
  return type.toLowerCase() === 'application/json';
}

// ---------- app ----------

function createApp(store, filePath, assets) {
  let queue = Promise.resolve();
  function serialize(fn) {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  }

  async function save(next) {
    await writeFile(filePath, JSON.stringify(next));
    store.nextId = next.nextId;
    store.bookings = next.bookings;
  }

  function createBooking(req, body) {
    if (!mediaTypeIsJson(req.headers['content-type'])) {
      throw new HttpError(415, 'content type must be application/json');
    }
    if (body.size > MAX_BODY) throw new HttpError(413, 'body too large');
    let input;
    try {
      input = JSON.parse(body.buffer.toString('utf8'));
    } catch {
      input = undefined;
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpError(400, 'body must be a JSON object');
    }
    const get = (key) => (Object.hasOwn(input, key) ? input[key] : undefined);
    const room = get('room');
    const title = get('title');
    const date = get('date');
    const start = get('start');
    const end = get('end');
    if (typeof room !== 'string' || !ROOMS.includes(room)) {
      throw new HttpError(400, 'room must be one of Aurora, Borealis, Cosmos');
    }
    if (!isValidTitle(title)) throw new HttpError(400, 'title must be 1 to 80 characters');
    if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
    if (!isValidTime(start)) throw new HttpError(400, 'start must be HH:MM');
    if (!isValidTime(end)) throw new HttpError(400, 'end must be HH:MM');
    if (!(end > start)) throw new HttpError(400, 'end must be after start');

    return serialize(async () => {
      const clashes = store.bookings
        .filter((b) => b.room === room && b.date === date && b.start < end && start < b.end)
        .sort(compareBookings);
      if (clashes.length > 0) {
        throw new HttpError(409, `room is already booked from ${clashes[0].start} to ${clashes[0].end}`);
      }
      const booking = { id: store.nextId, room, title: title.trim(), date, start, end };
      await save({ nextId: store.nextId + 1, bookings: [...store.bookings, booking] });
      return booking;
    });
  }

  function deleteBooking(idText) {
    return serialize(async () => {
      const valid = /^[1-9][0-9]*$/.test(idText);
      const index = valid ? store.bookings.findIndex((b) => String(b.id) === idText) : -1;
      if (index === -1) throw new HttpError(404, 'booking not found');
      await save({ nextId: store.nextId, bookings: store.bookings.filter((_, i) => i !== index) });
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

  async function route(req, res, body) {
    const target = req.url ?? '';
    const q = target.indexOf('?');
    const pathname = q === -1 ? target : target.slice(0, q);
    const query = q === -1 ? '' : target.slice(q + 1);
    const method = req.method;

    if (pathname === '/') {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': assets.html.length });
      res.end(assets.html);
      return;
    }
    if (pathname === '/app.js') {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': assets.js.length });
      res.end(assets.js);
      return;
    }
    if (pathname === '/api/rooms') {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      sendJson(res, 200, { rooms: ROOMS });
      return;
    }
    if (pathname === '/api/bookings') {
      if (method === 'GET') {
        sendJson(res, 200, { bookings: listBookings(query) });
      } else if (method === 'POST') {
        sendJson(res, 201, await createBooking(req, body));
      } else {
        throw new HttpError(405, 'method not allowed');
      }
      return;
    }
    const prefix = '/api/bookings/';
    if (pathname.startsWith(prefix)) {
      const idText = pathname.slice(prefix.length);
      if (idText !== '' && !idText.includes('/')) {
        if (method !== 'DELETE') throw new HttpError(405, 'method not allowed');
        await deleteBooking(idText);
        res.writeHead(204);
        res.end();
        return;
      }
    }
    throw new HttpError(404, 'not found');
  }

  return async function handle(req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.destroy();
      return;
    }
    try {
      await route(req, res, body);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
      } else if (err instanceof HttpError) {
        sendError(res, err.status, err.message);
      } else {
        sendError(res, 500, 'internal error');
      }
    }
  };
}

// ---------- startup ----------

function fail(message) {
  process.stderr.write(message + '\n', () => process.exit(1));
}

function main() {
  const portText = process.env.PORT ?? '';
  let port = 3000;
  if (portText !== '') {
    if (!/^[0-9]+$/.test(portText) || Number(portText) > 65535) {
      fail(`invalid PORT ${portText}`);
      return;
    }
    port = Number(portText);
  }

  const dataName = process.env.DATA_FILE || 'bookings.json';
  const filePath = path.resolve(process.cwd(), dataName);
  let store = { nextId: 1, bookings: [] };
  let text = null;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      fail(`cannot read data file ${dataName}`);
      return;
    }
  }
  if (text !== null) {
    store = parseStore(text);
    if (!store) {
      fail(`cannot read data file ${dataName}`);
      return;
    }
  }

  const assets = {
    html: fs.readFileSync(path.join(HERE, 'public', 'index.html')),
    js: fs.readFileSync(path.join(HERE, 'public', 'app.js')),
  };

  const server = http.createServer(createApp(store, filePath, assets));
  server.once('error', (err) => {
    fail(`cannot listen on port ${port}: ${err.code || err.message}`);
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`);
  });
}

main();
