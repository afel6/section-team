import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flavorOf, insideFolder, isAbsolutePath, isUnder, samePath } from './os-paths.mjs'

const LINUX = 'linux'
const WINDOWS = 'win32'

test('flavorOf: every path is a Windows path on Windows; elsewhere only drive-letter and UNC paths are', () => {
  for (const p of ['/tmp/x', 'C:/x', 'relative', '\\x']) assert.equal(flavorOf(p, WINDOWS).name, 'windows', p)
  for (const p of ['C:/Users/Asus', 'c:\\x', 'D:', '\\\\server\\share']) assert.equal(flavorOf(p, LINUX).name, 'windows', p)
  for (const p of ['/tmp/x', '/root/section-team-v0.2.1', 'relative/x', '\\x', '//double']) assert.equal(flavorOf(p, LINUX).name, 'posix', p)
})

test('isAbsolutePath accepts real Linux paths on Linux and keeps the Windows rules on Windows', () => {
  for (const p of ['/tmp/st-v021', '/root/section-team-v0.2.1', 'C:/Users/Asus/x', '\\\\server\\share\\x']) assert.equal(isAbsolutePath(p, LINUX), true, p)
  for (const p of ['', 'tmp/x', './w', 'section-team-v0.2.1', '\\rooted']) assert.equal(isAbsolutePath(p, LINUX), false, p)
  for (const p of ['C:/x', '\\rooted', '/rooted']) assert.equal(isAbsolutePath(p, WINDOWS), true, p)
  for (const p of [undefined, null, 42]) assert.equal(isAbsolutePath(p, LINUX), false)
})

test('isUnder on Linux: case matters, only / separates, and a sibling with a longer name is not under', () => {
  assert.equal(isUnder('/tmp/st-v021', '/tmp/st-v021', LINUX), true)
  assert.equal(isUnder('/tmp/st-v021/hooks/x.mjs', '/tmp/st-v021/', LINUX), true)
  assert.equal(isUnder('/tmp/ST-V021', '/tmp/st-v021', LINUX), false)
  assert.equal(isUnder('/tmp/st-v021-old', '/tmp/st-v021', LINUX), false)
  assert.equal(isUnder('/tmp/a\\b', '/tmp/a', LINUX), false)
  assert.equal(isUnder('/tmp', '/tmp/st-v021', LINUX), false)
  assert.equal(isUnder('builtin', '/tmp', LINUX), false)
  assert.equal(isUnder(undefined, '/tmp', LINUX), false)
  // A path of the other OS is never under a folder: Linux init paths are never under the Windows live checkout.
  assert.equal(isUnder('/home/user/section-team/hooks', 'C:/Users/Asus/claude-team', LINUX), false)
  assert.equal(isUnder('C:/Users/Asus/claude-team/hooks', '/home/user/section-team', LINUX), false)
})

test('isUnder keeps the Windows rules for Windows paths, on Windows and on Linux', () => {
  for (const platform of [WINDOWS, LINUX]) {
    assert.equal(isUnder('C:/Users/Asus/Claude-Team/hooks', 'C:/Users/Asus/claude-team', platform), true, platform)
    assert.equal(isUnder('C:\\Users\\Asus\\claude-team', 'C:/Users/Asus/claude-team', platform), true, platform)
    assert.equal(isUnder('C:/Users/Asus/claude-team-moderound/x', 'C:/Users/Asus/claude-team', platform), false, platform)
    assert.equal(isUnder('D:/Users/Asus/claude-team/hooks', 'C:/Users/Asus/claude-team', platform), false, platform)
  }
  // On Windows a drive-less rooted path is still a Windows path, compared without case, as before.
  assert.equal(isUnder('/tmp/ST', '/tmp/st', WINDOWS), true)
})

test('samePath: Linux compares case for case after resolving; Windows ignores case and slashes', () => {
  assert.equal(samePath('/root/w', '/root/w/', LINUX), true)
  assert.equal(samePath('/root/w/../w', '/root/w', LINUX), true)
  assert.equal(samePath('/root/w', '/root/W', LINUX), false)
  assert.equal(samePath('/root/w', 'C:/root/w', LINUX), false)
  assert.equal(samePath('C:\\Users\\Asus\\Section-Team-v0.2.1\\', 'C:/Users/Asus/section-team-v0.2.1', LINUX), true)
  assert.equal(samePath('C:\\Users\\Asus\\Section-Team-v0.2.1\\', 'C:/Users/Asus/section-team-v0.2.1', WINDOWS), true)
})

test('insideFolder gives a folder-relative path with forward slashes, or null for the folder itself and anything outside', () => {
  const run = '/root/bench-runs/h4-0123abcd'
  assert.equal(insideFolder(run, `${run}/.team/near-miss/1-range.mjs`, LINUX), '.team/near-miss/1-range.mjs')
  assert.equal(insideFolder(run, 'src/server.mjs', LINUX), 'src/server.mjs')
  assert.equal(insideFolder(run, './README.md', LINUX), 'README.md')
  for (const p of [run, `${run}/`, '/root/bench-runs/h4-0123abcd-attempt-1/x.mjs', '/root/bench-runs/H4-0123ABCD/x.mjs', '/tmp/x', 'C:/root/bench-runs/h4-0123abcd/x', '../x']) {
    assert.equal(insideFolder(run, p, LINUX), null, p)
  }
  // On Linux a backslash is part of a file name, so this names a file beside the run folder, not in it.
  assert.equal(insideFolder(run, `${run}\\.team\\near-miss\\1-range.mjs`, LINUX), null)
  const winRun = 'C:/Users/Asus/bench-runs/h4-0123abcd'
  for (const platform of [WINDOWS, LINUX]) {
    assert.equal(insideFolder(winRun, 'C:\\Users\\Asus\\Bench-Runs\\h4-0123abcd\\.team\\near-miss\\x.mjs', platform), '.team/near-miss/x.mjs', platform)
    assert.equal(insideFolder(winRun, 'src\\app.js', platform), 'src/app.js', platform)
    assert.equal(insideFolder(winRun, 'D:/Users/Asus/bench-runs/h4-0123abcd/x', platform), null, platform)
  }
  assert.equal(insideFolder(winRun, '/tmp/x', LINUX), null, 'a Linux path is never inside a Windows run folder')
})
