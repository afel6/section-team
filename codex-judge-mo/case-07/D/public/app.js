'use strict';

(function main() {
  const NO_REPLY = 'Could not reach the server.';
  const FALLBACK_ERROR = 'Request failed.';

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

  let latestListFetch = 0;

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function errorMessage(body) {
    return isPlainObject(body) && typeof body.error === 'string' ? body.error : FALLBACK_ERROR;
  }

  function showError(message) {
    errorBox.textContent = message;
  }

  // Resolves to { reached: false } when there is no usable reply,
  // otherwise to { reached: true, ok, body }. A 204 body is never read.
  async function request(url, options, successStatus) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      return { reached: false, cause: err };
    }
    if (response.status === 204) {
      return { reached: true, ok: successStatus === 204, body: null };
    }
    try {
      const body = await response.json();
      return { reached: true, ok: response.status === successStatus, body };
    } catch (err) {
      return { reached: false, cause: err };
    }
  }

  function bookingText(booking) {
    return `${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`;
  }

  function renderBooking(booking) {
    const item = document.createElement('li');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => cancelBooking(booking.id, cancel));
    item.append(bookingText(booking), cancel);
    return item;
  }

  function renderList(bookings) {
    if (bookings.length === 0) {
      const empty = document.createElement('li');
      empty.append('No bookings.');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...bookings.map(renderBooking));
  }

  function listUrl() {
    const date = filterInput.value;
    return date === '' ? '/api/bookings' : `/api/bookings?date=${date}`;
  }

  async function loadList() {
    latestListFetch += 1;
    const ticket = latestListFetch;
    const result = await request(listUrl(), undefined, 200);
    if (ticket !== latestListFetch) {
      return;
    }
    if (!result.reached) {
      showError(NO_REPLY);
    } else if (!result.ok) {
      showError(errorMessage(result.body));
    } else if (isPlainObject(result.body) && Array.isArray(result.body.bookings)
      && result.body.bookings.every(isPlainObject)) {
      renderList(result.body.bookings);
    } else {
      showError(FALLBACK_ERROR);
    }
  }

  async function loadRooms() {
    const result = await request('/api/rooms', undefined, 200);
    if (!result.reached) {
      showError(NO_REPLY);
    } else if (!result.ok) {
      showError(errorMessage(result.body));
    } else if (isPlainObject(result.body) && Array.isArray(result.body.rooms)) {
      const options = result.body.rooms.map((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        return option;
      });
      roomSelect.replaceChildren(...options);
    } else {
      showError(FALLBACK_ERROR);
    }
  }

  async function cancelBooking(id, button) {
    button.disabled = true;
    const result = await request(`/api/bookings/${id}`, { method: 'DELETE' }, 204);
    button.disabled = false;
    if (!result.reached) {
      showError(NO_REPLY);
      return;
    }
    showError(result.ok ? '' : errorMessage(result.body));
    loadList();
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
    const result = await request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 201);
    bookButton.disabled = false;
    if (!result.reached) {
      showError(NO_REPLY);
    } else if (!result.ok) {
      showError(errorMessage(result.body));
    } else {
      titleInput.value = '';
      showError('');
      loadList();
    }
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
