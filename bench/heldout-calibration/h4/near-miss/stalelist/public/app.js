// The booking page's script: a classic script that sets itself up at once. Values are only ever set as
// text (textContent, value or text nodes), never as HTML.
(() => {
  'use strict'
  const NO_REPLY = 'Could not reach the server.'
  const REQUEST_FAILED = 'Request failed.'
  const byId = id => document.getElementById(id)
  const form = byId('booking-form')
  const roomSelect = byId('room')
  const titleInput = byId('title')
  const dateInput = byId('date')
  const startInput = byId('start')
  const endInput = byId('end')
  const bookButton = byId('book')
  const filterInput = byId('filter-date')
  const showAllButton = byId('show-all')
  const bookingList = byId('booking-list')
  const errorBox = byId('error')

  // One request. Resolves to { status, body } (no body for a 204), or null when no usable reply came:
  // the request failed, or a reply other than a 204 had a body that could not be read as JSON.
  async function request(method, url, payload) {
    const init = { method }
    if (payload !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(payload)
    }
    try {
      const reply = await fetch(url, init)
      const body = reply.status === 204 ? undefined : await reply.json()
      return { status: reply.status, body }
    } catch {
      return null
    }
  }

  function errorMessage(reply) {
    const body = reply.body
    const isObject = body !== null && typeof body === 'object' && !Array.isArray(body)
    return isObject && typeof body.error === 'string' ? body.error : REQUEST_FAILED
  }

  function showError(text) {
    errorBox.textContent = text
  }

  function roomOption(name) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    return option
  }

  async function loadRooms() {
    const reply = await request('GET', '/api/rooms')
    if (reply === null) return showError(NO_REPLY)
    if (reply.status !== 200) return showError(errorMessage(reply))
    roomSelect.append(...reply.body.rooms.map(roomOption))
  }

  function bookingItem(booking) {
    const item = document.createElement('li')
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => cancelBooking(booking.id, cancel))
    item.append(`${booking.date} ${booking.start}-${booking.end} ${booking.room}: ${booking.title}`, cancel)
    return item
  }

  function renderList(bookings) {
    if (bookings.length > 0) return bookingList.replaceChildren(...bookings.map(bookingItem))
    const empty = document.createElement('li')
    empty.append('No bookings.')
    bookingList.replaceChildren(empty)
  }

  // Only the outcome of the most recently started list fetch is used.
  async function loadList() {
    const date = filterInput.value
    const reply = await request('GET', date === '' ? '/api/bookings' : `/api/bookings?date=${date}`)
    if (reply === null) return showError(NO_REPLY)
    if (reply.status !== 200) return showError(errorMessage(reply))
    renderList(reply.body.bookings)
  }

  async function submitBooking(event) {
    event.preventDefault()
    if (bookButton.disabled) return
    bookButton.disabled = true
    const reply = await request('POST', '/api/bookings', {
      room: roomSelect.value,
      title: titleInput.value,
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
    })
    bookButton.disabled = false
    if (reply === null) return showError(NO_REPLY)
    if (reply.status !== 201) return showError(errorMessage(reply))
    titleInput.value = ''
    showError('')
    loadList()
  }

  async function cancelBooking(id, button) {
    if (button.disabled) return
    button.disabled = true
    const reply = await request('DELETE', `/api/bookings/${id}`)
    button.disabled = false
    if (reply === null) return showError(NO_REPLY)
    showError(reply.status === 204 ? '' : errorMessage(reply))
    loadList()
  }

  form.addEventListener('submit', submitBooking)
  filterInput.addEventListener('change', () => {
    loadList()
  })
  showAllButton.addEventListener('click', () => {
    filterInput.value = ''
    loadList()
  })
  loadRooms()
  loadList()
})()
