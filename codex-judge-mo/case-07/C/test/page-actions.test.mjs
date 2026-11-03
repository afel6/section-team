import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/fake-dom.mjs';
import { NO_REPLY, FAILED, methodOf, spyOnText } from './helpers/page.mjs';

const ROOMS = { rooms: ['Aurora', 'Borealis', 'Cosmos'] };
const BOOKING = { id: 9, room: 'Cosmos', title: 'Team sync', date: '2026-11-03', start: '09:00', end: '10:00' };
const OTHER = { id: 8, room: 'Aurora', title: 'Other', date: '2026-11-03', start: '11:00', end: '12:00' };
const SEVEN = { ...OTHER, id: 7, title: 'Seven' };

const plain = (x) => JSON.parse(JSON.stringify(x));

async function boot(list = []) {
  const page = loadPage();
  page.calls[0].resolve(200, ROOMS);
  page.calls[1].resolve(200, { bookings: list });
  await page.flush();
  return page;
}

function fillForm(el) {
  el('room').value = 'Cosmos';
  el('title').value = '  Team sync  ';
  el('date').value = '2026-11-03';
  el('start').value = '09:00';
  el('end').value = '10:00';
}

// A fetch whose calls are controllable and which runs hook(call) at start.
function hookedFetch(hook) {
  const calls = [];
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    const call = {
      url, options,
      resolve: (status, body) => resolve({ status, json: () => Promise.resolve(body) }),
      reject: () => reject(new TypeError('fetch failed')),
    };
    calls.push(call);
    hook(call);
  });
  return { calls, fetchImpl };
}

async function bootHooked(hook, list = []) {
  const { calls, fetchImpl } = hookedFetch(hook);
  const page = loadPage({ fetchImpl });
  calls[0].resolve(200, ROOMS);
  calls[1].resolve(200, { bookings: list });
  await page.flush();
  return { ...page, calls };
}

const cancelButton = (el, i = 0) => el('booking-list').childNodes[i].childNodes[1];

