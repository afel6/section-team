// The staged benchmark tasks: how many prompts each has and which hidden sets run on which folder.
// A task not listed here has one stage and one hidden file, hidden/<task>.test.mjs.
// A set's `from` is the folder it runs on: 's1', 's2' (the copy taken after that stage) or 'final'.
export const STAGES = { h7: 2, p1: 3 }

const SETS = {
  h7: [['s1', 's1'], ['s2', 'final'], ['reg', 'final']],
  p1: [['s1', 's1'], ['s2', 's2'], ['s3', 'final'], ['reg2', 's2'], ['reg3', 'final']],
}

export const stageCountOf = task => (Object.hasOwn(STAGES, task) ? STAGES[task] : 1)
export const isStaged = task => stageCountOf(task) > 1
export const stagePromptFile = (task, stage) => (stage === 1 ? `tasks/${task}.md` : `tasks/${task}-s${stage}.md`)
export const hiddenSetsOf = task => (Object.hasOwn(SETS, task) ? SETS[task].map(([set, from]) => ({ set, from })) : [])
export const stageCopyOf = (dir, stage) => `${dir}-s${stage}`
