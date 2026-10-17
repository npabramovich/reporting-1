#!/usr/bin/env node
// fund-engine CLI. Runs the built output (dist/) when present — the published package — and the
// TypeScript source otherwise, which Node 22.18+ runs directly (type stripping, no build step).

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const built = path.join(here, '..', 'dist', 'cli.js')
const source = path.join(here, '..', 'src', 'cli.ts')

// Node announces type stripping as experimental on every run; that is noise on a CLI's stderr.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? ''
  if (/type stripping/i.test(text)) return
  return emit.call(process, warning, ...rest)
}

let cli
try {
  cli = await import(pathToFileURL(existsSync(built) ? built : source).href)
} catch (error) {
  process.stderr.write(
    `fund-engine: could not load the engine (${error?.message ?? error}).\n` +
    'Run it with Node 22.18 or later, or build it first with `npm run build` in packages/fund-engine.\n',
  )
  process.exit(2)
}

const result = cli.runCli(process.argv.slice(2), file => readFileSync(path.resolve(process.cwd(), file), 'utf8'))
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
process.exitCode = result.code
