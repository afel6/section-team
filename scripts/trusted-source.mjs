import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readMode } from '../hooks/lib/mode.mjs'
import { isMainModule, lineOf, projectRoot } from '../hooks/lib/paths.mjs'
import { projectFoldersSet } from '../hooks/lib/project-settings.mjs'

// CLI contract (add-skill runs it): node scripts/trusted-source.mjs <owner> [<project-root>]
//   exit 0: the skill may install unattended; exit 1: ask the user (one line says why); exit 2: a usage error or an unusable list
//   or project root, so ask the user as well. Without <project-root> the folder it runs in is checked.

export const SOURCES_FILE = new URL('../skills/add-skill/trusted-sources.json', import.meta.url)

// The owners the user trusts, outside the plugin folder so a plugin update keeps them. Messages name it with ~, never the real path.
const userSourcesFile = home => join(home, '.claude', 'section-team', 'trusted-sources.json')
const USER_SOURCES_SHOWN = '~/.claude/section-team/trusted-sources.json'

// Exact, case-insensitive match: no prefixes, no trimming, no pattern syntax.
export function isTrusted(owner, list) {
  return typeof owner === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(owner) && Array.isArray(list)
    && list.some(o => typeof o === 'string' && o.toLowerCase() === owner.toLowerCase())
}

// The user's switch for unattended installs; the same variable the session-start hook reads.
const AUTO_INSTALL_ENV = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'

const ask = why => ({ code: 1, message: `${why}, so ask the user` })
const unusable = message => ({ code: 2, message })

// A list file's owners; [] when the file does not exist. Throws one line, naming the list as shown, when it cannot be used.
function readList(file, shown) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return []
    throw new Error(`${shown} could not be read (${lineOf(err)})`)
  }
  let list
  try {
    list = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new Error(`${shown} is not valid JSON`)
  }
  if (!Array.isArray(list) || !list.every(o => typeof o === 'string')) throw new Error(`${shown} must be an array of owner names`)
  return list
}

// Why the project at dir refuses unattended installs, or null. Its mode file can turn them off. Its .claude settings may not set the
// switch at all: Claude Code passes a project's env to every command, so a value there cannot be told from the user's own.
// Throws one line when dir is not a folder (an empty string included: it must not stand for the current folder) or the settings cannot be read.
function projectVeto(dir, home) {
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) throw new Error('the project root is not a folder')
  const folder = resolve(dir)
  const root = projectRoot(folder)
  if (readMode(root).autoInstallSkills === false) return "this project's .team/mode.json sets autoInstallSkills false"
  const settingsSet = projectFoldersSet([folder, root], AUTO_INSTALL_ENV, home)
  return settingsSet ? `this project's .claude settings set ${AUTO_INSTALL_ENV}, which only your own ~/.claude/settings.json may set` : null
}

// Returns {code, message}: 0 may install unattended, 1 ask (message says why), 2 unusable input (message says what). Nobody is trusted
// unless the user's environment turns automatic installs on, the project does not veto them, and a list names the owner.
export function check(owner, { dir = process.cwd(), home = homedir(), env = process.env, file = SOURCES_FILE } = {}) {
  if (env[AUTO_INSTALL_ENV] !== '1') return ask(`automatic skill installs are off (${AUTO_INSTALL_ENV} is not 1)`)
  let veto
  try {
    veto = projectVeto(dir, home)
  } catch (err) {
    return unusable(`could not check the project (${lineOf(err)})`)
  }
  if (veto !== null) return ask(veto)
  let list
  try {
    list = [...readList(file, 'the shipped trusted-sources.json'), ...readList(userSourcesFile(home), USER_SOURCES_SHOWN)]
  } catch (err) {
    return unusable(err.message)
  }
  return isTrusted(owner, list) ? { code: 0 } : ask(`the owner is not in ${USER_SOURCES_SHOWN}`)
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length < 1 || args.length > 2) {
    console.error('usage: trusted-source.mjs <owner> [<project-root>]')
    process.exit(2)
  }
  const { code, message } = check(args[0], args.length === 2 ? { dir: args[1] } : {})
  if (message) console.error(message)
  process.exit(code)
}
