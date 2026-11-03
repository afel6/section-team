'use strict';

(function () {
  var NO_REPLY = 'Could not reach the server.';

  var form = document.getElementById('booking-form');
  var roomSelect = document.getElementById('room');
  var titleInput = document.getElementById('title');
  var dateInput = document.getElementById('date');
  var startInput = document.getElementById('start');
  var endInput = document.getElementById('end');
  var bookButton = document.getElementById('book');
  var filterDate = document.getElementById('filter-date');
  var showAll = document.getElementById('show-all');
  var list = document.getElementById('booking-list');
  var errorBox = document.getElementById('error');

  // Resolves to { status, data } or null when there is no usable reply.
  async function request(method, url, body) {
    var options = { method: method };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    try {
      var res = await fetch(url, options);
      if (res.status === 204) return { status: 204, data: null };
      var data = await res.json();
      return { status: res.status, data: data };
    } catch (err) {
      return null;
    }
  }

  function errorMessage(reply) {
    var data = reply.data;
    if (typeof data === 'object' && data !== null && !Array.isArray(data) && typeof data.error === 'string') {
      return data.error;
    }
    return 'Request failed.';
  }

  function showError(text) {
    errorBox.textContent = text;
  }

  async function loadRooms() {
    var reply = await request('GET', '/api/rooms');
    if (reply === null) return showError(NO_REPLY);
    if (reply.status !== 200) return showError(errorMessage(reply));
    var rooms = reply.data && Array.isArray(reply.data.rooms) ? reply.data.rooms : [];
    var options = rooms.map(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    });
    roomSelect.replaceChildren(...options);
  }

  function bookingItem(b) {
    var li = document.createElement('li');
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      cancelBooking(b.id, cancel);
    });
    li.append(b.date + ' ' + b.start + '-' + b.end + ' ' + b.room + ': ' + b.title, cancel);
    return li;
  }

  var listSeq = 0;

  async function loadList() {
    var seq = ++listSeq;
    var url = '/api/bookings';
    if (filterDate.value !== '') url += '?date=' + filterDate.value;
    var reply = await request('GET', url);
    if (seq !== listSeq) return;
    if (reply === null) return showError(NO_REPLY);
    if (reply.status !== 200) return showError(errorMessage(reply));
    var bookings = reply.data && Array.isArray(reply.data.bookings) ? reply.data.bookings : [];
    if (bookings.length === 0) {
      var empty = document.createElement('li');
      empty.append('No bookings.');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...bookings.map(bookingItem));
  }

  async function cancelBooking(id, button) {
    button.disabled = true;
    var reply = await request('DELETE', '/api/bookings/' + id);
    button.disabled = false;
    if (reply === null) return showError(NO_REPLY);
    showError(reply.status === 204 ? '' : errorMessage(reply));
    loadList();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (bookButton.disabled) return;
    bookButton.disabled = true;
    var reply = await request('POST', '/api/bookings', {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
    });
    bookButton.disabled = false;
    if (reply === null) return showError(NO_REPLY);
    if (reply.status !== 201) return showError(errorMessage(reply));
    titleInput.value = '';
    showError('');
    loadList();
  });

  filterDate.addEventListener('change', function () {
    loadList();
  });

  showAll.addEventListener('click', function () {
    filterDate.value = '';
    loadList();
  });

  loadRooms();
  loadList();
})();
