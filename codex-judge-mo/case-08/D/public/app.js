(function () {
  'use strict';

  var UNREACHABLE = 'Could not reach the server.';
  var FAILED = 'Request failed.';

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

  function showError(message) {
    errorBox.textContent = message;
  }

  function errorMessage(data) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
      return data.error;
    }
    return FAILED;
  }

  // Resolves to { ok: true, data }, { ok: false, message } or { none: true }
  // once the reply and its body have arrived (or the request failed).
  function request(method, url, body) {
    var success = method === 'GET' ? 200 : method === 'POST' ? 201 : 204;
    var options = { method: method };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (res) {
      var status = res.status;
      if (status === 204) {
        return status === success ? { ok: true, data: null } : { ok: false, message: FAILED };
      }
      return res.json().then(function (data) {
        return status === success ? { ok: true, data: data } : { ok: false, message: errorMessage(data) };
      }, function () {
        return { none: true };
      });
    }, function () {
      return { none: true };
    });
  }

  function loadRooms() {
    request('GET', '/api/rooms').then(function (result) {
      if (result.none) {
        showError(UNREACHABLE);
      } else if (!result.ok) {
        showError(result.message);
      } else {
        var rooms = result.data && Array.isArray(result.data.rooms) ? result.data.rooms : [];
        var options = rooms.map(function (name) {
          var option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          return option;
        });
        roomSelect.replaceChildren.apply(roomSelect, options);
      }
    });
  }

  function cancelButton(booking) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Cancel';
    button.addEventListener('click', function () {
      if (button.disabled) return;
      button.disabled = true;
      request('DELETE', '/api/bookings/' + booking.id).then(function (result) {
        button.disabled = false;
        if (result.none) {
          showError(UNREACHABLE);
          return;
        }
        showError(result.ok ? '' : result.message);
        loadList();
      });
    });
    return button;
  }

  function render(bookings) {
    var items = bookings.map(function (b) {
      var li = document.createElement('li');
      li.append(b.date + ' ' + b.start + '-' + b.end + ' ' + b.room + ': ' + b.title, cancelButton(b));
      return li;
    });
    if (items.length === 0) {
      var empty = document.createElement('li');
      empty.append('No bookings.');
      items.push(empty);
    }
    list.replaceChildren.apply(list, items);
  }

  var listSeq = 0;
  function loadList() {
    var seq = ++listSeq;
    var url = filterDate.value === '' ? '/api/bookings' : '/api/bookings?date=' + filterDate.value;
    request('GET', url).then(function (result) {
      if (seq !== listSeq) return;
      if (result.none) {
        showError(UNREACHABLE);
      } else if (!result.ok) {
        showError(result.message);
      } else if (!result.data || !Array.isArray(result.data.bookings)) {
        showError(FAILED);
      } else {
        render(result.data.bookings);
      }
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (bookButton.disabled) return;
    bookButton.disabled = true;
    request('POST', '/api/bookings', {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value
    }).then(function (result) {
      bookButton.disabled = false;
      if (result.none) {
        showError(UNREACHABLE);
      } else if (!result.ok) {
        showError(result.message);
      } else {
        titleInput.value = '';
        showError('');
        loadList();
      }
    });
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
