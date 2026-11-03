// Room bookings page script. Classic script: runs its setup at once.
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

  var listSeq = 0;

  function showError(text) {
    errorBox.textContent = text;
  }

  function errorMessage(body) {
    var isObject = body !== null && typeof body === 'object' && !Array.isArray(body);
    return isObject && typeof body.error === 'string' ? body.error : FALLBACK;
  }

  // Resolves to { reply: false } when there is no usable reply, otherwise
  // { reply: true, ok, body }. A 204 body is never read.
  function request(url, options, successStatus) {
    return fetch(url, options).then(function (res) {
      if (res.status === 204) {
        return { reply: true, ok: successStatus === 204, body: null };
      }
      return res.json().then(function (body) {
        return { reply: true, ok: res.status === successStatus, body: body };
      });
    }).then(null, function () {
      return { reply: false };
    });
  }

  function outcomeError(outcome) {
    return outcome.reply ? errorMessage(outcome.body) : NO_REPLY;
  }

  function loadRooms() {
    request('/api/rooms', { method: 'GET' }, 200).then(function (outcome) {
      if (!outcome.ok) {
        showError(outcomeError(outcome));
        return;
      }
      var rooms = outcome.body && Array.isArray(outcome.body.rooms) ? outcome.body.rooms : [];
      roomSelect.replaceChildren.apply(roomSelect, rooms.map(function (name) {
        var option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        return option;
      }));
    });
  }

  function bookingItem(booking) {
    var li = document.createElement('li');
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      cancelBooking(cancel, booking.id);
    });
    li.append(
      booking.date + ' ' + booking.start + '-' + booking.end + ' ' +
        booking.room + ': ' + booking.title,
      cancel
    );
    return li;
  }

  function renderBookings(bookings) {
    if (bookings.length === 0) {
      var empty = document.createElement('li');
      empty.append('No bookings.');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren.apply(list, bookings.map(bookingItem));
  }

  function loadList() {
    listSeq += 1;
    var seq = listSeq;
    var filter = filterInput.value;
    var url = filter === '' ? '/api/bookings' : '/api/bookings?date=' + filter;
    request(url, { method: 'GET' }, 200).then(function (outcome) {
      if (seq !== listSeq) {
        return;
      }
      if (!outcome.ok) {
        showError(outcomeError(outcome));
        return;
      }
      var bookings = outcome.body && Array.isArray(outcome.body.bookings) ? outcome.body.bookings : [];
      renderBookings(bookings);
    });
  }

  function cancelBooking(button, id) {
    button.disabled = true;
    request('/api/bookings/' + id, { method: 'DELETE' }, 204).then(function (outcome) {
      button.disabled = false;
      if (!outcome.reply) {
        showError(NO_REPLY);
        return;
      }
      showError(outcome.ok ? '' : errorMessage(outcome.body));
      loadList();
    });
  }

  function submitBooking(event) {
    event.preventDefault();
    if (bookButton.disabled) {
      return;
    }
    bookButton.disabled = true;
    var payload = {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value
    };
    request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 201).then(function (outcome) {
      bookButton.disabled = false;
      if (!outcome.ok) {
        showError(outcomeError(outcome));
        return;
      }
      titleInput.value = '';
      showError('');
      loadList();
    });
  }

  form.addEventListener('submit', submitBooking);
  filterInput.addEventListener('change', loadList);
  showAllButton.addEventListener('click', function () {
    filterInput.value = '';
    loadList();
  });

  loadRooms();
  loadList();
})();