describe('submit', () => {
  test('sends POST with raw values, disables Book, prevents default', async () => {
    const { calls, el } = await boot();
    fillForm(el);
    const ev = el('booking-form').dispatch('submit');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(el('book').disabled, true);
    assert.equal(calls.length, 3);
    const call = calls[2];
    assert.equal(call.url, '/api/bookings');
    assert.equal(call.options.method, 'POST');
    assert.deepEqual(plain(call.options.headers), { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(call.options.body), {
      room: 'Cosmos', title: '  Team sync  ', date: '2026-11-03', start: '09:00', end: '10:00',
    });
  });

  test('no client-side checks: empty fields still POST', async () => {
    const page = loadPage();
    page.calls[1].resolve(200, { bookings: [] });
    await page.flush();
    page.el('booking-form').dispatch('submit');
    assert.equal(page.calls.length, 3);
    assert.equal(methodOf(page.calls[2]), 'POST');
    assert.deepEqual(JSON.parse(page.calls[2].options.body),
      { room: '', title: '', date: '', start: '', end: '' });
  });

  test('second submit while the first is pending sends nothing', async () => {
    const { calls, el } = await boot();
    el('booking-form').dispatch('submit');
    const ev = el('booking-form').dispatch('submit');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(calls.length, 3);
  });

  test('submit with Book disabled sends nothing', async () => {
    const { calls, el } = await boot();
    el('book').disabled = true;
    const ev = el('booking-form').dispatch('submit');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(calls.length, 2);
  });
});

describe('submit outcomes', () => {
  const successCases = [
    ['no filter', '', '/api/bookings'],
    ['filter set', '2026-11-03', '/api/bookings?date=2026-11-03'],
  ];
  for (const [name, filter, url] of successCases) {
    test(`201 resets title, clears error, refetches list (${name})`, async () => {
      const { calls, el, flush } = await boot();
      fillForm(el);
      el('filter-date').value = filter;
      el('error').textContent = 'old';
      el('booking-form').dispatch('submit');
      calls[2].resolve(201, BOOKING);
      await flush();
      assert.equal(el('book').disabled, false);
      assert.equal(el('title').value, '');
      assert.equal(el('room').value, 'Cosmos');
      assert.equal(el('date').value, '2026-11-03');
      assert.equal(el('start').value, '09:00');
      assert.equal(el('end').value, '10:00');
      assert.equal(el('error').textContent, '');
      assert.equal(calls.length, 4);
      assert.equal(calls[3].url, url);
      assert.equal(methodOf(calls[3]), 'GET');
    });
  }

  const errorCases = [
    ['409 with message', 409, { error: 'room is already booked from 09:00 to 10:00' },
      'room is already booked from 09:00 to 10:00'],
    ['400 without message', 400, {}, FAILED],
    ['500 with non-string error', 500, { error: ['x'] }, FAILED],
    ['200 is not the POST success status', 200, {}, FAILED],
  ];
  for (const [name, status, body, message] of errorCases) {
    test(`error status: ${name}`, async () => {
      const { calls, el, flush } = await boot();
      fillForm(el);
      el('booking-form').dispatch('submit');
      calls[2].resolve(status, body);
      await flush();
      assert.equal(el('error').textContent, message);
      assert.equal(el('title').value, '  Team sync  ');
      assert.equal(calls.length, 3);
      assert.equal(el('book').disabled, false);
    });
  }

  const noReply = [
    ['reject', (c) => c.reject()],
    ['bad json on 201', (c) => c.resolveBadJson(201)],
  ];
  for (const [name, act] of noReply) {
    test(`no reply: ${name}`, async () => {
      const { calls, el, flush } = await boot();
      fillForm(el);
      el('booking-form').dispatch('submit');
      act(calls[2]);
      await flush();
      assert.equal(el('error').textContent, NO_REPLY);
      assert.equal(el('title').value, '  Team sync  ');
      assert.equal(calls.length, 3);
      assert.equal(el('book').disabled, false);
    });
  }
});

describe('Book re-enabled as soon as the request settles', () => {
  test('stays disabled until the body has arrived', async () => {
    const { calls, el, flush } = await boot();
    let release;
    const p = new Promise((r) => { release = r; });
    el('booking-form').dispatch('submit');
    calls[2].resolveWith({ status: 201, json: () => p });
    await flush();
    assert.equal(el('book').disabled, true);
    release(BOOKING);
    await flush();
    assert.equal(el('book').disabled, false);
  });

  test('enabled before the list refetch starts', async () => {
    const seen = [];
    let book;
    const page = await bootHooked((call) => {
      if (methodOf(call) === 'GET' && call.url === '/api/bookings') {
        seen.push(book.disabled);
      }
    });
    book = page.el('book');
    seen.length = 0;
    page.el('booking-form').dispatch('submit');
    page.calls[2].resolve(201, BOOKING);
    await page.flush();
    assert.deepEqual(seen, [false]);
  });

  test('enabled before #error is set on an error status', async () => {
    const { calls, el, flush } = await boot();
    const seen = [];
    spyOnText(el('error'), () => seen.push(el('book').disabled));
    el('booking-form').dispatch('submit');
    calls[2].resolve(409, { error: 'nope' });
    await flush();
    assert.deepEqual(seen, [false]);
    assert.equal(el('error').textContent, 'nope');
  });
});

describe('cancel', () => {
  test('click disables the button and sends DELETE', async () => {
    const { calls, el } = await boot([SEVEN, OTHER]);
    const btn = cancelButton(el, 0);
    btn.dispatch('click');
    assert.equal(btn.disabled, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, '/api/bookings/7');
    assert.equal(calls[2].options.method, 'DELETE');
  });

  test('204 enables button, clears error, refetches once, no json()', async () => {
    const { calls, el, flush } = await boot([SEVEN, OTHER]);
    el('error').textContent = 'old';
    const btn = cancelButton(el, 0);
    btn.dispatch('click');
    calls[2].resolve(204);
    await flush();
    assert.equal(btn.disabled, false);
    assert.equal(el('error').textContent, '');
    assert.equal(calls.length, 4);
    assert.equal(calls[3].url, '/api/bookings');
    assert.equal(methodOf(calls[3]), 'GET');
    assert.equal(calls[2].jsonCalls, 0);
  });

  const statusCases = [
    ['404 with message', 404, { error: 'booking not found' }, 'booking not found'],
    ['500 with string body', 500, 'x', FAILED],
  ];
  for (const [name, status, body, message] of statusCases) {
    test(`error status ${name} still refetches the list`, async () => {
      const { calls, el, flush } = await boot([SEVEN]);
      const btn = cancelButton(el, 0);
      btn.dispatch('click');
      calls[2].resolve(status, body);
      await flush();
      assert.equal(el('error').textContent, message);
      assert.equal(btn.disabled, false);
      assert.equal(calls.length, 4);
      assert.equal(calls[3].url, '/api/bookings');
    });
  }

  test('no reply shows message, enables button, no refetch', async () => {
    const { calls, el, flush } = await boot([SEVEN]);
    const btn = cancelButton(el, 0);
    btn.dispatch('click');
    calls[2].reject();
    await flush();
    assert.equal(el('error').textContent, NO_REPLY);
    assert.equal(btn.disabled, false);
    assert.equal(calls.length, 3);
  });

  test('reply that is not 204 and has no JSON body counts as no reply', async () => {
    const { calls, el, flush } = await boot([SEVEN]);
    const btn = cancelButton(el, 0);
    btn.dispatch('click');
    calls[2].resolveBadJson(404);
    await flush();
    assert.equal(el('error').textContent, NO_REPLY);
    assert.equal(btn.disabled, false);
    assert.equal(calls.length, 3);
  });

  test('status 200 with body {} (not 204) is an error status and refetches once', async () => {
    const { calls, el, flush } = await boot([SEVEN]);
    const btn = cancelButton(el, 0);
    btn.dispatch('click');
    calls[2].resolve(200, {});
    await flush();
    assert.equal(el('error').textContent, FAILED);
    assert.equal(btn.disabled, false);
    assert.equal(calls.length, 4);
    assert.equal(calls[3].url, '/api/bookings');
    assert.equal(methodOf(calls[3]), 'GET');
  });

  test('status 200 with an error message shows that message', async () => {
    const { calls, el, flush } = await boot([SEVEN]);
    cancelButton(el, 0).dispatch('click');
    calls[2].resolve(200, { error: 'x' });
    await flush();
    assert.equal(el('error').textContent, 'x');
    assert.equal(calls.length, 4);
  });

  test('button enabled before the list refetch starts', async () => {
    const seen = [];
    let btn;
    const page = await bootHooked((call) => {
      if (methodOf(call) === 'GET' && btn) seen.push(btn.disabled);
    }, [SEVEN]);
    btn = cancelButton(page.el, 0);
    btn.dispatch('click');
    page.calls[2].resolve(204);
    await page.flush();
    assert.deepEqual(seen, [false]);
  });

  test('button enabled before #error is set', async () => {
    const { calls, el, flush } = await boot([SEVEN]);
    const btn = cancelButton(el, 0);
    const seen = [];
    spyOnText(el('error'), () => seen.push(btn.disabled));
    btn.dispatch('click');
    calls[2].resolve(404, { error: 'booking not found' });
    await flush();
    assert.deepEqual(seen, [false]);
  });

  test('list refetch after cancel honours the filter', async () => {
    const { calls, el, flush } = await boot([SEVEN]);
    el('filter-date').value = '2026-11-04';
    cancelButton(el, 0).dispatch('click');
    calls[2].resolve(204);
    await flush();
    assert.equal(calls[3].url, '/api/bookings?date=2026-11-04');
  });
});
