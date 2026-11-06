// Hidden set reg2 of task p1: stage 1's behaviour again, on the code as it stood after stage 2 (TARGET_DIR is the copy).
// S1_DIR is the code after stage 1, which writes the database that must still work.
import { stageOneCases } from './stage-one-cases.mjs'

stageOneCases({ stage: 2 })
