/** Which oRPC major version the generated code should target. */
export type Target = 'v1' | 'v2'

/**
 * How request parts (params, query, headers, body) are shaped in `.input()`.
 *
 * - `auto`: compact when a route has at most one request part, otherwise detailed.
 * - `detailed`: always `{ params, query, headers, body }`.
 * - `compact`: merge params and query/body into one object where the schema
 *   library allows it; falls back to detailed for headers.
 */
export type InputStructureMode = 'auto' | 'detailed' | 'compact'

export type SchemaLibrary = 'zod' | 'valibot' | 'auto'

export interface TransformOptions {
  target?: Target
  inputStructure?: InputStructureMode
  schema?: SchemaLibrary
  /** Insert `// TODO(ts-rest-to-orpc)` comments above procedures that need attention. */
  comments?: boolean
}

export type ResolvedOptions = Required<TransformOptions>

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface Diagnostic {
  level: DiagnosticLevel
  code: string
  message: string
  /** 1-based line in the original source. */
  line: number
}

export interface TransformResult {
  code: string
  changed: boolean
  diagnostics: Diagnostic[]
}

export function resolveOptions(options: TransformOptions = {}): ResolvedOptions {
  return {
    target: options.target ?? 'v1',
    inputStructure: options.inputStructure ?? 'auto',
    schema: options.schema ?? 'auto',
    comments: options.comments ?? true,
  }
}
