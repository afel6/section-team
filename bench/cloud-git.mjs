// Git steps for cloud-sync.mjs (spec: docs/specs/2026-11-01-mode-round-design.md, "Cloud amendment"): a worktree per
// sync branch, commits under the round's author address, the account-email scan before every push, and pushes that
// retry a failing network 4 times (2, 4, 8 and 16 s apart). The email is read from $CLAUDE_CODE_USER_EMAIL and never
// printed: a hit names the object or file it is in, not the address.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const EMAIL_VAR = 'CLAUDE_CODE_USER_EMAIL'
// Every commit of the round's branches is made under this address (the user's GitHub noreply address).
export const SYNC_AUTHOR = ['-c', 'user.name=Raouf', '-c', 'user.email=132957152+afel6@users.noreply.github.com']
export const RETRY_WAITS_MS = [2000, 4000, 8000, 16000]
const MAX_BUFFER = 2 * 1024 * 1024 * 1024
export const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
let attrSource

// Files go to the branch and back byte for byte: no end-of-line conversion from core.autocrlf (often true on Windows),
// and, on git 2.40 and later, attributes read from the empty tree, so no .gitattributes a solution ships converts
// either. Older git (a PC not yet updated) gets core.autocrlf=false alone.
function byteExact() {
  if (attrSource === undefined) {
    try {
      execFileSync('git', [`--attr-source=${EMPTY_TREE}`, 'version'], { stdio: 'ignore' })
      attrSource = [`--attr-source=${EMPTY_TREE}`]
    } catch {
      attrSource = []
    }
  }
  return ['-c', 'core.autocrlf=false', ...attrSource]
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Stops before a push, because the account email is in what would be pushed. main exits 1 on it: stop and report.
export class EmailFound extends Error {
  name = 'EmailFound'
  constructor(where) {
    super(`the account email ($${EMAIL_VAR}) is in ${where.join('; ')}: nothing was pushed; take it out of every unpushed commit (they stay local), then push again`)
    this.where = where
  }
}

// The batch can resume once the network is back: the next push sends what is committed here.
export class PushFailed extends Error {
  name = 'PushFailed'
}

// git's stdout, trimmed text (or a Buffer with text false); a failure is one line naming the command and git's last line.
// Every call is byte-exact (see byteExact).
export function git(args, { cwd, input, text = true } = {}) {
  try {
    const out = execFileSync('git', [...byteExact(), ...args], { cwd, input, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'] })
    return text ? out.toString('utf8').trim() : out
  } catch (err) {
    const why = String(err.stderr ?? '').trim().split('\n').at(-1) || err.code || `exit ${err.status}`
    throw new Error(`git ${args.join(' ')} failed: ${why}`, { cause: err })
  }
}

// The same, or null when git fails (for questions such as "does this ref exist").
export function tryGit(args, options) {
  try {
    return git(args, options)
  } catch {
    return null
  }
}

// A git call that talks to the remote, retried like a push; a network failure is a PushFailed (resumable).
function remoteGit(args, { cwd, wait = sleep, remote = 'origin' }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return git(args, { cwd })
    } catch (err) {
      if (attempt >= RETRY_WAITS_MS.length) {
        throw new PushFailed(`could not reach ${remote} after ${attempt + 1} tries (${err.message}); nothing was lost: the next publish sends it`, { cause: err })
      }
      wait(RETRY_WAITS_MS[attempt])
    }
  }
}

// Whether the remote has the branch (a network failure is a PushFailed).
export const remoteHasBranch = ({ cwd, branch, remote = 'origin', wait }) => remoteGit(['ls-remote', '--heads', remote, `refs/heads/${branch}`], { cwd, wait, remote }) !== ''

// Fetches the remote branch into its remote-tracking ref (a network failure is a PushFailed).
export const fetchBranch = ({ cwd, branch, remote = 'origin', wait }) => remoteGit(['fetch', '-q', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { cwd, wait, remote })

export function checkBranch(branch) {
  if (typeof branch !== 'string' || !BRANCH.test(branch)) throw new RangeError(`--sync= and --branch= take a branch name such as bench/mode-round-cloud-results, got "${branch}"`)
  return branch
}

// The account email, which must be set: without it the scan cannot run, so nothing may be pushed.
export function accountEmail(env = process.env) {
  const email = env[EMAIL_VAR]
  if (typeof email !== 'string' || !email.includes('@')) throw new Error(`$${EMAIL_VAR} is not set: the push scan cannot run, so nothing is pushed`)
  return email
}

// The objects of `git cat-file --batch` output: { oid, type, body }.
export function batchObjects(buffer) {
  const objects = []
  let at = 0
  while (at < buffer.length) {
    const end = buffer.indexOf(0x0a, at)
    const [oid, type, size] = buffer.subarray(at, end).toString('latin1').split(' ')
    if (type === 'missing') {
      at = end + 1
      continue
    }
    const length = Number(size)
    objects.push({ oid, type, body: buffer.subarray(end + 1, end + 1 + length) })
    at = end + 1 + length + 1
  }
  return objects
}

// The address in any letter case, also written with %40 as in a URL.
export function holdsEmail(bytes, email) {
  const text = Buffer.from(bytes).toString('latin1').toLowerCase()
  const lower = email.toLowerCase()
  return text.includes(lower) || text.includes(lower.replace('@', '%40'))
}

// Every spelling holdsEmail finds, replaced; null when there is none. latin1 keeps every other byte as it was.
export function withoutEmail(bytes, email, placeholder) {
  if (!holdsEmail(bytes, email)) return null
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escape(email)}|${escape(email.replace('@', '%40'))}`, 'gi')
  return Buffer.from(Buffer.from(bytes).toString('latin1').replace(pattern, placeholder), 'latin1')
}

const hitsIn = (buffer, email, nameOf) => batchObjects(buffer).filter(o => holdsEmail(o.body, email)).map(nameOf)

// What a push of rev would send: every object reachable from it and from no remote-tracking branch of remote.
export function scanOutgoing({ cwd, email, rev = 'HEAD', remote = 'origin' }) {
  const listing = git(['rev-list', '--objects', rev, '--not', `--remotes=${remote}`], { cwd })
  const paths = new Map(listing.split('\n').filter(Boolean).map(line => {
    const space = line.indexOf(' ')
    return space === -1 ? [line, ''] : [line.slice(0, space), line.slice(space + 1)]
  }))
  if (paths.size === 0) return []
  const out = git(['cat-file', '--batch'], { cwd, input: `${[...paths.keys()].join('\n')}\n`, text: false })
  return hitsIn(out, email, o => (paths.get(o.oid) ? paths.get(o.oid) : `${o.type} ${o.oid.slice(0, 12)}`))
}

// Every object of a solution folder's own repo (its commits, authors and files), which its bundle carries compressed.
export function scanHistory({ cwd, email, label }) {
  if (!existsSync(join(cwd, '.git'))) return []
  const out = git(['cat-file', '--batch-all-objects', '--batch'], { cwd, text: false })
  return hitsIn(out, email, o => `${label} history (${o.type} ${o.oid.slice(0, 12)})`)
}

// A worktree of branch at dir: reused when it is there; else the local branch, else the remote one, else a new orphan.
// When the remote branch exists, the worktree is fast-forwarded to it; a branch that diverged from it stops here.
export function openWorktree({ repo, branch, dir, remote = 'origin', wait }) {
  checkBranch(branch)
  if (existsSync(join(dir, '.git'))) {
    const head = git(['symbolic-ref', '--short', 'HEAD'], { cwd: dir })
    if (head !== branch) throw new Error(`${dir} is a worktree of ${head}, not ${branch}`)
  } else {
    if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} exists and is not a worktree of ${branch}: move it away first`)
    git(['worktree', 'prune'], { cwd: repo })
    const remoteHas = remoteHasBranch({ cwd: repo, branch, remote, wait })
    if (remoteHas) fetchBranch({ cwd: repo, branch, remote, wait })
    const local = tryGit(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: repo }) !== null
    if (local) git(['worktree', 'add', '-q', dir, branch], { cwd: repo })
    else if (remoteHas) git(['worktree', 'add', '-q', '-b', branch, dir, `${remote}/${branch}`], { cwd: repo })
    else git(['worktree', 'add', '-q', '--orphan', '-b', branch, dir], { cwd: repo })
  }
  catchUp({ dir, branch, remote, wait })
  return dir
}

