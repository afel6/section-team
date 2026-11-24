#!/usr/bin/env node
// Entry point: node timelog.mjs report <file> [--from <date>] [--to <date>]
import { run } from './lib/cli.mjs'

const { code, out, err } = run(process.argv.slice(2))
process.stdout.write(out)
process.stderr.write(err)
process.exitCode = code
