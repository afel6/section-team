// near-miss: Book re-enabled after the list refetch on 201
// Room bookings page script. Classic script: sets up at once, no load event.
// Uses only: fetch (method/headers/body, status, json()), document.getElementById,
// document.createElement, and element textContent/value/type/disabled/append/
// replaceChildren/addEventListener, plus event.preventDefault.
(function () {
  'use strict';

  const UNREACHABLE = 'Could not reach the server.';
  const FALLBACK_ERROR = 'Request failed.';

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

  let listSequence = 0;

  // Resolves to { status, body } or to null when there is no usable reply
  // (fetch failed, or a non-204 body could not be read as JSON).
  async function send(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      return null;
    }
    const status = response.status;
    if (status === 204) {
      return { status, body: null };
    }
    try {
      const body = await response.json();
      return { status, body };
    } catch {
      return null;
    }
  }

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function errorMessage(body) {
    if (isPlainObject(body) && typeof body.error === 'string') {
      return body.error;
    }
    return FALLBACK_ERROR;
  }

  function showError(message) {
    errorBox.textContent = message;
  }

  function createOption(name) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }

  async function loadRooms() {
    const reply = await send('/api/rooms', { method: 'GET' });
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    if (reply.status !== 200) {
      showError(errorMessage(reply.body));
      return;
    }
    const rooms = isPlainObject(reply.body) ? reply.body.rooms : undefined;
    if (!Array.isArray(rooms)) {
      showError(FALLBACK_ERROR);
      return;
    }
    roomSelect.replaceChildren(...rooms.map(createOption));
  }

  function createBookingItem(booking) {
    const item = document.createElement('li');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      cancelBooking(booking.id, cancelButton);
    });
    item.append(`${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`);
    item.append(cancelButton);
    return item;
  }

  function createEmptyItem() {
    const item = document.createElement('li');
    item.append('No bookings.');
    return item;
  }

  function renderList(bookings) {
    const items = bookings.length === 0
      ? [createEmptyItem()]
      : bookings.map(createBookingItem);
    bookingList.replaceChildren(...items);
  }

  function listUrl() {
    const filter = filterDate.value;
    return filter === '' ? '/api/bookings' : '/api/bookings?date=' + filter;
  }

  // Only the outcome of the most recently started list fetch is used.
  async function loadList() {
    listSequence += 1;
    const sequence = listSequence;
    const reply = await send(listUrl(), { method: 'GET' });
    if (sequence !== listSequence) {
      return;
    }
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    if (reply.status !== 200) {
      showError(errorMessage(reply.body));
      return;
    }
    const bookings = isPlainObject(reply.body) ? reply.body.bookings : undefined;
    if (!Array.isArray(bookings) || !bookings.every(isPlainObject)) {
      showError(FALLBACK_ERROR);
      return;
    }
    renderList(bookings);
  }

  async function submitBooking() {
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
    const reply = await send('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (reply === null) {
      bookButton.disabled = false;
      showError(UNREACHABLE);
      return;
    }
    if (reply.status !== 201) {
      bookButton.disabled = false;
      showError(errorMessage(reply.body));
      return;
    }
    titleInput.value = '';
    showError('');
    loadList();
    bookButton.disabled = false;
  }

  async function cancelBooking(id, button) {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    const reply = await send('/api/bookings/' + id, { method: 'DELETE' });
    button.disabled = false;
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    showError(reply.status === 204 ? '' : errorMessage(reply.body));
    loadList();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitBooking();
  });

  filterDate.addEventListener('change', () => {
    loadList();
  });

  showAllButton.addEventListener('click', () => {
    filterDate.value = '';
    loadList();
  });

  loadRooms();
  loadList();
})();
