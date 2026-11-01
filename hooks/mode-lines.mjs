import { assertMode, MODE_FILE, MODE_LABELS, MODES, modeName, parseModeFile } from './lib/mode.mjs'

// The words the mode picker and /team mode show. Pure: register.tsx does the reading and writing, since $ may not cross an import.

// What the strip's picker offers, in MODES order.
export const MODE_OPTIONS = Object.freeze(MODES.map(value => Object.freeze({ value, label: MODE_LABELS[value] })))

// The one line naming the modes to pick from when mode is not one of them, else null.
export function unknownModeLine(mode) {
  try {
    assertMode(mode)
    return null
  } catch (err) {
    return err.message
  }
}

// The line after a save. Throws on an unknown mode.
export const savedLine = mode => `section-team mode: ${modeName(mode)} (applies from your next message)`

// An error's code ('EPERM'), from .code or its message, where the engine puts it after its own prefix
// ("section-team: $.fs.write: EPERM: ... 'C:\x'"); else null. Nothing else of the message: it may carry an absolute path.
const codeOf = error => {
  const code = error?.code
  if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return code
  return /(?:^|: )(E[A-Z]+): /.exec(typeof error?.message === 'string' ? error.message : '')?.[1] ?? null
}

// The line after a failed save: a reason given as text, else the error's code alone.
export function saveFailedLine(reasonOrError) {
  const reason = typeof reasonOrError === 'string' ? reasonOrError : codeOf(reasonOrError) ?? 'the file system refused it'
  return `section-team mode: could not save ${MODE_FILE}: ${reason}`
}

// What /team mode shows for the mode file's text (null when there is none): the mode the hooks will use,
// the file's problem line when it has one, and the three modes to pick from.
export function modeSummary(text) {
  const { mode, problem } = parseModeFile(text)
  const lines = [`section-team mode: ${modeName(mode)}`, ...(problem === null ? [] : [problem]), ...MODE_OPTIONS.map(o => o.label)]
  return [...lines, 'Set it with /team mode lean|balanced|max'].join('\n')
}
