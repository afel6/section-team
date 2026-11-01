import { assertMode, balancedBecause, MODE_FILE, MODE_LABELS, MODES, modeName, NOT_FOLDER, readReason } from './lib/mode.mjs'

// The words the mode picker and /team mode show. Pure: register.tsx does the reading and writing, since $ may not cross an import.

const HOW_TO_SET = '/team mode lean|balanced|max'

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

// The one line the mobile strip's button shows: the mode, and how to set it.
export const modeHint = mode => `section-team mode: ${modeName(mode)} · ${HOW_TO_SET}`

// The error for a .team that is a file: Windows reports a path under a file as ENOENT, so the reader checks and says it with ENOTDIR.
export const notAFolder = () => Object.assign(new Error(NOT_FOLDER), { code: 'ENOTDIR' })

// An error's code ('EPERM'), from .code or its message, where the engine puts it after its own prefix
// ("section-team: $.fs.write: EPERM: ... 'C:\x'"); else null. Nothing else of the message: it may carry an absolute path.
const codeOf = error => {
  const code = error?.code
  if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return code
  return /(?:^|: )(E[A-Z]+): /.exec(typeof error?.message === 'string' ? error.message : '')?.[1] ?? null
}

// The line after a failed save: the error's code alone, or what ENOTDIR means here.
export function saveFailedLine(error) {
  const code = codeOf(error)
  const reason = code === 'ENOTDIR' ? NOT_FOLDER : code ?? 'the file system refused it'
  return `section-team mode: could not save ${MODE_FILE}: ${reason}`
}

// The mode file as the hooks' readMode reports one it could not read: Balanced, with the same problem line.
export const unreadableModeFile = error => balancedBecause(readReason({ code: codeOf(error) ?? undefined }))

// What /team mode shows for a parsed mode file: the mode the hooks will use, its problem line when it has one, and the three modes.
export function modeSummary({ mode, problem }) {
  const lines = [`section-team mode: ${modeName(mode)}`, ...(problem === null ? [] : [problem]), ...MODE_OPTIONS.map(o => o.label)]
  return [...lines, `Set it with ${HOW_TO_SET}`].join('\n')
}
