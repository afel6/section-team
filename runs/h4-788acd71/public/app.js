// Room bookings page script. Classic script: runs its setup at once.
(function () {
  'use strict';

  const NO_REPLY = 'Could not reach the server.';
  const FALLBACK = 'Request failed.';

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

  let listGeneration = 0;

  // Sends a request. Resolves to { reached: false } when there is no usable
  // reply, else { reached: true, status, body }. A 204 body is never read.
  async function send(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch {
      return { reached: false };
    }
    if (res.status === 204) {
      return { reached: true, status: 204, body: null };
    }
    try {
      const body = await res.json();
      return { reached: true, status: res.status, body: body };
    } catch {
      return { reached: false };
    }
  }

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function errorMessage(body) {
    return isObject(body) && typeof body.error === 'string' ? body.error : FALLBACK;
  }

  function showError(text) {
    errorBox.textContent = text;
  }

  function showFailure(result) {
    showError(result.reached ? errorMessage(result.body) : NO_REPLY);
  }

  async function loadRooms() {
    const result = await send('/api/rooms', { method: 'GET' });
    if (!result.reached || result.status !== 200) {
      showFailure(result);
      return;
    }
    if (!isObject(result.body) || !Array.isArray(result.body.rooms)) {
      showError(FALLBACK);
      return;
    }
    const options = result.body.rooms.map(function (name) {
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
    cancel.addEventListener('click', function () {
      cancelBooking(booking.id, cancel);
    });
    const text = booking.date + ' ' + booking.start + '-' + booking.end + ' ' +
      booking.room + ': ' + booking.title;
    item.append(text, cancel);
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

  async function loadList() {
    listGeneration += 1;
    const generation = listGeneration;
    const filter = filterInput.value;
    const url = filter === '' ? '/api/bookings' : '/api/bookings?date=' + filter;
    const result = await send(url, { method: 'GET' });
    if (generation !== listGeneration) {
      return;
    }
    if (!result.reached || result.status !== 200) {
      showFailure(result);
      return;
    }
    if (!isObject(result.body) || !Array.isArray(result.body.bookings)) {
      showError(FALLBACK);
      return;
    }
    renderBookings(result.body.bookings);
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
    const result = await send('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    bookButton.disabled = false;
    if (result.reached && result.status === 201) {
      titleInput.value = '';
      showError('');
      loadList();
      return;
    }
    showFailure(result);
  }

  async function cancelBooking(id, button) {
    button.disabled = true;
    const result = await send('/api/bookings/' + id, { method: 'DELETE' });
    button.disabled = false;
    if (!result.reached) {
      showError(NO_REPLY);
      return;
    }
    if (result.status === 204) {
      showError('');
    } else {
      showError(errorMessage(result.body));
    }
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
