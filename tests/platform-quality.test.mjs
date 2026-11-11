import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assembleBrief } from '../hooks/lib/brief.mjs'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(fileURLToPath(new URL(path, root)), 'utf8')
const MODES = ['balanced', 'max']
const FOUNDATION = '- When the work first spans two or more builder areas (a new platform, or a request that adds a second area to an existing product), load the section-team:foundation skill before you wake anyone; work inside the areas its note already covers does not load it again.'
const SECURITY = ' Work touching auth, payments, uploads or secrets also wakes the security section.'
const WHOLE_STACK = 'The final review runs the whole test suite, starts the app, and drives the critical flows through its real interfaces'

test('the foundation skill has valid frontmatter and every required step heading', () => {
  const text = read('skills/foundation/SKILL.md')
  const match = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/)
  assert.ok(match, 'frontmatter with name then description')
  assert.equal(match[1], 'foundation')
  assert.ok(match[2].length > 40)
  const headings = ['Ask', 'Write the foundation note', 'Check the plan', 'Get the OK', 'Freeze it', 'Keep the plan', 'Build one slice at a time']
  assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map(m => m[1]), headings, 'headings missing or out of order')
  const noteContents = ['purpose and non-goals', 'stack, with one reason each', 'data model', 'API and interface contracts;\n- for each request that waits on an outside call, what it reads again before it writes;\n- auth and security needs', 'build order as vertical slices', 'test plan', 'deploy and migration rules', 'commit policy']
  for (const needle of [...noteContents, 'wake nobody until they say OK', 'frozen', 'whole-stack verification', 'at most 5 questions', '.team/notes/foundation.md', 'under 150 lines', '.team/notes/decisions.md', '.team/notes/plan.md', 'commit after each job']) {
    assert.ok(text.includes(needle), `missing ${needle}`)
  }
})

test('the foundation skill triggers on a new multi-area platform, not on a count of builders', () => {
  const text = read('skills/foundation/SKILL.md')
  const trigger = 'work first spans two or more builder areas, whether a new platform or a request that adds a second area to an existing product'
  assert.ok(text.match(/^description: (.+)$/m)[1].includes(trigger), 'description')
  assert.ok(text.split('# Foundation first\n\n')[1].split('\n')[0].includes(trigger), 'first paragraph')
  assert.ok(!text.includes('3 or more'))
  assert.ok(text.includes('For an existing product, write the note from the current code and the new request.'))
})

test('the foundation skill says where .team/ is, and names the note and slice in each job, by full path in a worktree session', () => {
  const text = read('skills/foundation/SKILL.md')
  assert.ok(text.includes('`.team/` is at the project root, which is the main checkout in a worktree session: keep these notes there.'))
  const build = text.split('## Build one slice at a time\n')[1]
  assert.ok(build.includes('Each job message names the foundation note and the slice. In a worktree session, give the note\'s full path.'))
})

test('the supervisor creates a missing repo itself and keeps both .team/ and section memory out of its first commit', () => {
  const build = read('skills/foundation/SKILL.md').split('## Build one slice at a time\n')[1]
  assert.ok(build.includes('If there is no repo yet, create it yourself before the first job and add both `.team/` and `**/.claude/agent-memory-local/` to `.git/info/exclude`, because session start only does that for a repo that already exists.'))
})

test('every tier file sends a new multi-area platform to the foundation skill, just before the short plan rule', () => {
  for (const mode of MODES) {
    const tiers = read(`brief/tiers-${mode}.md`).split('\n')
    const plan = tiers.findIndex(l => l.startsWith('- 3 or more distinct builders'))
    assert.equal(tiers[plan - 1], FOUNDATION, mode)
    assert.ok(tiers[plan].endsWith('wake nobody until the user says OK.'), mode)
  }
})

test('balanced multi-area lines wake security for risky work; max does not repeat it', () => {
  for (const mode of ['balanced']) {
    const line = read(`brief/tiers-${mode}.md`).split('\n').find(l => l.startsWith('- Multi-area work'))
    assert.ok(line.includes(`parts that touch the same files run one after another.${SECURITY}`), mode)
  }
  assert.ok(!read('brief/tiers-max.md').includes('also wakes the security section'))
})

test('docs wake after the builders report in every mode', () => {
  for (const mode of ['balanced']) {
    assert.ok(read(`brief/tiers-${mode}.md`).includes('when the task asks for docs or a README, after the builders report'), mode)
  }
  assert.ok(read('brief/tiers-max.md').includes('and the docs section always, after the builders report'))
})

test('the final review runs the whole stack in the brief and in the testing section', () => {
  assert.ok(assembleBrief('balanced').includes(`${WHOLE_STACK}.`))
  assert.ok(read('agents/testing.md').includes(`${WHOLE_STACK}, reporting the commands and results.`))
  assert.ok(read('agents/testing.md').includes('Changed files are where to start, not the limit.'))
})

test('the foundation skill checks the plan with the plan advisor before asking for the OK', () => {
  const text = read('skills/foundation/SKILL.md')
  assert.ok(text.indexOf('## Check the plan') > 0 && text.indexOf('## Check the plan') < text.indexOf('## Get the OK'))
  assert.ok(text.includes('section-team:plan-advisor'))
  assert.ok(text.includes('advice you took and the advice you did not, with why'))
})

test('the plan advisor is named in the brief but not in any tier line', () => {
  for (const mode of MODES) {
    assert.ok(assembleBrief(mode).includes('plan-advisor'), mode)
    assert.ok(!read(`brief/tiers-${mode}.md`).includes('plan-advisor'), `${mode} tiers`)
  }
})

test('every mode brief stays under 9000 characters with the plan advisor', () => {
  for (const mode of MODES) assert.ok(assembleBrief(mode).length < 9000, mode)
})
