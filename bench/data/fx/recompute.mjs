// Recomputes round fx's numbers from the files in its folder, with the same code as round hq. Read-only.
// Setups: solo-fx (plain Claude Code), team-fx (Balanced as released, v0.4.0), team-fy (Balanced with commit 4b07ff0).
// Usage: node bench/data/fx/recompute.mjs
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recomputeTasks } from '../hq/recompute.mjs'

recomputeTasks(dirname(fileURLToPath(import.meta.url)), 'fx', 'solo-fx')
