// The page: its HTML, and public/app.js run against a fake DOM and a fetch whose replies each test controls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PAGE_HTML, PUBLIC, listItems, loadPage, settle } from './fake-dom.mjs'

const ROOMS = ['Aurora', 'Borealis', 'Cosmos']
const NO_REPLY = 'Could not reach the server.'
const B1 = { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' }
const B2 = { id: 7, room: 'Cosmos', title: '<b>x</b>', date: '2026-11-04', start: '13:00', end: '14:30' }
const line = b => [`${b.date} ${b.start}-${b.end} ${b.room}: ${b.title}`, '<BUTTON button>Cancel']

// A loaded page whose rooms and first list replies have arrived.
async function readyPage(bookings = [B1]) {
  const page = loadPage()
  page.calls[0].reply(200, { rooms: ROOMS })
  page.calls[1].reply(200, { bookings })
  await settle()
  return page
}

const requests = calls => calls.map(c => `${c.method} ${c.url}`)

test('the HTML holds the required elements, no inline code, no room names and no options', () => {
  const html = PAGE_HTML
  assert.match(html, /<title>Room bookings<\/title>/)
  assert.equal(html.match(/<h1[\s>]/g).length, 1)
  assert.match(html, /<h1>Room bookings<\/h1>/)
  assert.match(html, /<form id="booking-form" novalidate>/)
  assert.match(html, /<script src="\/app\.js"><\/script>\s*<\/body>/)
  assert.equal(html.match(/<script/g).length, 1)
  assert.doesNotMatch(html, /\son[a-z]+=/i)
  assert.doesNotMatch(html, /<option|Aurora|Borealis|Cosmos/)
  const labels = { room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End', 'filter-date': 'Show date' }
  for (const [id, text] of Object.entries(labels)) assert.match(html, new RegExp(`<label for="${id}">${text}</label>`))
  for (const tag of ['<select id="room" name="room">', '<input type="text" id="title" name="title">', '<input type="date" id="date" name="date">',
    '<input type="time" id="start" name="start">', '<input type="time" id="end" name="end">', '<button type="submit" id="book">Book</button>',
    '<input type="date" id="filter-date">', '<button type="button" id="show-all">Show all</button>', '<ul id="booking-list">',
    '<p id="error" role="alert"></p>']) assert.ok(html.includes(tag), tag)
  const script = readFileSync(join(PUBLIC, 'app.js'), 'utf8')
  for (const text of [html, script]) assert.doesNotMatch(text, /https?:\/\//)
  assert.doesNotMatch(script, /^\s*(import|export)\b/m)
})

test('on load: rooms and the list are requested at once, then filled', async () => {
  const { el, calls } = loadPage()
  assert.deepEqual(requests(calls), ['GET /api/rooms', 'GET /api/bookings'])
  calls[1].reply(200, { bookings: [B1, B2] })
  await settle()
  assert.deepEqual(listItems(el['booking-list']), [line(B1), line(B2)], 'the list does not wait for the rooms')
  calls[0].reply(200, { rooms: ROOMS })
  await settle()
  assert.deepEqual(el.room.childNodes.map(o => [o.tagName, o.value, o.textContent]), ROOMS.map(r => ['OPTION', r, r]))
  assert.equal(el.error.textContent, '')
})

test('an empty list shows one "No bookings." item', async () => {
  const { el } = await readyPage([])
  assert.deepEqual(listItems(el['booking-list']), [['No bookings.']])
})

test('rooms: an error status shows its message or "Request failed."; no reply shows the network message', async () => {
  for (const [reply, message] of [[c => c.reply(500, { error: 'internal error' }), 'internal error'],
    [c => c.reply(404, { error: 7 }), 'Request failed.'], [c => c.reply(503, 'not json'), NO_REPLY], [c => c.fail(), NO_REPLY]]) {
    const { el, calls } = loadPage()
    reply(calls[0])
    await settle()
    assert.equal(el.error.textContent, message)
    assert.deepEqual(el.room.childNodes, [])
  }
})

test('booking: POST with the five values unchanged, Book disabled until the reply, then title cleared and list fetched', async () => {
  const { el, calls } = await readyPage()
  for (const [id, value] of [['room', 'Cosmos'], ['title', '  Plan  '], ['date', '2026-11-04'], ['start', '13:00'], ['end', '14:30']]) el[id].value = value
  el.error.textContent = 'old'
  assert.equal(el['booking-form'].dispatch('submit'), true, 'preventDefault is called')
  assert.equal(el.book.disabled, true)
  const post = calls[2]
  assert.equal(`${post.method} ${post.url}`, 'POST /api/bookings')
  assert.deepEqual({ ...post.headers }, { 'Content-Type': 'application/json' }, 'the script made the object in its own realm')
  assert.deepEqual(JSON.parse(post.body), { room: 'Cosmos', title: '  Plan  ', date: '2026-11-04', start: '13:00', end: '14:30' })
  assert.equal(el['booking-form'].dispatch('submit'), true)
  assert.equal(calls.length, 3, 'a submit while Book is disabled sends nothing')
  post.reply(201, B2)
  await settle()
  assert.equal(el.book.disabled, false)
  assert.deepEqual([el.title.value, el.date.value, el.error.textContent], ['', '2026-11-04', ''])
  assert.deepEqual(requests(calls.slice(3)), ['GET /api/bookings'])
  calls[3].reply(200, { bookings: [B1, B2] })
  await settle()
  assert.deepEqual(listItems(el['booking-list']), [line(B1), line(B2)])
})

test('booking: an error reply or no reply shows the message and keeps the form and the list', async () => {
  for (const [reply, message] of [[c => c.reply(409, { error: 'room is already booked from 09:00 to 10:00' }), 'room is already booked from 09:00 to 10:00'],
    [c => c.reply(400, ['x']), 'Request failed.'], [c => c.fail(), NO_REPLY], [c => c.reply(201, 'broken'), NO_REPLY]]) {
    const { el, calls } = await readyPage()
    el.title.value = 'Keep me'
    el['booking-form'].dispatch('submit')
    reply(calls[2])
    await settle()
    assert.deepEqual([el.book.disabled, el.title.value, el.error.textContent], [false, 'Keep me', message])
    assert.equal(calls.length, 3, 'the list is not fetched again')
    assert.deepEqual(listItems(el['booking-list']), [line(B1)])
  }
})

test('cancel: DELETE for its booking, the button is disabled until the reply, then the list is fetched again', async () => {
  for (const [status, body, message] of [[204, undefined, ''], [404, { error: 'booking not found' }, 'booking not found']]) {
    const { el, calls } = await readyPage([B1, B2])
    el.error.textContent = 'old'
    const button = el['booking-list'].childNodes[1].childNodes[1]
    button.dispatch('click')
    assert.equal(button.disabled, true)
    assert.deepEqual(requests(calls.slice(2)), ['DELETE /api/bookings/7'])
    button.dispatch('click')
    assert.equal(calls.length, 3, 'a disabled Cancel sends nothing')
    calls[2].reply(status, body)
    await settle()
    assert.deepEqual([button.disabled, el.error.textContent], [false, message])
    assert.deepEqual(requests(calls.slice(3)), ['GET /api/bookings'])
  }
})

test('cancel with no reply shows the network message and does not fetch the list', async () => {
  const { el, calls } = await readyPage()
  const button = el['booking-list'].childNodes[0].childNodes[1]
  button.dispatch('click')
  calls[2].fail()
  await settle()
  assert.deepEqual([button.disabled, el.error.textContent, calls.length], [false, NO_REPLY, 3])
})

test('filter: change fetches with ?date=<value> unchanged, input does nothing, Show all clears and fetches once', async () => {
  const { el, calls } = await readyPage()
  el['filter-date'].value = '2026-11-04'
  el['filter-date'].dispatch('input')
  assert.equal(calls.length, 2)
  el['filter-date'].dispatch('change')
  el['filter-date'].value = 'a b&c'
  el['filter-date'].dispatch('change')
  el['show-all'].dispatch('click')
  assert.equal(el['filter-date'].value, '')
  assert.deepEqual(requests(calls.slice(2)), ['GET /api/bookings?date=2026-11-04', 'GET /api/bookings?date=a b&c', 'GET /api/bookings'])
})

test('list fetches: errors keep the list, success keeps #error, and only the last fetch started counts', async () => {
  const { el, calls } = await readyPage()
  el['filter-date'].dispatch('change')
  calls[2].reply(400, { error: 'date must be a valid YYYY-MM-DD date' })
  await settle()
  assert.equal(el.error.textContent, 'date must be a valid YYYY-MM-DD date')
  assert.deepEqual(listItems(el['booking-list']), [line(B1)])
  el['filter-date'].dispatch('change')
  el['filter-date'].dispatch('change')
  calls[4].reply(200, { bookings: [B2] })
  await settle()
  assert.equal(el.error.textContent, 'date must be a valid YYYY-MM-DD date', 'a successful fetch leaves #error alone')
  calls[3].fail()
  await settle()
  assert.deepEqual([el.error.textContent, listItems(el['booking-list'])], ['date must be a valid YYYY-MM-DD date', [line(B2)]])
})

test('earlier list replies arriving after the last one change neither the list nor #error', async () => {
  const { el, calls } = loadPage()
  el['filter-date'].dispatch('change')
  el['filter-date'].dispatch('change')
  assert.deepEqual(requests(calls), ['GET /api/rooms', ...Array(3).fill('GET /api/bookings')])
  calls[3].reply(200, { bookings: [B2] })
  await settle()
  calls[1].reply(200, { bookings: [B1] })
  await settle()
  assert.deepEqual([listItems(el['booking-list']), el.error.textContent], [[line(B2)], ''], 'an earlier success')
  calls[2].reply(500, { error: 'internal error' })
  await settle()
  assert.deepEqual([listItems(el['booking-list']), el.error.textContent], [[line(B2)], ''], 'an earlier error status')
  el['filter-date'].dispatch('change')
  el['filter-date'].dispatch('change')
  calls[5].reply(200, { bookings: [] })
  await settle()
  calls[4].fail()
  await settle()
  assert.deepEqual([listItems(el['booking-list']), el.error.textContent], [[['No bookings.']], ''])
})
