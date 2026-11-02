(function () {
  'use strict';

  var NO_REPLY = 'Could not reach the server.';
  var FALLBACK = 'Request failed.';

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

  var listSequence = 0;

  // Resolves to { reached: false } when there is no usable reply, otherwise
  // { reached: true, status, body }. A 204 body is never read; any other body
  // that cannot be read or parsed as JSON counts as no reply.
  async function request(url, options) {
    var reply;
    try {
      reply = await fetch(url, options);
    } catch {
      return { reached: false };
    }
    if (reply.status === 204) {
      return { reached: true, status: 204, body: null };
    }
    try {
      return { reached: true, status: reply.status, body: await reply.json() };
    } catch {
      return { reached: false };
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // The array under `key` of a 200 reply, or null when the reply is not one.
  function arrayFrom(outcome, key) {
    var ok = outcome.reached && outcome.status === 200 &&
      isPlainObject(outcome.body) && Array.isArray(outcome.body[key]);
    return ok ? outcome.body[key] : null;
  }

  function errorMessage(body) {
    return isPlainObject(body) && typeof body.error === 'string' ? body.error : FALLBACK;
  }

  function showError(text) {
    errorBox.textContent = text;
  }

  function showOutcomeError(outcome) {
    showError(outcome.reached ? errorMessage(outcome.body) : NO_REPLY);
  }

  function listUrl() {
    var date = filterInput.value;
    return date === '' ? '/api/bookings' : '/api/bookings?date=' + date;
  }

  function bookingText(booking) {
    return booking.date + ' ' + booking.start + '-' + booking.end + ' ' +
      booking.room + ': ' + booking.title;
  }

  function bookingItem(booking) {
    var item = document.createElement('li');
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      cancelBooking(booking.id, cancel);
    });
    item.append(bookingText(booking), cancel);
    return item;
  }

  function renderList(bookings) {
    if (bookings.length === 0) {
      var empty = document.createElement('li');
      empty.append('No bookings.');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...bookings.map(bookingItem));
  }

  async function loadList() {
    listSequence += 1;
    var mine = listSequence;
    var outcome = await request(listUrl());
    if (mine !== listSequence) {
      return;
    }
    var bookings = arrayFrom(outcome, 'bookings');
    if (bookings) {
      renderList(bookings);
      return;
    }
    showOutcomeError(outcome);
  }

  function roomOption(name) {
    var option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }

  async function loadRooms() {
    var outcome = await request('/api/rooms');
    var rooms = arrayFrom(outcome, 'rooms');
    if (rooms) {
      roomSelect.replaceChildren(...rooms.map(roomOption));
      return;
    }
    showOutcomeError(outcome);
  }

  function bookingPayload() {
    return JSON.stringify({
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value
    });
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
    bookButton.disabled = true;
    var outcome = await request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bookingPayload()
    });
    bookButton.disabled = false;
    if (outcome.reached && outcome.status === 201) {
      titleInput.value = '';
      showError('');
      loadList();
      return;
    }
    showOutcomeError(outcome);
  }

  async function cancelBooking(id, button) {
    button.disabled = true;
    var outcome = await request('/api/bookings/' + id, { method: 'DELETE' });
    button.disabled = false;
    if (!outcome.reached) {
      showError(NO_REPLY);
      return;
    }
    showError(outcome.status === 204 ? '' : errorMessage(outcome.body));
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
}());
