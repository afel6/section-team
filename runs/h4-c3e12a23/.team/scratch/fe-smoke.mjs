import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8');
function el(tag) {
  const e = { tag, children: [], listeners: {}, value: '', disabled: false, type: '', _text: '',
    get textContent() { return this.children.length ? this.children.map(c => typeof c === 'string' ? c : c.textContent).join('') : this._text; },
    set textContent(v) { this._text = v; this.children = []; },
    append(...n) { this.children = [...this.children, ...n]; },
    replaceChildren(...n) { this.children = n; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t) { (this.listeners[t] || []).forEach(f => f({ preventDefault() { e.prevented = true; } })); } };
  return e;
}
const ids = {};
for (const id of ['booking-form','room','title','date','start','end','book','filter-date','show-all','booking-list','error']) ids[id] = el(id);
const calls = [];
const replies = [];
const fetch = (url, opts) => { calls.push([url, opts]); return new Promise((res, rej) => replies.push({ res, rej })); };
const reply = (status, body) => ({ status, json: async () => body });
vm.runInContext(src, vm.createContext({ document: { getElementById: id => ids[id], createElement: el }, fetch }));
const tick = () => new Promise(r => setTimeout(r, 0));
const out = (...a) => process.stdout.write(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');
out(calls.map(c => c[0]));
replies[0].res(reply(200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] }));
replies[1].res(reply(200, { bookings: [{ id: 1, room: 'Aurora', title: '<b>x</b>', date: '2026-11-03', start: '09:00', end: '10:00' }] }));
await tick();
out(ids.room.children.map(o => o.value + '/' + o.textContent));
const li = ids['booking-list'].children[0];
out(li.children.length, li.children[0], li.children[1].type, li.children[1].textContent);
// stale list
ids['filter-date'].value = '2026-11-03'; ids['filter-date'].fire('change');
ids['show-all'].fire('click');
out(calls.slice(2).map(c => c[0]));
replies[3].res(reply(200, { bookings: [] }));
replies[2].rej(new Error('x'));
await tick();
out('list', ids['booking-list'].children[0].children, 'err', ids.error.textContent);
// POST
ids.title.value = ' t '; ids['booking-form'].fire('submit'); ids['booking-form'].fire('submit');
out(calls.length, calls[4], ids.book.disabled);
replies[4].res(reply(409, { error: 'room is already booked from 09:00 to 10:00' }));
await tick();
out(ids.book.disabled, ids.error.textContent, ids.title.value);
ids['booking-form'].fire('submit');
replies[5].res({ status: 500, json: async () => { throw new Error('bad'); } });
await tick();
out('unparsable:', ids.error.textContent);
ids['booking-form'].fire('submit');
replies[6].res(reply(201, { id: 2 }));
await tick();
out('201:', ids.title.value, ids.error.textContent, calls[7][0]);
replies[7].res(reply(200, { bookings: [{ id: 2, room: 'Cosmos', title: 't', date: '2026-11-03', start: '09:00', end: '10:00' }] }));
await tick();
// DELETE
const cancel = ids['booking-list'].children[0].children[1];
cancel.fire('click');
out(cancel.disabled, calls[8]);
let jsonCalled = false;
replies[8].res({ status: 204, json: async () => { jsonCalled = true; return {}; } });
await tick();
out('204:', cancel.disabled, jsonCalled, calls[9][0]);
cancel.fire('click');
replies[10 - 0].rej(new Error('down'));
await tick();
out('no reply:', ids.error.textContent, calls.length);
