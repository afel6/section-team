// near-miss: generation check only on success (earlier errors still shown)
'use strict';

(function setupBookingPage() {
  const NO_REPLY = 'Could not reach the server.';
  const FALLBACK_ERROR = 'Request failed.';
  const SUCCESS_STATUS = { GET: 200, POST: 201, DELETE: 204 };

  const form = document.getElementById('booking-form');
  const roomSelect = document.getElementById('room');
  const titleInput = document.getElementById('title');
  const dateInput = document.getElementById('date');
  const startInput = document.getElementById('start');
  const endInput = document.getElementById('end');
  const bookButton = document.getElementById('book');
  const filterDate = document.getElementById('filter-date');
  const showAllButton = document.getElementById('show-all');
  const bookingList = document.getElementById('booking-list');
  const errorBox = document.getElementById('error');

  let listGeneration = 0;

  // Resolves to { ok, status, body } when a reply arrived, or null when there was none.
  // A non-204 reply whose body is not JSON counts as no reply.
  async function request(method, url, payload) {
    const options = payload === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    try {
      const reply = await fetch(url, options);
      const body = reply.status === 204 ? undefined : await reply.json();
      return { ok: reply.status === SUCCESS_STATUS[method], status: reply.status, body };
    } catch {
      // Network failure or unreadable body: the caller shows the no-reply message.
      return null;
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function errorMessage(body) {
    return isPlainObject(body) && typeof body.error === 'string' ? body.error : FALLBACK_ERROR;
  }

  // The array under `key` in a success body, or null when the body has an unexpected shape.
  function listField(body, key) {
    return isPlainObject(body) && Array.isArray(body[key]) ? body[key] : null;
  }

  function showError(text) {
    errorBox.textContent = text;
  }

  function showOutcomeError(result) {
    showError(result === null ? NO_REPLY : errorMessage(result.body));
  }

  async function loadRooms() {
    const result = await request('GET', '/api/rooms');
    if (result === null || !result.ok) {
      showOutcomeError(result);
      return;
    }
    const rooms = listField(result.body, 'rooms');
    if (rooms === null) {
      showError(FALLBACK_ERROR);
      return;
    }
    const options = rooms.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    });
    roomSelect.replaceChildren(...options);
  }

  function bookingItem(booking) {
    const item = document.createElement('li');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => cancelBooking(booking.id, cancel));
    const text = `${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`;
    item.append(text, cancel);
    return item;
  }

  function emptyItem() {
    const item = document.createElement('li');
    item.append('No bookings.');
    return item;
  }

  async function loadList() {
    listGeneration += 1;
    const generation = listGeneration;
    const filter = filterDate.value;
    const url = filter === '' ? '/api/bookings' : `/api/bookings?date=${filter}`;
    const result = await request('GET', url);
    if (result === null || !result.ok) {
      showOutcomeError(result);
      return;
    }
    if (generation !== listGeneration) {
      return;
    }
    const bookings = listField(result.body, 'bookings');
    if (bookings === null || !bookings.every(isPlainObject)) {
      showError(FALLBACK_ERROR);
      return;
    }
    const items = bookings.length === 0 ? [emptyItem()] : bookings.map(bookingItem);
    bookingList.replaceChildren(...items);
  }

  async function cancelBooking(id, button) {
    button.disabled = true;
    const result = await request('DELETE', `/api/bookings/${id}`);
    button.disabled = false;
    if (result === null) {
      showError(NO_REPLY);
      return;
    }
    showError(result.ok ? '' : errorMessage(result.body));
    loadList();
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
    bookButton.disabled = true;
    const payload = {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
    };
    const result = await request('POST', '/api/bookings', payload);
    bookButton.disabled = false;
    if (result === null || !result.ok) {
      showOutcomeError(result);
      return;
    }
    titleInput.value = '';
    showError('');
    loadList();
  }

  function showAll() {
    filterDate.value = '';
    loadList();
  }

  form.addEventListener('submit', submitBooking);
  filterDate.addEventListener('change', () => loadList());
  showAllButton.addEventListener('click', showAll);

  loadRooms();
  loadList();
})();
