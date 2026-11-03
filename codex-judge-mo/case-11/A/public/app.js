'use strict';

(function bookingPage() {
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

  function showError(message) {
    errorBox.textContent = message;
  }

  function clearError() {
    errorBox.textContent = '';
  }

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function errorMessage(data) {
    return isPlainObject(data) && typeof data.error === 'string' ? data.error : FALLBACK_ERROR;
  }

  function buildOptions(method, payload) {
    if (payload === undefined) {
      return { method };
    }
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  }

  // Resolves to { status, data } or to null when there was no usable reply.
  // onSettle runs as soon as the reply and its body have arrived, or the request failed.
  async function request(method, url, payload, onSettle) {
    const settle = typeof onSettle === 'function' ? onSettle : () => {};
    let response;
    try {
      response = await fetch(url, buildOptions(method, payload));
    } catch {
      settle();
      return null;
    }
    const status = response.status;
    if (status === 204) {
      settle();
      return { status, data: null };
    }
    let data;
    try {
      data = await response.json();
    } catch {
      settle();
      return null;
    }
    settle();
    return { status, data };
  }

  function makeOption(name) {
    const option = document.createElement('option');
    option.value = String(name);
    option.textContent = String(name);
    return option;
  }

  async function loadRooms() {
    const reply = await request('GET', '/api/rooms');
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    const rooms = isPlainObject(reply.data) ? reply.data.rooms : undefined;
    if (reply.status !== 200 || !Array.isArray(rooms)) {
      showError(errorMessage(reply.data));
      return;
    }
    roomSelect.replaceChildren(...rooms.map(makeOption));
  }

  function bookingText(booking) {
    return `${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`;
  }

  function makeBookingItem(booking) {
    const item = document.createElement('li');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      cancelBooking(booking.id, cancelButton);
    });
    item.append(bookingText(booking), cancelButton);
    return item;
  }

  function renderList(bookings) {
    if (bookings.length === 0) {
      const empty = document.createElement('li');
      empty.append('No bookings.');
      bookingList.replaceChildren(empty);
      return;
    }
    bookingList.replaceChildren(...bookings.map(makeBookingItem));
  }

  function isBookingArray(value) {
    return Array.isArray(value) && value.every(isPlainObject);
  }

  async function loadList() {
    listSequence += 1;
    const sequence = listSequence;
    const filter = filterDate.value;
    const url = filter === '' ? '/api/bookings' : '/api/bookings?date=' + filter;
    const reply = await request('GET', url);
    if (sequence !== listSequence) {
      return;
    }
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    const bookings = isPlainObject(reply.data) ? reply.data.bookings : undefined;
    if (reply.status !== 200 || !isBookingArray(bookings)) {
      showError(errorMessage(reply.data));
      return;
    }
    renderList(bookings);
  }

  async function submitBooking() {
    bookButton.disabled = true;
    const payload = {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
    };
    const reply = await request('POST', '/api/bookings', payload, () => {
      bookButton.disabled = false;
    });
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    if (reply.status !== 201) {
      showError(errorMessage(reply.data));
      return;
    }
    titleInput.value = '';
    clearError();
    loadList();
  }

  async function cancelBooking(id, cancelButton) {
    if (cancelButton.disabled) {
      return;
    }
    cancelButton.disabled = true;
    const reply = await request('DELETE', '/api/bookings/' + id, undefined, () => {
      cancelButton.disabled = false;
    });
    if (reply === null) {
      showError(UNREACHABLE);
      return;
    }
    if (reply.status === 204) {
      clearError();
    } else {
      showError(errorMessage(reply.data));
    }
    loadList();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
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
