/**
 * Writes converted fixtures into typecheck/<target>/generated so they can be
 * compiled against the real @orpc packages.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { transform } from '../src/index.js'

// Fixtures that are deliberately unconvertible or import local modules.
const SKIP = new Set(['edge-cases.ts', 'imported-contract.ts', 'no-schema-lib.ts'])

const root = path.join(import.meta.dirname, '..')
const fixturesDir = path.join(root, 'test', 'fixtures')

for (const target of ['v1', 'v2'] as const) {
  const outDir = path.join(root, 'typecheck', target, 'generated')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const fixture of readdirSync(fixturesDir)) {
    if (!fixture.endsWith('.ts') || SKIP.has(fixture)) continue
    const source = readFileSync(path.join(fixturesDir, fixture), 'utf8')
    for (const inputStructure of ['auto', 'detailed', 'compact'] as const) {
      const result = transform(source, { target, inputStructure }, fixture)
      writeFileSync(path.join(outDir, `${fixture.replace(/\.ts$/, '')}.${inputStructure}.ts`), result.code)
    }
  }
}
console.log('fixtures emitted')