function catchUp({ dir, branch, remote, wait }) {
  if (!remoteHasBranch({ cwd: dir, branch, remote, wait })) return
  fetchBranch({ cwd: dir, branch, remote, wait })
  if (tryGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: dir }) === null) {
    git(['reset', '-q', '--hard', `${remote}/${branch}`], { cwd: dir })
    return
  }
  if (tryGit(['merge', '--ff-only', '-q', `${remote}/${branch}`], { cwd: dir }) === null) {
    throw new Error(`${branch} in ${dir} and ${remote}/${branch} have diverged: compare them before any push`)
  }
}

// Stages paths (ignored files too: a solution's own .gitignore must not drop its files) and commits; false when
// nothing changed.
export function commitPaths({ cwd, paths, message }) {
  git(['add', '-A', '-f', '--', ...paths], { cwd })
  if (tryGit(['diff', '--cached', '--quiet'], { cwd }) !== null) return false
  git([...SYNC_AUTHOR, 'commit', '-q', '-m', message], { cwd })
  return true
}

// Commits not yet on the remote branch (all of them when it has none).
export function unpushed({ cwd, branch, remote = 'origin' }) {
  if (tryGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd }) === null) return 0
  const tracked = tryGit(['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`], { cwd }) !== null
  return Number(git(['rev-list', '--count', tracked ? `${remote}/${branch}..HEAD` : 'HEAD'], { cwd }))
}

// Scans what the push would send, then pushes, retrying a failure 4 times. Nothing to push: no scan, no push.
export function scanAndPush({ cwd, branch, email, remote = 'origin', wait = sleep, push = () => git(['push', '-q', remote, `HEAD:refs/heads/${branch}`], { cwd }) }) {
  if (unpushed({ cwd, branch, remote }) === 0) return false
  const hits = scanOutgoing({ cwd, email, remote })
  if (hits.length > 0) throw new EmailFound(hits)
  for (let attempt = 0; ; attempt++) {
    try {
      push()
      return true
    } catch (err) {
      if (attempt >= RETRY_WAITS_MS.length) {
        throw new PushFailed(`could not push ${branch} after ${attempt + 1} tries (${err.message}); its commits stay in ${cwd}, and the next push sends them`, { cause: err })
      }
      wait(RETRY_WAITS_MS[attempt])
    }
  }
}
