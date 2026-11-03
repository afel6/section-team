import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, listTexts } from './helpers/fake-dom.mjs';
import { NO_REPLY, FAILED, methodOf } from './helpers/page.mjs';

const STANDUP = { id: 2, room: 'Cosmos', title: 'Standup', date: '2026-11-04', start: '09:00', end: '10:00' };
const HTML_TITLE = { id: 1, room: 'Aurora', title: '<b>x</b>', date: '2026-11-03', start: '13:00', end: '14:30' };
const XRAY = { id: 5, room: 'Borealis', title: 'Xray', date: '2026-11-05', start: '08:00', end: '09:00' };
const YANKEE = { id: 6, room: 'Aurora', title: 'Yankee', date: '2026-11-06', start: '10:00', end: '11:00' };
const X_TEXT = '2026-11-05 08:00-09:00 Borealis: Xray';

const texts = (page) => listTexts(page.el('booking-list')).map((r) => r.text);

async function changeFilter(page, value) {
  page.el('filter-date').value = value;
  page.el('filter-date').dispatch('change');
  await page.flush();
}

describe('initial requests', () => {
  test('rooms and list fetches both start synchronously', () => {
    const { calls } = loadPage();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, '/api/rooms');
    assert.equal(methodOf(calls[0]), 'GET');
    assert.equal(calls[1].url, '/api/bookings');
    assert.equal(methodOf(calls[1]), 'GET');
  });
});

describe('rooms', () => {
  test('fills #room with one option per room', async () => {
    const { calls, el, flush } = loadPage();
    const rooms = ['Aurora', 'Borealis', 'Cosmos'];
    calls[0].resolve(200, { rooms });
    await flush();
    const nodes = el('room').childNodes;
    assert.equal(nodes.length, 3);
    nodes.forEach((n, i) => {
      assert.equal(n.tagName, 'OPTION');
      assert.equal(n.value, rooms[i]);
      assert.equal(n.textContent, rooms[i]);
    });
    assert.equal(el('error').textContent, '');
  });

  const statusCases = [
    ['500 with error string', 500, { error: 'boom' }, 'boom'],
    ['404 with non-string error', 404, { error: 5 }, FAILED],
    ['500 with array body', 500, [], FAILED],
    ['500 with string body', 500, 'text', FAILED],
    ['500 with null body', 500, null, FAILED],
    ['201 for a GET', 201, { rooms: ['Aurora'] }, FAILED],
    ['204 for a GET (json() skipped)', 204, undefined, FAILED],
  ];
  for (const [name, status, body, message] of statusCases) {
    test(`error status: ${name}`, async () => {
      const { calls, el, flush } = loadPage();
      calls[0].resolve(status, body);
      await flush();
      assert.equal(el('error').textContent, message);
      assert.equal(el('room').childNodes.length, 0);
    });
  }

  const noReply = [
    ['reject', (c) => c.reject()],
    ['bad json on 200', (c) => c.resolveBadJson(200)],
    ['bad json on 500', (c) => c.resolveBadJson(500)],
  ];
  for (const [name, act] of noReply) {
    test(`no reply: ${name}`, async () => {
      const { calls, el, flush } = loadPage();
      act(calls[0]);
      await flush();
      assert.equal(el('error').textContent, NO_REPLY);
      assert.equal(el('room').childNodes.length, 0);
    });
  }
});

describe('list rendering', () => {
  test('renders one li per booking in reply order', async () => {
    const { calls, el, flush } = loadPage();
    calls[1].resolve(200, { bookings: [STANDUP, HTML_TITLE] });
    await flush();
    const lis = el('booking-list').childNodes;
    assert.equal(lis.length, 2);
    const expected = [
      '2026-11-04 09:00-10:00 Cosmos: Standup',
      '2026-11-03 13:00-14:30 Aurora: <b>x</b>',
    ];
    lis.forEach((li, i) => {
      assert.equal(li.tagName, 'LI');
      assert.equal(li.childNodes.length, 2);
      assert.equal(li.childNodes[0].nodeType, 3);
      assert.equal(li.childNodes[0].data, expected[i]);
      const btn = li.childNodes[1];
      assert.equal(btn.tagName, 'BUTTON');
      assert.equal(btn.type, 'button');
      assert.equal(btn.textContent, 'Cancel');
      assert.equal(btn.disabled, false);
    });
  });

  test('title with surrounding spaces is shown unchanged', async () => {
    const { calls, el, flush } = loadPage();
    calls[1].resolve(200, { bookings: [{ ...HTML_TITLE, title: '  x  ' }] });
    await flush();
    assert.equal(el('booking-list').childNodes[0].childNodes[0].data,
      '2026-11-03 13:00-14:30 Aurora:   x  ');
  });

  test('empty reply shows a single No bookings. item', async () => {
    const { calls, el, flush } = loadPage();
    calls[1].resolve(200, { bookings: [] });
    await flush();
    const lis = el('booking-list').childNodes;
    assert.equal(lis.length, 1);
    assert.equal(lis[0].tagName, 'LI');
    assert.equal(lis[0].childNodes.length, 1);
    assert.equal(lis[0].childNodes[0].nodeType, 3);
    assert.equal(lis[0].childNodes[0].data, 'No bookings.');
  });
});

