import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, TextNode, describeChildren, flush, loadApp } from './helpers/fake-dom.mjs';
import { FAILED, NO_REPLY, ROOM_NAMES, boot, errorText, listItems, roomsCall } from './helpers/app.mjs';

const makeBooking = (id, room, title, date = '2026-11-03', start = '09:00', end = '10:00') =>
  ({ id, room, title, date, start, end });
const AURORA_BOOKING = makeBooking(1, 'Aurora', 'Standup');
const BOREALIS_BOOKING = makeBooking(2, 'Borealis', 'Review', '2026-11-04', '11:00', '12:30');
const COSMOS_BOOKING = makeBooking(3, 'Cosmos', 'Retro', '2026-11-05', '08:00', '08:30');

/** Loads with only the rooms fetch answered by `answer`. */
async function roomsWith(answer) {
  const page = loadApp();
  answer(roomsCall(page));
  await flush();
  return page;
}

/** Boots with a rendered list, then starts a refetch via change. */
async function bootWithList() {
  const page = await boot({ bookings: [AURORA_BOOKING, BOREALIS_BOOKING] });
  const before = [...listItems(page)];
  page.el('filter-date').dispatch('change');
  return { page, before, refetch: page.lastFetch() };
}

describe('load', () => {
  test('starts both fetches synchronously and registers listeners', () => {
    const page = loadApp();
    assert.strictEqual(page.fetches.length, 2);
    assert.deepStrictEqual(new Set(page.fetches.map((f) => f.url)), new Set(['/api/rooms', '/api/bookings']));
    for (const f of page.fetches) {
      assert.strictEqual(f.method, 'GET');
      assert.strictEqual(f.options?.body, undefined);
    }
    assert.strictEqual(page.el('booking-form').listeners.submit.length >= 1, true);
    assert.strictEqual(page.el('filter-date').listeners.change.length >= 1, true);
    assert.strictEqual(page.el('show-all').listeners.click.length >= 1, true);
    assert.deepStrictEqual(page.violations, []);
  });
});

describe('rooms', () => {
  test('fills the select in order', async () => {
    const page = await roomsWith((c) => c.reply(200, { rooms: ROOM_NAMES }));
    const opts = page.el('room').children;
    assert.strictEqual(opts.length, 3);
    assert.strictEqual(page.el('room').childNodes.length, 3);
    ROOM_NAMES.forEach((name, i) => {
      assert.strictEqual(opts[i].tag, 'option');
      assert.strictEqual(opts[i].value, name);
      assert.strictEqual(opts[i].textContent, name);
      assert.strictEqual(opts[i].childNodes.length, 1);
    });
    assert.strictEqual(errorText(page), '');
    assert.deepStrictEqual(page.violations, []);
  });

  test('shows whatever rooms the server sends', async () => {
    const page = await roomsWith((c) => c.reply(200, { rooms: ['X', 'Y'] }));
    assert.deepStrictEqual(page.el('room').children.map((o) => [o.value, o.textContent]), [['X', 'X'], ['Y', 'Y']]);
    assert.deepStrictEqual(page.violations, []);
  });

  const cases = [
    ['500 with error message', (c) => c.reply(500, { error: 'internal error' }), 'internal error'],
    ['404 with non-string error', (c) => c.reply(404, { error: 7 }), FAILED],
    ['500 array body', (c) => c.reply(500, []), FAILED],
    ['500 null body', (c) => c.reply(500, null), FAILED],
    ['500 string body', (c) => c.reply(500, 'x'), FAILED],
    ['201 is not the success status', (c) => c.reply(201, { rooms: ['A'] }), FAILED],
    ['network failure', (c) => c.fail(), NO_REPLY],
    ['200 not json', (c) => c.replyNotJson(200), NO_REPLY],
    ['500 not json', (c) => c.replyNotJson(500), NO_REPLY],
    ['body stream failure', (c) => c.replyLater(200).fail(), NO_REPLY],
    ['200 without rooms array', (c) => c.reply(200, {}), FAILED],
  ];
  for (const [name, answer, message] of cases) {
    test(`error: ${name}`, async () => {
      const page = await roomsWith(answer);
      assert.strictEqual(errorText(page), message);
      assert.strictEqual(page.el('room').childNodes.length, 0);
      assert.deepStrictEqual(page.violations, []);
    });
  }

  test('list renders even if rooms are never answered', async () => {
    const page = loadApp();
    page.listFetches()[0].reply(200, { bookings: [AURORA_BOOKING] });
    await flush();
    assert.strictEqual(listItems(page).length, 1);
    assert.deepStrictEqual(page.violations, []);
  });
});

