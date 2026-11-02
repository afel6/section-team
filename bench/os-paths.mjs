// Paths from either OS, for the round's plugin, worktree, pin and run-folder checks (spec: docs/specs/
// 2026-11-01-mode-round-design.md, "Cloud amendment"). On Windows every path is read as a Windows path, exactly as
// before: case ignored, either slash. Elsewhere a path with a drive letter (C:) or a UNC prefix (\\) is still read as a
// Windows path, so the Windows round's data and test fixtures read the same on Linux; every other path is a POSIX path,
// compared case for case, with only / between names. Paths of different kinds are never equal or nested.
import { posix, win32 } from 'node:path'

const WINDOWS_SHAPED = /^(?:[A-Za-z]:|\\\\)/
const WINDOWS = { name: 'windows', path: win32, fold: text => text.toLowerCase(), slashes: text => text.replaceAll('\\', '/') }
const POSIX = { name: 'posix', path: posix, fold: text => text, slashes: text => text }

export const flavorOf = (p, platform = process.platform) => (platform === 'win32' || WINDOWS_SHAPED.test(String(p)) ? WINDOWS : POSIX)

export const isAbsolutePath = (p, platform = process.platform) => typeof p === 'string' && p !== '' && flavorOf(p, platform).path.isAbsolute(p)

// p relative to folder (case folded for Windows paths); null when p is not an absolute path of folder's kind.
function relativeTo(p, folder, platform) {
  if (typeof p !== 'string' || typeof folder !== 'string') return null
  const flavor = flavorOf(folder, platform)
  if (flavorOf(p, platform) !== flavor || !flavor.path.isAbsolute(p)) return null
  const { path, fold } = flavor
  return path.relative(fold(path.resolve(folder)), fold(path.resolve(p)))
}

// True when p is folder itself or a path inside it. Built-in plugins have the path 'builtin': never under anything.
export function isUnder(p, folder, platform = process.platform) {
  const rel = relativeTo(p, folder, platform)
  return rel === '' || (rel !== null && !rel.startsWith('..') && !flavorOf(folder, platform).path.isAbsolute(rel))
}

// Two spellings of one folder: resolved, and for Windows paths without case.
export function samePath(a, b, platform = process.platform) {
  const flavor = flavorOf(b, platform)
  if (flavorOf(a, platform) !== flavor) return false
  const { path, fold } = flavor
  return fold(path.resolve(String(a))) === fold(path.resolve(String(b)))
}

// p (absolute, or relative to folder) as a folder-relative path with forward slashes; null when p is the folder itself,
// lies outside it, or is an absolute path of the other kind.
export function insideFolder(folder, p, platform = process.platform) {
  const flavor = flavorOf(folder, platform)
  const own = flavorOf(p, platform)
  if (own !== flavor && own.path.isAbsolute(String(p))) return null
  const { path, slashes } = flavor
  const rel = path.relative(path.resolve(folder), path.resolve(folder, String(p ?? '')))
  return rel === '' || rel.split(path.sep)[0] === '..' || path.isAbsolute(rel) ? null : slashes(rel)
}
