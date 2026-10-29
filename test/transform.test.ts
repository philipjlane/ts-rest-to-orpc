import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { transform, type TransformOptions } from '../src/index.js'
import { convertPath } from '../src/path.js'
import { errorCodeForStatus } from '../src/errors.js'

const fixturesDir = path.join(import.meta.dirname, 'fixtures')
const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.ts'))

const variants: Array<[name: string, options: TransformOptions]> = [
  ['v1', { target: 'v1' }],
  ['v2', { target: 'v2' }],
  ['v1-detailed', { target: 'v1', inputStructure: 'detailed' }],
  ['v1-compact', { target: 'v1', inputStructure: 'compact' }],
]

describe('fixtures', () => {
  for (const fixture of fixtures) {
    const source = readFileSync(path.join(fixturesDir, fixture), 'utf8')
    const name = fixture.replace(/\.ts$/, '')
    for (const [variant, options] of variants) {
      it(`${name} (${variant})`, async () => {
        const result = transform(source, options, fixture)
        expect(result.changed).toBe(true)
        const diagnostics = result.diagnostics.map((d) => `${d.level} L${d.line} [${d.code}] ${d.message}`).join('\n')
        const header = `// Diagnostics:\n${diagnostics.split('\n').filter(Boolean).map((l) => `// ${l}`).join('\n')}\n\n`
        await expect(header + result.code).toMatchFileSnapshot(`__snapshots__/${name}.${variant}.ts`)
      })
    }
  }
})

describe('transform basics', () => {
  it('leaves files without ts-rest untouched', () => {
    const source = `export const x = { method: 'GET', path: '/x' }\n`
    const result = transform(source)
    expect(result.changed).toBe(false)
    expect(result.code).toBe(source)
  })

  it('converts a loose c.type() call', () => {
    const result = transform(`import { initContract } from '@ts-rest/core'\nconst c = initContract()\nexport const T = c.type<{ a: 1 }>()\n`)
    expect(result.code).toContain(`import { type } from '@orpc/contract'`)
    expect(result.code).toContain('export const T = type<{ a: 1 }>()')
    expect(result.code).not.toContain('initContract')
  })

  it('honours the comments option', () => {
    const source = `import { initContract } from '@ts-rest/core'\nconst c = initContract()\nexport const r = c.router({ a: { method: 'GET', path: '/a', responses: { 200: c.noBody(), 418: c.noBody() } } })\n`
    expect(transform(source, { target: 'v2' }).code).toContain('TODO(ts-rest-to-orpc)')
    expect(transform(source, { target: 'v2', comments: false }).code).not.toContain('TODO(ts-rest-to-orpc)')
  })
})

describe('convertPath', () => {
  it('rewrites params', () => {
    expect(convertPath('/posts/:postId/comments/:commentId')).toEqual({
      path: '/posts/{postId}/comments/{commentId}',
      params: ['postId', 'commentId'],
    })
  })
  it('leaves plain paths alone', () => {
    expect(convertPath('/posts')).toEqual({ path: '/posts', params: [] })
  })
})

describe('errorCodeForStatus', () => {
  it('maps known statuses', () => {
    expect(errorCodeForStatus(404)).toEqual({ code: 'NOT_FOUND', standard: true })
  })
  it('synthesises unknown statuses', () => {
    expect(errorCodeForStatus(418)).toEqual({ code: 'HTTP_418', standard: false })
  })
})
