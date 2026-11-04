import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFields, compareBookings, findConflict, isValidDate, isValidTime } from '../lib/bookings.mjs'
import { booking } from './helpers.mjs'

test('isValidDate accepts real days from 2000-01-01 to 2099-12-31, leap days in years divisible by 4', () => {
  for (const d of ['2000-01-01', '2099-12-31', '2000-02-29', '2024-02-29', '2026-04-30', '2026-12-31']) {
    assert.equal(isValidDate(d), true, d)
  }
})

test('isValidDate rejects other strings and non-strings', () => {
  const bad = ['1999-12-31', '2100-01-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00',
    '2026-11-3', ' 2026-11-03', '2026-11-03 ', '2026-11-03\n', '2026/11/03', '٢٠٢٦-11-03', '', 20261103, null, undefined]
  for (const d of bad) assert.equal(isValidDate(d), false, JSON.stringify(d))
})

test('isValidTime accepts 00:00 to 23:59 written HH:MM only', () => {
  for (const t of ['00:00', '09:05', '23:59']) assert.equal(isValidTime(t), true, t)
  for (const t of ['24:00', '23:60', '9:00', '09:0', '09:00:00', ' 09:00', '0900', '', 900, null]) {
    assert.equal(isValidTime(t), false, JSON.stringify(t))
  }
})

test('checkFields applies rules 4 to 9 in order and trims only the title', () => {
  assert.deepEqual(checkFields(booking({ title: '  Plan \t', extra: 1 })).fields,
    { room: 'Aurora', title: 'Plan', date: '2026-11-03', start: '09:00', end: '10:00' })
  const cases = [
    [{ room: 'aurora', title: '' }, 'room must be one of Aurora, Borealis, Cosmos'],
    [{ room: undefined }, 'room must be one of Aurora, Borealis, Cosmos'],
    [{ title: '   ', date: 'x' }, 'title must be 1 to 80 characters'],
    [{ title: 42 }, 'title must be 1 to 80 characters'],
    [{ title: 'x'.repeat(81) }, 'title must be 1 to 80 characters'],
    [{ date: '2026-02-30', start: 'x' }, 'date must be a valid YYYY-MM-DD date'],
    [{ start: '24:00', end: 'x' }, 'start must be HH:MM'],
    [{ end: '9:30', start: '10:00' }, 'end must be HH:MM'],
    [{ start: '10:00', end: '10:00' }, 'end must be after start'],
    [{ start: '10:00', end: '09:59' }, 'end must be after start'],
  ]
  for (const [overrides, error] of cases) assert.deepEqual(checkFields(booking(overrides)), { error }, JSON.stringify(overrides))
  assert.equal(checkFields(booking({ title: ` ${'x'.repeat(80)} ` })).fields.title.length, 80)
})

test('findConflict ignores touching bookings, other rooms and other dates, and returns the earliest overlap', () => {
  const list = [
    { id: 1, ...booking({ start: '11:00', end: '12:00' }) },
    { id: 2, ...booking({ start: '09:00', end: '10:00' }) },
    { id: 3, ...booking({ room: 'Cosmos', start: '10:00', end: '11:00' }) },
    { id: 4, ...booking({ date: '2026-11-04', start: '10:00', end: '11:00' }) },
  ]
  assert.equal(findConflict(list, booking({ start: '10:00', end: '11:00' })), undefined)
  assert.equal(findConflict(list, booking({ start: '09:30', end: '11:30' })).id, 2)
  assert.equal(findConflict(list, booking({ start: '11:59', end: '12:30' })).id, 1)
  assert.equal(findConflict(list, booking({ start: '08:00', end: '13:00' })).id, 2)
})

test('compareBookings orders by date, then start, then room order', () => {
  const list = [
    booking({ room: 'Cosmos', start: '09:00' }), booking({ room: 'Aurora', start: '10:00' }),
    booking({ room: 'Borealis', start: '09:00' }), booking({ room: 'Aurora', date: '2026-11-02', start: '23:00' }),
  ]
  const order = list.toSorted(compareBookings).map(b => `${b.date} ${b.start} ${b.room}`)
  assert.deepEqual(order, ['2026-11-02 23:00 Aurora', '2026-11-03 09:00 Borealis', '2026-11-03 09:00 Cosmos', '2026-11-03 10:00 Aurora'])
})
