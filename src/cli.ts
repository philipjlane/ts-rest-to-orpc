#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { glob } from 'tinyglobby'
import { transform } from './transform.js'
import type { Diagnostic, InputStructureMode, SchemaLibrary, Target, TransformOptions } from './types.js'

interface CliFlags {
  target: string
  inputStructure: string
  schema: string
  comments: boolean
  dryRun: boolean
  print: boolean
  quiet: boolean
  verbose: boolean
}

const cli = cac('ts-rest-to-orpc')

cli
  .command('[...globs]', 'Convert ts-rest contracts to oRPC contracts')
  .option('--target <version>', 'oRPC major version to target: v1 or v2', { default: 'v1' })
  .option('--input-structure <mode>', 'auto, detailed or compact', { default: 'auto' })
  .option('--schema <lib>', 'Schema library for generated wrappers: auto, zod or valibot', { default: 'auto' })
  .option('--no-comments', 'Do not insert TODO comments for things that need attention')
  .option('--dry-run', 'Report what would change without writing files')
  .option('--print', 'Print transformed source to stdout instead of writing')
  .option('--quiet', 'Only print the summary')
  .option('--verbose', 'Also print informational notes, not just warnings and errors')
  .example('  ts-rest-to-orpc "src/**/*.contract.ts"')
  .example('  ts-rest-to-orpc "packages/api/src/**/*.ts" --target v2 --dry-run')
  .action(async (globs: string[], flags: CliFlags) => {
    const options = parseOptions(flags)
    const patterns = globs.length > 0 ? globs : ['**/*.{ts,tsx,mts,cts,js,mjs}']
    const files = await glob(patterns, { ignore: ['**/node_modules/**', '**/dist/**'], absolute: true })
    if (files.length === 0) {
      console.error(`No files matched: ${patterns.join(', ')}`)
      process.exitCode = 1
      return
    }

    let changed = 0
    const counts = { info: 0, warn: 0, error: 0 }
    for (const file of files.sort()) {
      const source = await readFile(file, 'utf8')
      if (!source.includes('@ts-rest') && !source.includes('.router(')) continue
      const result = transform(source, options, file)
      if (!result.changed && result.diagnostics.length === 0) continue
      const relative = path.relative(process.cwd(), file)
      if (result.changed) {
        changed++
        if (flags.print) process.stdout.write(`${result.code}\n`)
        else if (!flags.dryRun) await writeFile(file, result.code)
      }
      if (!flags.quiet) printDiagnostics(relative, result.changed, flags.verbose ? result.diagnostics : result.diagnostics.filter((d) => d.level !== 'info'))
      for (const d of result.diagnostics) counts[d.level]++
    }

    const verb = flags.dryRun ? 'would change' : flags.print ? 'converted' : 'changed'
    console.error(`\n${changed} file(s) ${verb}. ${counts.warn} warning(s), ${counts.error} error(s), ${counts.info} note(s).`)
  })

cli.help()
cli.version(packageVersion())

function packageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function parseOptions(flags: CliFlags): TransformOptions {
  const target = flags.target as Target
  const inputStructure = flags.inputStructure as InputStructureMode
  const schema = flags.schema as SchemaLibrary
  if (!['v1', 'v2'].includes(target)) fail(`--target must be v1 or v2 (got ${flags.target})`)
  if (!['auto', 'detailed', 'compact'].includes(inputStructure)) fail(`--input-structure must be auto, detailed or compact (got ${flags.inputStructure})`)
  if (!['auto', 'zod', 'valibot'].includes(schema)) fail(`--schema must be auto, zod or valibot (got ${flags.schema})`)
  return { target, inputStructure, schema, comments: flags.comments }
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

function printDiagnostics(file: string, changed: boolean, diagnostics: Diagnostic[]): void {
  console.error(`${changed ? '✔' : '•'} ${file}`)
  for (const d of diagnostics) {
    const tag = d.level === 'error' ? 'ERROR' : d.level === 'warn' ? 'WARN ' : 'info '
    console.error(`    ${tag} L${d.line} [${d.code}] ${d.message}`)
  }
}

try {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
