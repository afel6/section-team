// Hidden set reg of task h7: stage 1's behaviour again, on the final code, and the data stage 1's own code wrote surviving
// the move to it. S1_DIR is the code as it stood after stage 1.
import assert from 'node:assert/strict'
import { S1_DIR, SCHEMA_V2, dump, del, freshDb, get, it, moveOf, ok, partOf, patch, post, schemaOf, startServer, stopServer, withServer } from './lib.mjs'
import { stageOneCases } from './stage-one-cases.mjs'

stageOneCases({ stage: 2 })

// Fills a database through stage 1's own server, with the deletes that test the id sequences, and leaves it as a killed server would.
async function stageOneData(file) {
  const s = await startServer({ file, dir: S1_DIR })
  try {
    const bolt = await partOf(s, 'BOLT-1', 'Hex Bolt')
    const again = await partOf(s, 'bolt-1', 'hex bolt')
    const nut = await partOf(s, 'NUT-1', 'Écrou M8 <b>')
    const odd = await partOf(s, 'ODD', '!!!')
    const gone = await partOf(s, 'GONE', 'Gone')
    await moveOf(s, bolt.id, '2026-03-01', 10, 250, { note: "it's  spaced " })
    await moveOf(s, bolt.id, '2026-03-05', -4, 250)
    await moveOf(s, again.id, '2026-02-01', 1_000_000_000, 1_000_000_000)
    await moveOf(s, again.id, '2026-02-01', 1_000_000_000, 1_000_000_000)
    await ok(post(s, '/api/transfers', { from_part: bolt.id, to_part: nut.id, on_date: '2026-03-06', qty: 2, unit_cost_cents: 300 }), 201)
    const lastMove = await moveOf(s, gone.id, '2026-03-07', 1, 1)
    await ok(del(s, `/api/moves/${lastMove.id}`), 204)
    await ok(del(s, `/api/parts/${gone.id}`), 204)
    await ok(patch(s, `/api/parts/${odd.id}`, { name: '???' }), 200)
    return {
      replies: {
        parts: (await ok(get(s, '/api/parts'), 200)).parts,
        moves: Object.fromEntries(await Promise.all([bolt, again, nut, odd].map(async p => [p.id, await ok(get(s, `/api/parts/${p.id}/moves`), 200)]))),
      },
      ids: { bolt: bolt.id, again: again.id, nut: nut.id, odd: odd.id, topPart: gone.id, topMove: lastMove.id },
    }
  } finally {
    await stopServer(s)
  }
}

const withoutHandle = ({ handle, ...rest }) => rest

it('data stage 1\'s code wrote survives on the final code: every reply as before, handles given, ids never reused', async () => {
  const file = freshDb()
  const { replies, ids } = await stageOneData(file)
  await withServer({ file }, async s => {
    const parts = (await ok(get(s, '/api/parts'), 200)).parts
    assert.deepEqual(parts.map(withoutHandle), replies.parts)
    assert.deepEqual(Object.fromEntries(parts.map(p => [p.sku, p.handle])), { 'BOLT-1': 'hex-bolt', 'bolt-1': 'hex-bolt-2', 'NUT-1': 'ecrou-m8-b', ODD: 'part' })
    for (const [id, moves] of Object.entries(replies.moves)) assert.deepEqual(await ok(get(s, `/api/parts/${id}/moves`), 200), moves, `moves of part ${id}`)
    const report = await ok(get(s, '/api/report?as_of=2026-12-31'), 200)
    assert.equal(report.total_value_cents, String(2n * 10n ** 18n + 10n * 250n - 4n * 250n + (-2n + 2n) * 300n), 'the report reads the old rows')
    const part = await partOf(s, 'NEW-1', 'Hex Bolt')
    assert.ok(part.id > ids.topPart, `part id ${part.id} after ${ids.topPart} was deleted`)
    assert.equal(part.handle, 'hex-bolt-3')
    const move = await moveOf(s, ids.bolt, '2026-03-08', 1, 1)
    assert.ok(move.id > ids.topMove, `move id ${move.id} after ${ids.topMove} was deleted`)
    await ok(del(s, `/api/parts/${ids.nut}`), 204)
    assert.equal(dump(file).moves.filter(m => m.part_id === ids.nut).length, 0, 'the cascade still works on old rows')
  })
  assert.deepEqual(schemaOf(file), SCHEMA_V2)
})

it('after that first migration a restart changes nothing, also when names and parts have changed since', async () => {
  const file = freshDb()
  const { ids } = await stageOneData(file)
  await withServer({ file }, async s => {
    await ok(patch(s, `/api/parts/${ids.bolt}`, { name: 'Renamed' }), 200)
    await ok(del(s, `/api/parts/${ids.again}`), 204)
  })
  const before = dump(file)
  await withServer({ file }, async s => { await ok(get(s, '/api/parts'), 200) })
  assert.deepEqual(dump(file), before)
  assert.equal(before.parts.find(p => p.id === ids.bolt).handle, 'hex-bolt', 'a renamed part keeps its handle')
})
