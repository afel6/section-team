// near-miss: POST header extended with a charset
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
  const filterDate = document.getElementById('filter-date');
  const showAllButton = document.getElementById('show-all');
  const bookingList = document.getElementById('booking-list');
  const errorBox = document.getElementById('error');

  let latestListRequest = 0;

  // Resolves to { status, body } or to null when there is no usable reply.
  // onSettle runs as soon as the reply and its body have arrived, or the
  // request failed, before the caller sees the outcome.
  async function send(url, options, onSettle) {
    try {
      const response = await fetch(url, options);
      if (response.status === 204) {
        return { status: 204, body: undefined };
      }
      const body = await response.json();
      return { status: response.status, body: body };
    } catch {
      // fetch rejected, or a non-204 body was not readable JSON: no reply.
      return null;
    } finally {
      if (onSettle) {
        onSettle();
      }
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

  function createOption(room) {
    const option = document.createElement('option');
    option.value = room;
    option.textContent = room;
    return option;
  }

  async function loadRooms() {
    const reply = await send('/api/rooms', { method: 'GET' });
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    if (reply.status !== 200) {
      showError(errorMessage(reply.body));
      return;
    }
    if (!isPlainObject(reply.body) || !Array.isArray(reply.body.rooms)) {
      showError(REQUEST_FAILED);
      return;
    }
    roomSelect.replaceChildren(...reply.body.rooms.map(createOption));
  }

  function bookingText(booking) {
    return booking.date + ' ' + booking.start + '-' + booking.end + ' ' +
      booking.room + ': ' + booking.title;
  }

  function createBookingItem(booking) {
    const item = document.createElement('li');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function () {
      cancelBooking(booking.id, cancelButton);
    });
    item.append(bookingText(booking), cancelButton);
    return item;
  }

  function createEmptyItem() {
    const item = document.createElement('li');
    item.append('No bookings.');
    return item;
  }

  function listUrl() {
    const date = filterDate.value;
    return date === '' ? '/api/bookings' : '/api/bookings?date=' + date;
  }

  async function loadList() {
    latestListRequest += 1;
    const requestNumber = latestListRequest;
    const reply = await send(listUrl(), { method: 'GET' });
    if (requestNumber !== latestListRequest) {
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
    if (!isPlainObject(reply.body) || !Array.isArray(reply.body.bookings) ||
        !reply.body.bookings.every(isPlainObject)) {
      showError(REQUEST_FAILED);
      return;
    }
    const bookings = reply.body.bookings;
    const items = bookings.length === 0
      ? [createEmptyItem()]
      : bookings.map(createBookingItem);
    bookingList.replaceChildren(...items);
  }

  async function cancelBooking(id, cancelButton) {
    cancelButton.disabled = true;
    const reply = await send('/api/bookings/' + id, { method: 'DELETE' }, function () {
      cancelButton.disabled = false;
    });
    if (reply === null) {
      showError(NO_REPLY);
      return;
    }
    showError(reply.status === 204 ? '' : errorMessage(reply.body));
    loadList();
  }

  function bookingPayload() {
    return {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value
    };
  }

  async function submitBooking() {
    bookButton.disabled = true;
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(bookingPayload())
    };
    const reply = await send('/api/bookings', options, function () {
      bookButton.disabled = false;
    });
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

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
    submitBooking();
  });

  filterDate.addEventListener('change', function () {
    loadList();
  });

  showAllButton.addEventListener('click', function () {
    filterDate.value = '';
    loadList();
  });

  loadRooms();
  loadList();
}());
