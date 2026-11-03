import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];
const MAX_BODY = 10000;

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room bookings</title>
</head>
<body>
<h1>Room bookings</h1>
<form id="booking-form" novalidate>
<p><label for="room">Room</label> <select id="room" name="room"></select></p>
<p><label for="title">Title</label> <input type="text" id="title" name="title"></p>
<p><label for="date">Date</label> <input type="date" id="date" name="date"></p>
<p><label for="start">Start</label> <input type="time" id="start" name="start"></p>
<p><label for="end">End</label> <input type="time" id="end" name="end"></p>
<p><button type="submit" id="book">Book</button></p>
</form>
<p><label for="filter-date">Show date</label> <input type="date" id="filter-date">
<button type="button" id="show-all">Show all</button></p>
<ul id="booking-list"></ul>
<p id="error" role="alert"></p>
<script src="/app.js"></script>
</body>
</html>
`;

const SCRIPT = `(function () {
  'use strict';
  var form = document.getElementById('booking-form');
  var roomSelect = document.getElementById('room');
  var titleInput = document.getElementById('title');
  var dateInput = document.getElementById('date');
  var startInput = document.getElementById('start');
  var endInput = document.getElementById('end');
  var bookButton = document.getElementById('book');
  var filterInput = document.getElementById('filter-date');
  var showAllButton = document.getElementById('show-all');
  var list = document.getElementById('booking-list');
  var errorBox = document.getElementById('error');
  var NO_REPLY = 'Could not reach the server.';

  function showError(message) {
    errorBox.textContent = message;
  }

  // Resolves to { status, data }; rejects when there is no usable reply.
  function request(method, url, body) {
    var options = { method: method };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (res) {
      if (res.status === 204) return { status: 204, data: null };
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function errorMessage(data) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data) &&
        typeof data.error === 'string') {
      return data.error;
    }
    return 'Request failed.';
  }

  function loadRooms() {
    request('GET', '/api/rooms').then(function (reply) {
      if (reply.status !== 200) {
        showError(errorMessage(reply.data));
        return;
      }
      var options = reply.data.rooms.map(function (name) {
        var option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        return option;
      });
      roomSelect.replaceChildren.apply(roomSelect, options);
    }, function () {
      showError(NO_REPLY);
    });
  }

  function cancelButton(booking) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Cancel';
    button.addEventListener('click', function () {
      button.disabled = true;
      request('DELETE', '/api/bookings/' + booking.id).then(function (reply) {
        button.disabled = false;
        if (reply.status === 204) showError('');
        else showError(errorMessage(reply.data));
        loadList();
      }, function () {
        button.disabled = false;
        showError(NO_REPLY);
      });
    });
    return button;
  }

  function render(bookings) {
    var items = bookings.map(function (b) {
      var li = document.createElement('li');
      li.append(b.date + ' ' + b.start + '-' + b.end + ' ' + b.room + ': ' + b.title,
        cancelButton(b));
      return li;
    });
    if (items.length === 0) {
      var empty = document.createElement('li');
      empty.append('No bookings.');
      items.push(empty);
    }
    list.replaceChildren.apply(list, items);
  }

  var listSeq = 0;
  function loadList() {
    var seq = ++listSeq;
    var url = '/api/bookings';
    if (filterInput.value !== '') url += '?date=' + filterInput.value;
    request('GET', url).then(function (reply) {
      if (seq !== listSeq) return;
      if (reply.status !== 200) {
        showError(errorMessage(reply.data));
        return;
      }
      render(reply.data.bookings);
    }, function () {
      if (seq !== listSeq) return;
      showError(NO_REPLY);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (bookButton.disabled) return;
    bookButton.disabled = true;
    request('POST', '/api/bookings', {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value
    }).then(function (reply) {
      bookButton.disabled = false;
      if (reply.status === 201) {
        titleInput.value = '';
        showError('');
        loadList();
      } else {
        showError(errorMessage(reply.data));
      }
    }, function () {
      bookButton.disabled = false;
      showError(NO_REPLY);
    });
  });

  filterInput.addEventListener('change', function () {
    loadList();
  });

  showAllButton.addEventListener('click', function () {
    filterInput.value = '';
    loadList();
  });

  loadRooms();
  loadList();
})();
`;

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStoredBooking(b) {
  if (!isPlainObject(b)) return false;
  const keys = Object.keys(b).sort().join(',');
  if (keys !== 'date,end,id,room,start,title') return false;
  if (!Number.isSafeInteger(b.id) || b.id < 1) return false;
  if (!ROOMS.includes(b.room)) return false;
  if (typeof b.title !== 'string' || b.title !== b.title.trim()) return false;
  if (b.title.length < 1 || b.title.length > 80) return false;
  return isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && b.end > b.start;
}

function parseStore(text) {
  const data = JSON.parse(text);
  if (!isPlainObject(data)) throw new Error('bad layout');
  if (Object.keys(data).sort().join(',') !== 'bookings,nextId') throw new Error('bad layout');
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) throw new Error('bad layout');
  if (!Array.isArray(data.bookings)) throw new Error('bad layout');
  const ids = new Set();
  for (const b of data.bookings) {
    if (!isStoredBooking(b) || b.id >= data.nextId || ids.has(b.id)) throw new Error('bad layout');
    ids.add(b.id);
  }
  return { nextId: data.nextId, bookings: data.bookings };
}

function compareBookings(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);
}

// ---- startup ----

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const portText = process.env.PORT ?? '';
let port = 3000;
if (portText !== '') {
  if (!/^[0-9]+$/.test(portText) || Number(portText) > 65535) fail(`invalid PORT ${portText}`);
  port = Number(portText);
}

const dataName = process.env.DATA_FILE || 'bookings.json';
const dataPath = path.resolve(process.cwd(), dataName);

let store = { nextId: 1, bookings: [] };
try {
  store = parseStore(fs.readFileSync(dataPath, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') fail(`cannot read data file ${dataName}`);
}

function save(next) {
  fs.writeFileSync(dataPath, JSON.stringify(next, null, 2) + '\n');
  store = next;
}

// ---- HTTP ----

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendText(res, type, text) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on('end', () => resolve({ buffer: Buffer.concat(chunks), size }));
    req.on('error', reject);
  });
}

function createBooking(req, body) {
  const contentType = req.headers['content-type'];
  const mediaType = contentType === undefined
    ? ''
    : contentType.split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'content type must be application/json');
  }
  if (body.size > MAX_BODY) throw new HttpError(413, 'body too large');

  let input;
  try {
    input = JSON.parse(body.buffer.toString('utf8'));
  } catch {
    input = undefined;
  }
  if (!isPlainObject(input)) throw new HttpError(400, 'body must be a JSON object');

  const { room, title, date, start, end } = input;
  if (typeof room !== 'string' || !ROOMS.includes(room)) {
    throw new HttpError(400, 'room must be one of Aurora, Borealis, Cosmos');
  }
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new HttpError(400, 'title must be 1 to 80 characters');
  }
  if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
  if (!isValidTime(start)) throw new HttpError(400, 'start must be HH:MM');
  if (!isValidTime(end)) throw new HttpError(400, 'end must be HH:MM');
  if (!(end > start)) throw new HttpError(400, 'end must be after start');

  const conflicts = store.bookings
    .filter((b) => b.room === room && b.date === date && start < b.end && b.start < end)
    .sort(compareBookings);
  if (conflicts.length > 0) {
    throw new HttpError(409, `room is already booked from ${conflicts[0].start} to ${conflicts[0].end}`);
  }

  const booking = { id: store.nextId, room, title: trimmed, date, start, end };
  save({ nextId: store.nextId + 1, bookings: [...store.bookings, booking] });
  return booking;
}

function listBookings(query) {
  const params = new URLSearchParams(query);
  let bookings = store.bookings;
  if (params.has('date')) {
    const date = params.get('date');
    if (!isValidDate(date)) throw new HttpError(400, 'date must be a valid YYYY-MM-DD date');
    bookings = bookings.filter((b) => b.date === date);
  }
  return [...bookings].sort(compareBookings);
}

function deleteBooking(id) {
  const index = /^[1-9][0-9]*$/.test(id)
    ? store.bookings.findIndex((b) => String(b.id) === id)
    : -1;
  if (index === -1) throw new HttpError(404, 'booking not found');
  save({ nextId: store.nextId, bookings: store.bookings.filter((_, i) => i !== index) });
}

async function handle(req, res) {
  const body = await readBody(req);
  const target = req.url;
  const q = target.indexOf('?');
  const pathname = q === -1 ? target : target.slice(0, q);
  const query = q === -1 ? '' : target.slice(q + 1);
  const method = req.method;
  const notAllowed = () => new HttpError(405, 'method not allowed');

  if (pathname === '/api/rooms') {
    if (method !== 'GET') throw notAllowed();
    return sendJson(res, 200, { rooms: ROOMS });
  }
  if (pathname === '/api/bookings') {
    if (method === 'GET') return sendJson(res, 200, { bookings: listBookings(query) });
    if (method === 'POST') return sendJson(res, 201, createBooking(req, body));
    throw notAllowed();
  }
  if (pathname.startsWith('/api/bookings/')) {
    const id = pathname.slice('/api/bookings/'.length);
    if (id === '' || id.includes('/')) throw new HttpError(404, 'not found');
    if (method !== 'DELETE') throw notAllowed();
    deleteBooking(id);
    res.writeHead(204);
    return res.end();
  }
  if (pathname === '/') {
    if (method !== 'GET') throw notAllowed();
    return sendText(res, 'text/html; charset=utf-8', PAGE);
  }
  if (pathname === '/app.js') {
    if (method !== 'GET') throw notAllowed();
    return sendText(res, 'text/javascript; charset=utf-8', SCRIPT);
  }
  throw new HttpError(404, 'not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent || res.destroyed) return;
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: 'internal error' });
  });
});

server.on('error', (err) => fail(`cannot listen on port ${port}: ${err.message}`));
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`);
});
