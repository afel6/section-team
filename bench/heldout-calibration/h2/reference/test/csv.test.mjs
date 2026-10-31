import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from '../lib/csv.mjs'

test('toCsv writes the header, then one line per item, each ending in CRLF', () => {
  const items = [{ sku: 'A-1', name: 'Anchor', qty: 3, reserved: 1 }, { sku: 'B-2', name: 'Bolt', qty: 5, reserved: 0 }]
  assert.equal(toCsv(items), 'sku,name,qty,reserved\r\nA-1,Anchor,3,1\r\nB-2,Bolt,5,0\r\n')
})

test('toCsv of no items is the header line alone', () => {
  assert.equal(toCsv([]), 'sku,name,qty,reserved\r\n')
})

test('toCsv quotes a field holding a comma, a quote, a CR or an LF and doubles inner quotes', () => {
  const line = name => toCsv([{ sku: 'X', name, qty: 1, reserved: 0 }]).split('\r\n')[1]
  assert.equal(line('a,b'), 'X,"a,b",1,0')
  assert.equal(line('say "hi"'), 'X,"say ""hi""",1,0')
  assert.equal(line('"'), 'X,"""",1,0')
  assert.equal(line('plain text'), 'X,plain text,1,0')
  assert.equal(toCsv([{ sku: 'X', name: 'a\nb', qty: 1, reserved: 0 }]), 'sku,name,qty,reserved\r\nX,"a\nb",1,0\r\n')
  assert.equal(toCsv([{ sku: 'X', name: 'a\rb', qty: 1, reserved: 0 }]), 'sku,name,qty,reserved\r\nX,"a\rb",1,0\r\n')
})
