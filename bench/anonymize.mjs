// Copies each team/solo pair into neutral folders X and Y for blind judging, without anything that reveals
// the condition (.team/, .claude/, .superpowers/, .git, node_modules, databases). Writes the secret key to
// results/blind-key.json. Usage: node bench/anonymize.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { RESULTS } from './run.mjs'

export const JUDGE = 'C:/Users/Asus/bench-judge'
const HIDDEN = new Set(['.team', '.claude', '.superpowers', '.git', 'node_modules'])
const isHidden = src => HIDDEN.has(basename(src)) || /\.(db|db-wal|db-shm|sqlite)$/i.test(src)

function main() {
  rmSync(JUDGE, { recursive: true, force: true })
  const key = {}
  for (const task of ['easy', 'medium', 'hard']) {
    for (const rep of [1, 2]) {
      const pair = `${task}-r${rep}`
      const order = rep === 1 ? ['team', 'solo'] : ['solo', 'team']
      key[pair] = { X: order[0], Y: order[1] }
      for (const [label, cond] of [['X', order[0]], ['Y', order[1]]]) {
        const runPath = join(RESULTS, `${task}-${cond}-r${rep}`, 'run.json')
        if (!existsSync(runPath)) continue
        const { dir } = JSON.parse(readFileSync(runPath, 'utf8'))
        const dest = join(JUDGE, pair, label)
        mkdirSync(dest, { recursive: true })
        cpSync(dir, dest, { recursive: true, filter: src => !isHidden(src) })
      }
    }
  }
  writeFileSync(join(RESULTS, 'blind-key.json'), JSON.stringify(key, null, 2) + '\n')
  console.log('anonymized pairs:', Object.keys(key).join(' '))
}

if (isMainModule(import.meta.url)) main()
