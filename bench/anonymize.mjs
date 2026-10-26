// Copies each team/solo pair into neutral folders X and Y for blind judging, without anything that reveals
// the condition (.team/, .claude/, .superpowers/, .git, node_modules, databases). Writes the secret key to
// results/blind-key.json. Usage: node bench/anonymize.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { CONDITIONS, RESULTS, parseArgs } from './run.mjs'

// --round=v2 --conds=solo,team-v2,forced-v2 → judges those condition labels into bench-judge-v2, key blind-key-v2.json
const { round, conds } = parseArgs(process.argv.slice(2))
const COND_SET = round ? conds : CONDITIONS
const HOME = homedir().replaceAll('\\', '/')
export const JUDGE = round ? `${HOME}/bench-judge-${round}` : `${HOME}/bench-judge`
const HIDDEN = new Set(['.team', '.claude', '.superpowers', '.git', 'node_modules'])
const isHidden = src => HIDDEN.has(basename(src)) || /\.(db|db-wal|db-shm|sqlite)$/i.test(src)

function main() {
  rmSync(JUDGE, { recursive: true, force: true })
  const key = {}
  const LABELS = ['X', 'Y', 'Z']
  for (const [t, task] of ['easy', 'medium', 'hard'].entries()) {
    for (const rep of [1, 2]) {
      const pair = `${task}-r${rep}`
      const shift = (t + rep) % COND_SET.length
      const order = [...COND_SET.slice(shift), ...COND_SET.slice(0, shift)]
      key[pair] = Object.fromEntries(order.map((cond, i) => [LABELS[i], cond]))
      for (const [label, cond] of Object.entries(key[pair])) {
        const runPath = join(RESULTS, `${task}-${cond}-r${rep}`, 'run.json')
        if (!existsSync(runPath)) continue
        const { dir } = JSON.parse(readFileSync(runPath, 'utf8'))
        const dest = join(JUDGE, pair, label)
        mkdirSync(dest, { recursive: true })
        cpSync(dir, dest, { recursive: true, filter: src => !isHidden(src) })
      }
    }
  }
  writeFileSync(join(RESULTS, round ? `blind-key-${round}.json` : 'blind-key.json'), JSON.stringify(key, null, 2) + '\n')
  console.log('anonymized pairs:', Object.keys(key).join(' '))
}

if (isMainModule(import.meta.url)) main()
