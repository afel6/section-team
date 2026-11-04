// What bars.mjs and bars-outside.mjs share: the round's bars config, input reading, judged qualities per group and
// setup, and how a gap is shown. A leaf module, so the two import it and never each other in a cycle.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DIMS } from './aggregate.mjs'
import { round } from './stats.mjs'

export const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
export const groupOf = run => `${run.task}-r${run.rep}`
export const configPath = roundTag => fileURLToPath(new URL(`./bars-${roundTag}.json`, import.meta.url))

export const readBars = (file = configPath('mo')) => JSON.parse(readFileSync(file, 'utf8'))

// One judge's scores for one solution; a score that is not a number stops the bars (a NaN gap would never miss).
function judged(row, label) {
  const values = DIMS.map(d => Number(row[label][d]))
  if (!values.every(Number.isFinite)) throw new Error(`judge row ${row.pair} judge ${row.judge}: ${label} has a score that is not a number`)
  return { quality: mean(values), tests: values[DIMS.indexOf('tests')] }
}

const cellOf = js => ({ quality: mean(js.map(j => j.quality)), tests: mean(js.map(j => j.tests)), judges: js.length })
const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]))

// { [group]: { [cond]: { quality, tests, judges } } }: per judge the mean of the 5 dimensions (and the tests score),
// averaged over the group's usable judges, as aggregate.mjs's judgeScores computes quality.
export function qualities(judgeRows, key) {
  const cells = {}
  for (const row of judgeRows) {
    for (const [label, cond] of Object.entries(key[row.pair] ?? {})) {
      if (!row[label]) continue
      cells[row.pair] = { ...cells[row.pair], [cond]: [...(cells[row.pair]?.[cond] ?? []), judged(row, label)] }
    }
  }
  return mapValues(cells, conds => mapValues(conds, cellOf))
}

export function readInput(path, hint, shape) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`missing ${path}: ${hint}`, { cause: err })
    throw new Error(`cannot read ${path} (${err.code ?? err.message})`, { cause: err })
  }
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON`, { cause: err })
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data) !== (shape === 'array')) throw new Error(`${path} is not a JSON ${shape}`)
  return data
}

// The sign comes from the rounded value, so a float-noise zero always prints +0.00.
export const shown = x => {
  const r = round(x, 2)
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}`
}
