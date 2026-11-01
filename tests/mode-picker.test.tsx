import { test, expect } from 'claude-code/testing'
import { MODE_LABELS, MODES } from '../hooks/lib/mode.mjs'
import { BAND, mountStrip, slashes, START, world } from './board-world'

// The project's mode: /team mode and the strip's picker save it to <project root>/.team/mode.json, where the plugin's command hooks read it.
const MODE_PATH = 'C:/proj/.team/mode.json'
const MODE_LIST = [MODE_LABELS.lean, MODE_LABELS.balanced, MODE_LABELS.max, 'Set it with /team mode lean|balanced|max']
const modeWrites = (seen: { writes: { path: string; text: string }[] }) => seen.writes.filter(w => w.path.endsWith('/.team/mode.json'))
const team = ($: { command: { run: (e: never) => Promise<unknown> } }, args: string) => $.command.run({ command: 'team', args } as never)

test('/team mode max writes {"mode":"max"} at the project root while the session is in a subfolder', async ($, on) => {
  const { seen } = world(on)
  seen.cwd = 'C:/proj/src/app'

  await $.session.start(START)
  expect(await team($ as never, 'mode max')).toEqual({ text: 'section-team mode: Max (applies from your next message)' })
  expect(modeWrites(seen)).toEqual([{ path: MODE_PATH, text: '{"mode":"max"}' }])
  expect(seen.opened).toEqual([])
})

test('/team mode keeps the skill setting already in the file', async ($, on) => {
  const { seen } = world(on)
  seen.disk[MODE_PATH] = '{"mode":"lean","autoInstallSkills":true}'

  await $.session.start(START)
  await team($ as never, 'mode balanced')
  expect(seen.disk[MODE_PATH]).toBe('{"mode":"balanced","autoInstallSkills":true}')
})

test('outside git, /team mode saves at the session project root, not the folder the session moved to', async ($, on) => {
  const { seen } = world(on)
  seen.gitExit = 128
  seen.cwd = 'C:/proj/sub'

  await $.session.start(START)
  expect(await team($ as never, 'mode lean')).toEqual({ text: 'section-team mode: Lean (applies from your next message)' })
  expect(modeWrites(seen).map(w => w.path)).toEqual([MODE_PATH])
})

test('/team mode shows the current mode and the three modes, and a broken file says so', async ($, on) => {
  const { seen } = world(on)

  await $.session.start(START)
  expect(await team($ as never, 'mode')).toEqual({ text: ['section-team mode: Balanced', ...MODE_LIST].join('\n') })
  seen.disk[MODE_PATH] = '{"mode":"max"}'
  expect(await team($ as never, 'mode')).toEqual({ text: ['section-team mode: Max', ...MODE_LIST].join('\n') })
  seen.disk[MODE_PATH] = '{"mode":'
  expect(await team($ as never, 'mode')).toEqual({ text: ['section-team mode: Balanced', '.team/mode.json: not valid JSON, so Balanced is used', ...MODE_LIST].join('\n') })
  expect(modeWrites(seen)).toEqual([])
  expect(seen.opened).toEqual([])
})

test('/team mode turbo names the modes to pick from and writes nothing', async ($, on) => {
  const { seen } = world(on)

  await $.session.start(START)
  expect(await team($ as never, 'mode turbo')).toEqual({ text: 'unknown mode "turbo": pick lean, balanced or max' })
  expect(modeWrites(seen)).toEqual([])
  expect(seen.opened).toEqual([])
})

test('/team with no arguments opens the board as before, and its description tells how to set the mode', async ($, on) => {
  const { seen } = world(on)

  await $.session.start(START)
  expect(seen.descriptions.team).toBe("Show the Team Board, or set this project's mode: /team mode lean|balanced|max")
  expect(await team($ as never, '')).toEqual({ text: 'Team Board opened.' })
  // Only the word mode itself picks the mode command.
  expect(await team($ as never, 'modex')).toEqual({ text: 'Team Board opened.' })
  expect(seen.opened).toEqual(['team-board', 'team-board'])
  expect(modeWrites(seen)).toEqual([])
  expect(await team($ as never, '  mode   max ')).toEqual({ text: 'section-team mode: Max (applies from your next message)' })
})

