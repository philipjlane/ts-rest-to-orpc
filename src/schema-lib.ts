import type { SourceFile } from 'ts-morph'
import type { SchemaLibrary } from './types.js'

export type SchemaLibKind = 'zod' | 'valibot' | 'unknown'

export interface SchemaLib {
  kind: SchemaLibKind
  /** Namespace identifier used in generated code, e.g. `z` or `v`. */
  ident: string
  object(entries: Array<[key: string, value: string]>, indent: string): string
  union(members: string[], indent: string): string
  literal(value: string): string
  string(): string
  custom(typeArgs: string): string
  /** Merge two object schemas, `base` first. */
  merge(base: string, extra: string): string
  /** Merge an object schema with inline entries. */
  extend(base: string, entries: Array<[key: string, value: string]>, indent: string): string
}

const ZOD_MODULES = new Set(['zod', 'zod/v4', 'zod/v3', 'zod/mini', 'zod/v4-mini', 'zod/v4/mini'])

function renderEntries(entries: Array<[string, string]>, indent: string): string {
  if (entries.length === 0) return '{}'
  const inner = entries.map(([key, value]) => `${indent}  ${key}: ${value},`).join('\n')
  return `{\n${inner}\n${indent}}`
}

function zod(ident: string, kind: SchemaLibKind = 'zod'): SchemaLib {
  return {
    kind,
    ident,
    object: (entries, indent) => `${ident}.object(${renderEntries(entries, indent)})`,
    union: (members, indent) =>
      `${ident}.union([\n${members.map((m) => `${indent}  ${m},`).join('\n')}\n${indent}])`,
    literal: (value) => `${ident}.literal(${value})`,
    string: () => `${ident}.string()`,
    custom: (typeArgs) => `${ident}.custom<${typeArgs}>()`,
    merge: (base, extra) => `${base}.extend(${extra}.shape)`,
    extend: (base, entries, indent) => `${base}.extend(${renderEntries(entries, indent)})`,
  }
}

function valibot(ident: string): SchemaLib {
  return {
    kind: 'valibot',
    ident,
    object: (entries, indent) => `${ident}.object(${renderEntries(entries, indent)})`,
    union: (members, indent) =>
      `${ident}.union([\n${members.map((m) => `${indent}  ${m},`).join('\n')}\n${indent}])`,
    literal: (value) => `${ident}.literal(${value})`,
    string: () => `${ident}.string()`,
    custom: (typeArgs) => `${ident}.custom<${typeArgs}>(() => true)`,
    merge: (base, extra) => `${ident}.object({ ...${base}.entries, ...${extra}.entries })`,
    extend: (base, entries, indent) =>
      `${ident}.object({ ...${base}.entries, ...${renderEntries(entries, indent)} })`,
  }
}

function namespaceIdent(file: SourceFile, modules: Set<string>, named: string[]): string | undefined {
  for (const decl of file.getImportDeclarations()) {
    if (!modules.has(decl.getModuleSpecifierValue())) continue
    const ns = decl.getNamespaceImport()
    if (ns) return ns.getText()
    const def = decl.getDefaultImport()
    if (def) return def.getText()
    for (const spec of decl.getNamedImports()) {
      if (named.includes(spec.getName())) return (spec.getAliasNode() ?? spec.getNameNode()).getText()
    }
  }
  return undefined
}

/** Detect the schema library used by a file from its imports. */
export function detectSchemaLib(file: SourceFile, preference: SchemaLibrary): SchemaLib {
  const zodIdent = namespaceIdent(file, ZOD_MODULES, ['z'])
  const valibotIdent = namespaceIdent(file, new Set(['valibot']), ['v'])

  if (preference === 'zod') return zod(zodIdent ?? 'z')
  if (preference === 'valibot') return valibot(valibotIdent ?? 'v')
  if (zodIdent) return zod(zodIdent)
  if (valibotIdent) return valibot(valibotIdent)

  // Fall back to zod conventions, but flag it as a guess.
  return zod('z', 'unknown')
}
