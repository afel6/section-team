// near-miss: any truthy error value used as the message
'use strict';

(function setup() {
  const NO_REPLY = 'Could not reach the server.';
  const REQUEST_FAILED = 'Request failed.';

  const form = document.getElementById('booking-form');
  const roomSelect = document.getElementById('room');
  const titleInput = document.getElementById('title');
  const dateInput = document.getElementById('date');
  const startInput = document.getElementById('start');
  const endInput = document.getElementById('end');
  const bookButton = document.getElementById('book');
  const filterInput = document.getElementById('filter-date');
  const showAllButton = document.getElementById('show-all');
  const list = document.getElementById('booking-list');
  const errorBox = document.getElementById('error');

  let listSequence = 0;

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function errorMessage(body) {
    return isPlainObject(body) && body.error ? String(body.error) : REQUEST_FAILED;
  }

  // Resolves (never rejects) to one of:
  //   { kind: 'ok', body }        status === successStatus
  //   { kind: 'error', message }  any other status
  //   { kind: 'none' }            no reply, or a non-204 body that is not JSON
  async function request(url, options, successStatus) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      return { kind: 'none' };
    }
    let body = null;
    if (response.status !== 204) {
      try {
        body = await response.json();
      } catch {
        return { kind: 'none' };
      }
    }
    if (response.status === successStatus) {
      return { kind: 'ok', body };
    }
    return { kind: 'error', message: errorMessage(body) };
  }

  function showError(text) {
    errorBox.textContent = text;
  }

  function showFailure(outcome) {
    showError(outcome.kind === 'error' ? outcome.message : NO_REPLY);
  }

  function makeOption(name) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }

  async function loadRooms() {
    const outcome = await request('/api/rooms', { method: 'GET' }, 200);
    if (outcome.kind !== 'ok') {
      showFailure(outcome);
      return;
    }
    const rooms = isPlainObject(outcome.body) ? outcome.body.rooms : null;
    if (!Array.isArray(rooms)) {
      showError(REQUEST_FAILED);
      return;
    }
    roomSelect.replaceChildren(...rooms.map((name) => makeOption(String(name))));
  }

  function makeBookingItem(booking) {
    const item = document.createElement('li');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => cancelBooking(booking.id, cancel));
    const text = `${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`;
    item.append(text, cancel);
    return item;
  }

  function makeEmptyItem() {
    const item = document.createElement('li');
    item.append('No bookings.');
    return item;
  }

  function renderBookings(bookings) {
    if (bookings.length === 0) {
      list.replaceChildren(makeEmptyItem());
      return;
    }
    list.replaceChildren(...bookings.map(makeBookingItem));
  }

  function listUrl() {
    const date = filterInput.value;
    return date === '' ? '/api/bookings' : `/api/bookings?date=${date}`;
  }

  async function loadList() {
    listSequence += 1;
    const sequence = listSequence;
    const outcome = await request(listUrl(), { method: 'GET' }, 200);
    if (sequence !== listSequence) {
      return;
    }
    if (outcome.kind !== 'ok') {
      showFailure(outcome);
      return;
    }
    const bookings = isPlainObject(outcome.body) ? outcome.body.bookings : null;
    if (!Array.isArray(bookings) || !bookings.every(isPlainObject)) {
      showError(REQUEST_FAILED);
      return;
    }
    renderBookings(bookings);
  }

  function bookingPayload() {
    return JSON.stringify({
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
    });
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
    bookButton.disabled = true;
    const outcome = await request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bookingPayload(),
    }, 201);
    bookButton.disabled = false;
    if (outcome.kind !== 'ok') {
      showFailure(outcome);
      return;
    }
    titleInput.value = '';
    showError('');
    loadList();
  }

  async function cancelBooking(id, button) {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    const outcome = await request(`/api/bookings/${id}`, { method: 'DELETE' }, 204);
    button.disabled = false;
    if (outcome.kind === 'none') {
      showError(NO_REPLY);
      return;
    }
    showError(outcome.kind === 'ok' ? '' : outcome.message);
    loadList();
  }

  function showAll() {
    filterInput.value = '';
    loadList();
  }

  form.addEventListener('submit', submitBooking);
  filterInput.addEventListener('change', loadList);
  showAllButton.addEventListener('click', showAll);

  loadRooms();
  loadList();
})();
