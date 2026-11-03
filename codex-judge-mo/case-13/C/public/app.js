// Room bookings page script. Classic script: runs its setup at once.
(function () {
  'use strict';

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

  // Resolves to { status, body } or to null when there is no usable reply.
  // A 204 body is never read; any other body must parse as JSON.
  async function request(url, options) {
    try {
      const res = await fetch(url, options);
      const status = res.status;
      if (status === 204) {
        return { status, body: undefined };
      }
      const body = await res.json();
      return { status, body };
    } catch {
      // Network failure or unreadable body: both count as no reply.
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
    return REQUEST_FAILED;
  }

  function showError(text) {
    errorBox.textContent = text;
  }

  function bookingText(booking) {
    return booking.date + ' ' + booking.start + '-' + booking.end + ' ' +
      booking.room + ': ' + booking.title;
  }

  function bookingItem(booking) {
    const item = document.createElement('li');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      cancelBooking(booking.id, cancel);
    });
    item.append(bookingText(booking), cancel);
    return item;
  }

  function emptyItem() {
    const item = document.createElement('li');
    item.append('No bookings.');
    return item;
  }

  function renderBookings(bookings) {
    const items = bookings.length === 0 ? [emptyItem()] : bookings.map(bookingItem);
    list.replaceChildren(...items);
  }

  function listUrl() {
    const date = filterInput.value;
    return date === '' ? '/api/bookings' : '/api/bookings?date=' + date;
  }

  // Only the outcome of the last list fetch started is used.
  async function loadList() {
    listSequence += 1;
    const sequence = listSequence;
    const reply = await request(listUrl(), { method: 'GET' });
    if (sequence !== listSequence) {
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
    const bookings = isPlainObject(reply.body) ? reply.body.bookings : undefined;
    if (!Array.isArray(bookings)) {
      showError(REQUEST_FAILED);
      return;
    }
    renderBookings(bookings);
  }

  async function loadRooms() {
    const reply = await request('/api/rooms', { method: 'GET' });
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    if (reply.status !== 200) {
      showError(errorMessage(reply.body));
      return;
    }
    const rooms = isPlainObject(reply.body) ? reply.body.rooms : undefined;
    if (!Array.isArray(rooms)) {
      showError(REQUEST_FAILED);
      return;
    }
    const options = rooms.map(function (name) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    });
    roomSelect.append(...options);
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
    const reply = await request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    const reply = await request('/api/bookings/' + id, { method: 'DELETE' });
    button.disabled = false;
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    showError(reply.status === 204 ? '' : errorMessage(reply.body));
    loadList();
  }

  form.addEventListener('submit', submitBooking);
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