describe('list rendering', () => {
  test('renders in reply order with text and a Cancel button', async () => {
    const page = await boot({ bookings: [BOREALIS_BOOKING, COSMOS_BOOKING, AURORA_BOOKING] });
    const items = listItems(page);
    assert.deepStrictEqual(items.map((li) => li.tag), ['li', 'li', 'li']);
    const texts = [
      '2026-11-04 11:00-12:30 Borealis: Review',
      '2026-11-05 08:00-08:30 Cosmos: Retro',
      '2026-11-03 09:00-10:00 Aurora: Standup',
    ];
    items.forEach((li, i) => {
      assert.strictEqual(li.childNodes.length, 2);
      assert.ok(li.childNodes[0] instanceof TextNode);
      assert.strictEqual(li.childNodes[0].data, texts[i]);
      const btn = li.childNodes[1];
      assert.ok(btn instanceof FakeElement);
      assert.strictEqual(btn.tag, 'button');
      assert.strictEqual(btn.type, 'button');
      assert.strictEqual(btn.textContent, 'Cancel');
      assert.strictEqual(btn.childNodes.length, 1);
    });
    assert.deepStrictEqual(page.violations, []);
  });

  test('titles are plain text', async () => {
    const page = await boot({ bookings: [makeBooking(9, 'Aurora', '<b>x</b>')] });
    const li = listItems(page)[0];
    assert.strictEqual(li.childNodes[0].data, '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
    assert.strictEqual(li.children.length, 1);
    assert.deepStrictEqual(page.violations, []);
  });

  test('empty list shows No bookings.', async () => {
    const page = await boot({ bookings: [] });
    assert.strictEqual(listItems(page).length, 1);
    assert.strictEqual(listItems(page)[0].tag, 'li');
    assert.deepStrictEqual(describeChildren(listItems(page)[0]), [['text', 'No bookings.']]);
    assert.deepStrictEqual(page.violations, []);
  });

  test('a later success replaces the list', async () => {
    const page = await boot({ bookings: [AURORA_BOOKING, BOREALIS_BOOKING] });
    page.el('filter-date').dispatch('change');
    page.lastFetch().reply(200, { bookings: [COSMOS_BOOKING] });
    await flush();
    assert.strictEqual(listItems(page).length, 1);
    assert.strictEqual(listItems(page)[0].childNodes[0].data, '2026-11-05 08:00-08:30 Cosmos: Retro');
    assert.deepStrictEqual(page.violations, []);
  });
});

describe('list errors', () => {
  const cases = [
    ['error status', (c) => c.reply(500, { error: 'internal error' }), 'internal error'],
    ['500 non-string error', (c) => c.reply(500, { error: 7 }), FAILED],
    ['404 empty body', (c) => c.reply(404, {}), FAILED],
    ['network failure', (c) => c.fail(), NO_REPLY],
    ['200 not json', (c) => c.replyNotJson(200), NO_REPLY],
    ['body stream failure', (c) => c.replyLater(200).fail(), NO_REPLY],
    ['bookings not an array', (c) => c.reply(200, { bookings: 'x' }), FAILED],
    ['bookings missing', (c) => c.reply(200, {}), FAILED],
  ];
  for (const [name, answer, message] of cases) {
    test(`${name} leaves the list unchanged`, async () => {
      const { page, before, refetch } = await bootWithList();
      answer(refetch);
      await flush();
      assert.strictEqual(errorText(page), message);
      assert.strictEqual(listItems(page).length, before.length);
      before.forEach((li, i) => assert.strictEqual(listItems(page)[i], li));
      assert.deepStrictEqual(page.violations, []);
    });
  }

  test('list success leaves #error alone', async () => {
    const page = loadApp();
    roomsCall(page).reply(500, { error: 'boom' });
    await flush();
    page.listFetches()[0].reply(200, { bookings: [AURORA_BOOKING] });
    await flush();
    assert.strictEqual(errorText(page), 'boom');
    assert.strictEqual(listItems(page).length, 1);
    assert.deepStrictEqual(page.violations, []);
  });
});

describe('overlapping list fetches', () => {
  const start = () => {
    const page = loadApp();
    const a = page.listFetches()[0];
    page.el('filter-date').dispatch('change');
    return { page, a, b: page.lastFetch() };
  };
  const texts = (page) => listItems(page).map((li) => li.childNodes[0].data);

  test('B then A: B wins', async () => {
    const { page, a, b } = start();
    b.reply(200, { bookings: [BOREALIS_BOOKING] });
    await flush();
    a.reply(200, { bookings: [AURORA_BOOKING] });
    await flush();
    assert.deepStrictEqual(texts(page), ['2026-11-04 11:00-12:30 Borealis: Review']);
    assert.deepStrictEqual(page.violations, []);
  });

  test('earlier success is ignored until the last answers', async () => {
    const { page, a, b } = start();
    a.reply(200, { bookings: [AURORA_BOOKING] });
    await flush();
    assert.strictEqual(listItems(page).length, 0);
    b.reply(200, { bookings: [BOREALIS_BOOKING] });
    await flush();
    assert.deepStrictEqual(texts(page), ['2026-11-04 11:00-12:30 Borealis: Review']);
    assert.deepStrictEqual(page.violations, []);
  });

  const stale = [
    ['error status', (a) => a.reply(500, { error: 'x' })],
    ['network failure', (a) => a.fail()],
    ['not json', (a) => a.replyNotJson(200)],
  ];
  for (const [name, answer] of stale) {
    test(`stale ${name} changes nothing`, async () => {
      const { page, a, b } = start();
      b.reply(200, { bookings: [BOREALIS_BOOKING] });
      await flush();
      const before = [...listItems(page)];
      answer(a);
      await flush();
      assert.strictEqual(errorText(page), '');
      assert.strictEqual(listItems(page).length, before.length);
      before.forEach((li, i) => assert.strictEqual(listItems(page)[i], li));
      assert.deepStrictEqual(page.violations, []);
    });

    test(`stale ${name} arriving before the last also changes nothing`, async () => {
      const { page, a } = start();
      answer(a);
      await flush();
      assert.strictEqual(errorText(page), '');
      assert.strictEqual(listItems(page).length, 0);
      assert.deepStrictEqual(page.violations, []);
    });
  }

  test('A, B, C started; answered C, B, A: only C shown', async () => {
    const { page, a, b } = start();
    page.el('filter-date').dispatch('change');
    const c = page.lastFetch();
    c.reply(200, { bookings: [COSMOS_BOOKING] });
    await flush();
    b.reply(200, { bookings: [BOREALIS_BOOKING] });
    await flush();
    a.reply(200, { bookings: [AURORA_BOOKING] });
    await flush();
    assert.deepStrictEqual(texts(page), ['2026-11-05 08:00-08:30 Cosmos: Retro']);
    assert.deepStrictEqual(page.violations, []);
  });

  test('B error then A success: B message stays, A ignored', async () => {
    const { page, a, b } = start();
    b.reply(500, { error: 'B failed' });
    await flush();
    a.reply(200, { bookings: [AURORA_BOOKING] });
    await flush();
    assert.strictEqual(errorText(page), 'B failed');
    assert.strictEqual(listItems(page).length, 0);
    assert.deepStrictEqual(page.violations, []);
  });
});

describe('filter and Show all', () => {
  test('change fetches with the date at once', async () => {
    const page = await boot();
    const n = page.fetches.length;
    page.el('filter-date').value = '2026-11-03';
    page.el('filter-date').dispatch('change');
    assert.strictEqual(page.fetches.length, n + 1);
    assert.strictEqual(page.lastFetch().url, '/api/bookings?date=2026-11-03');
    assert.strictEqual(page.lastFetch().method, 'GET');
    assert.deepStrictEqual(page.violations, []);
  });

  test('value is passed unchanged', async () => {
    const page = await boot();
    page.el('filter-date').value = 'a b&c=d#e';
    page.el('filter-date').dispatch('change');
    assert.strictEqual(page.lastFetch().url, '/api/bookings?date=a b&c=d#e');
    assert.deepStrictEqual(page.violations, []);
  });

  test('input does nothing', async () => {
    const page = await boot();
    const n = page.fetches.length;
    page.el('filter-date').value = '2026-11-03';
    page.el('filter-date').dispatch('input');
    await flush();
    assert.strictEqual(page.fetches.length, n);
    assert.deepStrictEqual(page.violations, []);
  });

  test('empty value and change fetches everything', async () => {
    const page = await boot();
    const n = page.fetches.length;
    page.el('filter-date').value = '';
    page.el('filter-date').dispatch('change');
    assert.strictEqual(page.fetches.length, n + 1);
    assert.strictEqual(page.lastFetch().url, '/api/bookings');
    assert.deepStrictEqual(page.violations, []);
  });

  test('Show all clears the filter and fetches once', async () => {
    const page = await boot();
    const n = page.fetches.length;
    page.el('filter-date').value = '2026-11-03';
    page.el('show-all').click();
    assert.strictEqual(page.el('filter-date').value, '');
    assert.strictEqual(page.fetches.length, n + 1);
    assert.strictEqual(page.lastFetch().url, '/api/bookings');
    await flush();
    assert.strictEqual(page.fetches.length, n + 1);
    assert.deepStrictEqual(page.violations, []);
  });
});
