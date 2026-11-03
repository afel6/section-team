'use strict';

(function () {
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

  let listSeq = 0;

  function showError(message) {
    errorBox.textContent = message;
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function errorMessage(body) {
    return isObject(body) && typeof body.error === 'string' ? body.error : REQUEST_FAILED;
  }

  // Resolves to null when there is no usable reply (network failure, or a
  // non-204 body that is not JSON); otherwise to { status, body }.
  async function request(method, url, payload) {
    const options = payload === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    try {
      const res = await fetch(url, options);
      if (res.status === 204) {
        return { status: 204, body: undefined };
      }
      const body = await res.json();
      return { status: res.status, body };
    } catch {
      return null;
    }
  }

  function renderRooms(rooms) {
    const options = rooms.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    });
    roomSelect.replaceChildren(...options);
  }

  async function loadRooms() {
    const reply = await request('GET', '/api/rooms');
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    if (reply.status !== 200) {
      showError(errorMessage(reply.body));
      return;
    }
    const rooms = isObject(reply.body) ? reply.body.rooms : undefined;
    if (!Array.isArray(rooms)) {
      showError(REQUEST_FAILED);
      return;
    }
    renderRooms(rooms);
  }

  function bookingItem(booking) {
    const li = document.createElement('li');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => cancelBooking(booking.id, cancel));
    li.append(
      `${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`,
      cancel
    );
    return li;
  }

  function renderBookings(bookings) {
    if (bookings.length === 0) {
      const empty = document.createElement('li');
      empty.append('No bookings.');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...bookings.map(bookingItem));
  }

  function listUrl() {
    const date = filterInput.value;
    return date === '' ? '/api/bookings' : `/api/bookings?date=${date}`;
  }

  async function loadList() {
    listSeq += 1;
    const requestSeq = listSeq;
    const reply = await request('GET', listUrl());
    if (requestSeq !== listSeq) {
      return;
    }
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    if (reply.status !== 200) {
      showError(errorMessage(reply.body));
      return;
    }
    const bookings = isObject(reply.body) ? reply.body.bookings : undefined;
    if (!Array.isArray(bookings) || !bookings.every(isObject)) {
      showError(REQUEST_FAILED);
      return;
    }
    renderBookings(bookings);
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
    bookButton.disabled = true;
    const reply = await request('POST', '/api/bookings', {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
    });
    bookButton.disabled = false;
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    if (reply.status !== 201) {
      showError(errorMessage(reply.body));
      return;
    }
    titleInput.value = '';
    showError('');
    loadList();
  }

  async function cancelBooking(id, button) {
    button.disabled = true;
    const reply = await request('DELETE', `/api/bookings/${id}`);
    button.disabled = false;
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    showError(reply.status === 204 ? '' : errorMessage(reply.body));
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