describe('list errors', () => {
  const cases = [
    ['error status with message', (c) => c.resolve(500, { error: 'date must be a valid YYYY-MM-DD date' }),
      'date must be a valid YYYY-MM-DD date'],
    ['404 without message', (c) => c.resolve(404, {}), FAILED],
    ['no reply', (c) => c.reject(), NO_REPLY],
    ['bad json on 200', (c) => c.resolveBadJson(200), NO_REPLY],
    ['204 (json() skipped)', (c) => c.resolve(204), FAILED],
  ];
  for (const [name, act, message] of cases) {
    test(`${name} leaves the list as it was`, async () => {
      const page = loadPage();
      page.calls[1].resolve(200, { bookings: [STANDUP] });
      await page.flush();
      await changeFilter(page, '2026-11-04');
      act(page.calls[2]);
      await page.flush();
      assert.equal(page.el('error').textContent, message);
      assert.deepEqual(texts(page), ['2026-11-04 09:00-10:00 Cosmos: Standup']);
    });
  }

  test('successful list fetch leaves #error alone', async () => {
    const { calls, el, flush } = loadPage();
    calls[0].resolve(500, { error: 'boom' });
    await flush();
    calls[1].resolve(200, { bookings: [STANDUP] });
    await flush();
    assert.equal(el('error').textContent, 'boom');
  });
});

describe('overlapping list fetches', () => {
  test('(a) later fetch resolved first, earlier result ignored', async () => {
    const page = loadPage();
    await changeFilter(page, '2026-11-05');
    page.calls[2].resolve(200, { bookings: [XRAY] });
    await page.flush();
    assert.deepEqual(texts(page), [X_TEXT]);
    page.calls[1].resolve(200, { bookings: [YANKEE] });
    await page.flush();
    assert.deepEqual(texts(page), [X_TEXT]);
  });

  test('(b) earlier success while later pending changes nothing', async () => {
    const page = loadPage();
    await changeFilter(page, '2026-11-05');
    page.calls[1].resolve(200, { bookings: [YANKEE] });
    await page.flush();
    assert.equal(page.el('booking-list').childNodes.length, 0);
    page.calls[2].resolve(200, { bookings: [XRAY] });
    await page.flush();
    assert.deepEqual(texts(page), [X_TEXT]);
  });

  test('(c) earlier error status after later success leaves #error', async () => {
    const page = loadPage();
    await changeFilter(page, '2026-11-05');
    page.calls[2].resolve(200, { bookings: [XRAY] });
    await page.flush();
    page.calls[1].resolve(500, { error: 'late' });
    await page.flush();
    assert.equal(page.el('error').textContent, '');
    assert.deepEqual(texts(page), [X_TEXT]);
  });

  test('(d) earlier reject after later success leaves #error', async () => {
    const page = loadPage();
    await changeFilter(page, '2026-11-05');
    page.calls[2].resolve(200, { bookings: [XRAY] });
    await page.flush();
    page.calls[1].reject();
    await page.flush();
    assert.equal(page.el('error').textContent, '');
  });

  test('(e) earlier error while later pending changes nothing', async () => {
    const page = loadPage();
    await changeFilter(page, '2026-11-05');
    page.calls[1].resolve(500, { error: 'early' });
    await page.flush();
    assert.equal(page.el('error').textContent, '');
    assert.equal(page.el('booking-list').childNodes.length, 0);
    page.calls[2].resolve(200, { bookings: [XRAY] });
    await page.flush();
    assert.deepEqual(texts(page), [X_TEXT]);
  });

  test('(f) with three overlapping fetches only the third counts', async () => {
    const page = loadPage();
    await changeFilter(page, '2026-11-05');
    await changeFilter(page, '2026-11-06');
    page.calls[3].resolve(200, { bookings: [XRAY] });
    page.calls[2].resolve(500, { error: 'second' });
    page.calls[1].resolve(200, { bookings: [YANKEE] });
    await page.flush();
    assert.deepEqual(texts(page), [X_TEXT]);
    assert.equal(page.el('error').textContent, '');
  });
});

describe('filter', () => {
  const urlCases = [
    ['2026-11-03', '/api/bookings?date=2026-11-03'],
    ['a b&c', '/api/bookings?date=a b&c'],
    ['', '/api/bookings'],
  ];
  for (const [value, url] of urlCases) {
    test(`change with value ${JSON.stringify(value)} fetches ${url}`, async () => {
      const { calls, el, flush } = loadPage();
      el('filter-date').value = value;
      el('filter-date').dispatch('change');
      await flush();
      assert.equal(calls.length, 3);
      assert.equal(calls[2].url, url);
      assert.equal(methodOf(calls[2]), 'GET');
    });
  }

  test('input event does nothing', async () => {
    const { calls, el, flush } = loadPage();
    el('filter-date').value = '2026-11-03';
    el('filter-date').dispatch('input');
    await flush();
    assert.equal(calls.length, 2);
  });

  test('show all clears the filter and fetches once', async () => {
    const { calls, el, flush } = loadPage();
    el('filter-date').value = '2026-11-03';
    el('show-all').dispatch('click');
    await flush();
    assert.equal(el('filter-date').value, '');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, '/api/bookings');
    assert.equal(methodOf(calls[2]), 'GET');
  });
});