test('a mode that cannot be saved is one line starting "could not save", and the old file stays', async ($, on) => {
  const { seen } = world(on)
  seen.disk['C:/proj/.team'] = 'a file where the folder should be'

  await $.session.start(START)
  const blocked = (await team($ as never, 'mode max')) as { text: string }
  expect(blocked.text).toBe('section-team mode: could not save .team/mode.json: .team is not a folder')
  expect(seen.disk['C:/proj/.team']).toBe('a file where the folder should be')
  expect(modeWrites(seen)).toEqual([])

  // A refused write: the old file is untouched and the line gives the code, not the message with its path.
  delete seen.disk['C:/proj/.team']
  seen.disk[MODE_PATH] = '{"mode":"lean"}'
  seen.denyWrite = "EPERM: operation not permitted, open 'C:\\proj\\.team\\mode.json'"
  expect(await team($ as never, 'mode max')).toEqual({ text: 'section-team mode: could not save .team/mode.json: EPERM' })
  expect(seen.disk[MODE_PATH]).toBe('{"mode":"lean"}')
})

test('a pick the strip cannot save toasts the one line and leaves the picker on the mode the file still gives', async ($, on) => {
  const { clock, seen } = world(on)
  seen.disk['C:/proj/.team'] = 'a file where the folder should be'

  await $.session.start(START)
  await clock.advance(1000)
  const ui = await mountStrip($ as never)
  await ui.select({ key: 'mode', value: 'lean' })
  expect(seen.toasts).toEqual(['section-team mode: could not save .team/mode.json: .team is not a folder'])
  expect(modeWrites(seen)).toEqual([])
  expect((await (await mountStrip($ as never)).find({ key: 'mode' }))?.props.value).toBe('balanced')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the strip draws the mode picker with the current mode selected on ${surface}, and picking lean writes the file`, async ($, on) => {
    const { clock, seen } = world(on)
    seen.disk[MODE_PATH] = '{"mode":"max"}'
    const pickerValue = async () => (await (await mountStrip($ as never, BAND, surface)).find({ key: 'mode' }))?.props.value

    await $.session.start(START)
    await clock.advance(1000)
    const ui = await mountStrip($ as never, BAND, surface)
    const picker = await ui.find({ key: 'mode' })
    expect(picker?.props.value).toBe('max')
    expect(picker?.props.options).toEqual(MODES.map(value => ({ value, label: MODE_LABELS[value as keyof typeof MODE_LABELS] })))

    await ui.select({ key: 'mode', value: 'lean' })
    expect(modeWrites(seen)).toEqual([{ path: MODE_PATH, text: '{"mode":"lean"}' }])
    expect(seen.toasts).toEqual(['section-team mode: Lean (applies from your next message)'])
    expect(await pickerValue()).toBe('lean')

    // A change made outside the picker shows on the next tick.
    seen.disk[MODE_PATH] = '{"mode":"balanced"}'
    await clock.advance(1000)
    expect(await pickerValue()).toBe('balanced')
  })
}

test('a tick that read the file before a pick does not put the old mode back', async ($, on) => {
  const { clock, seen } = world(on)
  seen.disk[MODE_PATH] = '{"mode":"max"}'
  const pickerValue = async () => (await (await mountStrip($ as never)).find({ key: 'mode' }))?.props.value

  await $.session.start(START)
  await clock.advance(1000)
  let release = () => {}
  seen.holdModeRead = new Promise<void>(resolve => { release = resolve })
  await clock.advance(1000) // this tick's read of the file answers late, with "max"
  await (await mountStrip($ as never)).select({ key: 'mode', value: 'lean' })
  release()
  await clock.settle()
  expect(await pickerValue()).toBe('lean')
  await clock.advance(1000)
  expect(await pickerValue()).toBe('lean')

  // The same with an outside edit the late read carries: the pick made since still wins.
  seen.disk[MODE_PATH] = '{"mode":"balanced"}'
  seen.holdModeRead = new Promise<void>(resolve => { release = resolve })
  await clock.advance(1000) // reads "balanced", late
  await (await mountStrip($ as never)).select({ key: 'mode', value: 'max' })
  release()
  await clock.settle()
  expect(await pickerValue()).toBe('max')
})

test('after the session moves to another project, the board, the strip and /team mode follow it, and a pick stays', async ($, on) => {
  const { clock, seen } = world(on)
  seen.disk[MODE_PATH] = '{"mode":"max"}'
  const pickerValue = async () => (await (await mountStrip($ as never)).find({ key: 'mode' }))?.props.value

  await $.session.start(START)
  await clock.advance(1000)
  expect(await pickerValue()).toBe('max')
  expect(seen.runs).toHaveLength(1)

  // A /cd into another repository: no event fires, and only the cwd moves.
  seen.cwd = 'C:/other/src'
  seen.gitRoot = 'C:/other'
  await clock.advance(1000)
  expect(seen.runs).toHaveLength(2)
  expect(slashes(seen.listed)).toMatch(/^C:\/other\/\.team\/reports\//)
  expect(await pickerValue()).toBe('balanced')

  await (await mountStrip($ as never)).select({ key: 'mode', value: 'lean' })
  expect(modeWrites(seen).map(w => w.path)).toEqual(['C:/other/.team/mode.json'])
  await clock.advance(1000)
  expect(await pickerValue()).toBe('lean')
  expect(((await team($ as never, 'mode')) as { text: string }).text.split('\n')[0]).toBe('section-team mode: Lean')
  // Git is asked again only when the session's folder or root moved.
  expect(seen.runs).toHaveLength(2)
  expect(seen.disk[MODE_PATH]).toBe('{"mode":"max"}')

  // Outside git, a host's directory change moves only the session root: that is followed too.
  seen.gitExit = 128
  seen.projectRoot = 'C:/third'
  await clock.advance(1000)
  expect(seen.runs).toHaveLength(3)
  await team($ as never, 'mode max')
  expect(modeWrites(seen).map(w => w.path).at(-1)).toBe('C:/third/.team/mode.json')
})

test("/team mode gives the hooks' problem line when .team is not a folder or the file cannot be read, and never a path", async ($, on) => {
  const { seen } = world(on)
  seen.disk['C:/proj/.team'] = 'a file where the folder should be'

  await $.session.start(START)
  expect(await team($ as never, 'mode')).toEqual({ text: ['section-team mode: Balanced', '.team/mode.json: .team is not a folder, so Balanced is used', ...MODE_LIST].join('\n') })

  delete seen.disk['C:/proj/.team']
  seen.disk[MODE_PATH] = '{"mode":"max"}'
  seen.denyModeRead = "EPERM: operation not permitted, open 'C:\\proj\\.team\\mode.json'"
  expect(await team($ as never, 'mode')).toEqual({ text: ['section-team mode: Balanced', '.team/mode.json: could not be read (EPERM), so Balanced is used', ...MODE_LIST].join('\n') })
  // Saving over a file that cannot be read would lose its skill setting: refused, and nothing is written.
  expect(await team($ as never, 'mode lean')).toEqual({ text: 'section-team mode: could not save .team/mode.json: EPERM' })
  expect(modeWrites(seen)).toEqual([])
})

test('on mobile, which draws no Select, the strip shows the mode as a button that names it and how to set it', async ($, on) => {
  const { clock, seen } = world(on)
  seen.disk[MODE_PATH] = '{"mode":"max"}'
  // A plugin's own $.command.run skips its own command hook and would land here, unanswered: the button must not rely on it.
  const runs: unknown[] = []
  on('command.run', async (_$, e) => { runs.push(e); return { text: 'nobody answered' } })

  await $.session.start(START)
  await clock.advance(1000)
  const ui = await mountStrip($ as never, BAND, 'mobile')
  expect((await ui.find({ key: 'mode' }))?.props.label).toBe('● Max')
  await ui.press({ key: 'mode' })
  expect(seen.toasts).toEqual(['section-team mode: Max · /team mode lean|balanced|max'])
  expect(runs).toEqual([])
  expect(modeWrites(seen)).toEqual([])
})
