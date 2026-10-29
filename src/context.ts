import type { SourceFile } from 'ts-morph'
import type { SchemaLib } from './schema-lib.js'
import type { Diagnostic, DiagnosticLevel, ResolvedOptions } from './types.js'

export interface TransformContext {
  file: SourceFile
  options: ResolvedOptions
  schema: SchemaLib
  /** Identifiers bound to `initContract()` (usually `c`). */
  contractIdents: Set<string>
  /** Quote character used for generated string literals. */
  quote: string
  diagnostics: Diagnostic[]
  /** Named value imports needed from `@orpc/contract`. */
  contractImports: Set<string>
  /** Named type-only imports needed from `@orpc/contract`. */
  contractTypeImports: Set<string>
  /** True once anything required `openapi` from `@orpc/openapi` (v2). */
  needsOpenapi: boolean
  /** True once the "schema library unknown" warning has been reported for this file. */
  schemaLibWarned: boolean
}

export function q(ctx: TransformContext, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(new RegExp(ctx.quote, 'g'), `\\${ctx.quote}`)
  return `${ctx.quote}${escaped}${ctx.quote}`
}

export function report(
  ctx: TransformContext,
  level: DiagnosticLevel,
  code: string,
  message: string,
  line: number,
): Diagnostic {
  const diagnostic: Diagnostic = { level, code, message, line }
  ctx.diagnostics.push(diagnostic)
  return diagnostic
}

/** Pick the quote style the file already uses most. */
export function detectQuote(file: SourceFile): string {
  const text = file.getFullText()
  const singles = (text.match(/'/g) ?? []).length
  const doubles = (text.match(/"/g) ?? []).length
  return doubles > singles ? '"' : "'"
}
