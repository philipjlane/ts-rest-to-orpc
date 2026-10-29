import { Node, Project, QuoteKind, ScriptKind, SyntaxKind, type CallExpression, type SourceFile, type VariableDeclaration } from 'ts-morph'
import { detectQuote, report, type TransformContext } from './context.js'
import { EMPTY_INHERITED, renderRoute, renderRouterCall, renderRouterObject, typeCall } from './render.js'
import { detectSchemaLib } from './schema-lib.js'
import { contractCallMember, isRouterCall, isRouterLiteral, unwrapExpression, unwrapRoute } from './ts-rest.js'
import { resolveOptions, type Diagnostic, type TransformOptions, type TransformResult } from './types.js'

const TS_REST_MODULES = new Set(['@ts-rest/core'])
const CONTRACT_FACTORIES = new Set(['initContract', 'initTsRest'])
const TYPE_RENAMES: Record<string, string> = {
  AppRouter: 'AnyContractRouter',
  AppRoute: 'AnyContractProcedure',
}

interface Edit {
  start: number
  end: number
  text: string
}

export function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 /* preserve */, target: 99, module: 99 },
  })
}

/** Transform a single source string. */
export function transform(code: string, options: TransformOptions = {}, filePath = 'contract.ts'): TransformResult {
  const project = createProject()
  const file = project.createSourceFile(filePath, code, { overwrite: true, scriptKind: scriptKindFor(filePath) })
  return transformSourceFile(file, options)
}

function scriptKindFor(filePath: string): ScriptKind {
  if (filePath.endsWith('.tsx')) return ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ScriptKind.JSX
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return ScriptKind.JS
  return ScriptKind.TS
}

export function transformSourceFile(file: SourceFile, rawOptions: TransformOptions = {}): TransformResult {
  const original = file.getFullText()
  const options = resolveOptions(rawOptions)
  const contractIdents = findContractIdents(file)
  const tsRestImports = file.getImportDeclarations().filter((d) => TS_REST_MODULES.has(d.getModuleSpecifierValue()))

  if (contractIdents.size === 0 && tsRestImports.length === 0) {
    return { code: original, changed: false, diagnostics: [] }
  }

  const ctx: TransformContext = {
    file,
    options,
    schema: detectSchemaLib(file, options.schema),
    contractIdents,
    quote: detectQuote(file),
    diagnostics: [],
    contractImports: new Set(),
    contractTypeImports: new Set(),
    needsOpenapi: false,
    schemaLibWarned: false,
  }

  const edits = collectEdits(ctx)
  if (edits.length === 0 && tsRestImports.length === 0) {
    return { code: original, changed: false, diagnostics: ctx.diagnostics }
  }

  applyEdits(file, edits)
  file.getProject().manipulationSettings.set({ quoteKind: ctx.quote === '"' ? QuoteKind.Double : QuoteKind.Single })
  rewriteImports(ctx)

  const code = file.getFullText()
  return { code, changed: code !== original, diagnostics: sortDiagnostics(ctx.diagnostics) }
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => a.line - b.line)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function findContractIdents(file: SourceFile): Set<string> {
  const idents = new Set<string>()
  for (const decl of file.getVariableDeclarations()) {
    const init = decl.getInitializer()
    if (!init || !Node.isCallExpression(init)) continue
    const callee = init.getExpression()
    const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : ''
    if (CONTRACT_FACTORIES.has(name)) idents.add(decl.getName())
  }
  if (idents.size > 0) return idents

  // The contract instance may be imported from another file: look for `x.router({ ...routes })`.
  file.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return
    const callee = node.getExpression()
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'router') return
    const target = callee.getExpression()
    const arg = node.getArguments()[0]
    if (!Node.isIdentifier(target) || !arg || !Node.isObjectLiteralExpression(arg)) return
    const probe: TransformContext = { contractIdents: new Set([target.getText()]) } as TransformContext
    if (isRouterLiteral(probe, arg)) idents.add(target.getText())
  })
  return idents
}

function indentOf(node: Node): string {
  const text = node.getSourceFile().getFullText()
  const lineStart = text.lastIndexOf('\n', node.getStart() - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart, node.getStart()))?.[0] ?? ''
}

function insideRouterCall(ctx: TransformContext, node: Node): boolean {
  return node.getAncestors().some((a) => isRouterCall(ctx, a))
}

function collectEdits(ctx: TransformContext): Edit[] {
  const edits: Edit[] = []
  const { file } = ctx

  // 1. Router calls (outermost only; nested ones are rendered recursively).
  file.forEachDescendant((node) => {
    if (!isRouterCall(ctx, node) || insideRouterCall(ctx, node)) return
    const call = node as CallExpression
    const text = renderRouterCall(ctx, call, EMPTY_INHERITED, indentOf(call))
    edits.push({ start: call.getStart(), end: call.getEnd(), text })
  })

  // 2. Standalone routes and router objects bound to variables (at any depth).
  for (const decl of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer()
    if (!init || insideRouterCall(ctx, decl)) continue
    const inner = unwrapExpression(init)
    const route = unwrapRoute(ctx, inner)
    const indent = indentOf(decl.getVariableStatement() ?? decl)
    if (route) {
      const rendered = renderRoute(ctx, route, EMPTY_INHERITED, indent)
      edits.push({ start: init.getStart(), end: init.getEnd(), text: rendered.text })
      if (ctx.options.comments && rendered.notes.length > 0) {
        const statement = decl.getVariableStatement() ?? decl
        edits.push({ start: statement.getStart(), end: statement.getStart(), text: rendered.notes.map((n) => `// TODO(ts-rest-to-orpc): ${n}\n${indent}`).join('') })
      }
      noteStrippedWrapper(ctx, decl, init, inner)
      continue
    }
    if (Node.isObjectLiteralExpression(inner) && isRouterLiteral(ctx, inner)) {
      edits.push({ start: init.getStart(), end: init.getEnd(), text: renderRouterObject(ctx, inner, EMPTY_INHERITED, indent) })
      noteStrippedWrapper(ctx, decl, init, inner)
    }
  }

  // 3. Loose contract helper calls outside anything converted above.
  const converted = edits.map((e) => [e.start, e.end] as const)
  const alreadyConverted = (node: Node): boolean => converted.some(([s, e]) => s <= node.getStart() && node.getEnd() <= e)
  file.forEachDescendant((node) => {
    const member = contractCallMember(ctx, node)
    if (!member || alreadyConverted(node)) return
    const call = node as CallExpression
    const line = call.getStartLineNumber()
    if (member === 'type' || member === 'body' || member === 'response') {
      const typeArgs = call.getTypeArguments().map((t) => t.getText()).join(', ') || 'unknown'
      edits.push({ start: call.getStart(), end: call.getEnd(), text: typeCall(ctx, typeArgs, call) })
    } else if (member === 'router') {
      // Already handled above.
    } else if (member === 'query' || member === 'mutation') {
      // Handled in step 2 when bound to a variable; anything else is reported below.
      if (!Node.isVariableDeclaration(call.getParent())) {
        report(ctx, 'warn', 'route-not-converted', `\`c.${member}()\` used outside a router or variable declaration was left unchanged.`, line)
      }
    } else {
      report(ctx, 'warn', 'helper-not-converted', `\`c.${member}()\` used outside a route was left unchanged; oRPC has no direct equivalent.`, line)
    }
  })

  return dedupe(edits)
}

function noteStrippedWrapper(ctx: TransformContext, decl: VariableDeclaration, init: Node, inner: Node): void {
  if (init !== inner) {
    report(ctx, 'info', 'wrapper-stripped', `Removed \`as const\` / \`satisfies\` wrapper from \`${decl.getName()}\`; oRPC builders carry their own types.`, decl.getStartLineNumber())
  }
}

/** Drop edits that fall inside another edit's range. */
function dedupe(edits: Edit[]): Edit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: Edit[] = []
  let coveredUntil = -1
  for (const edit of sorted) {
    if (edit.start < coveredUntil && edit.end <= coveredUntil && edit.start !== edit.end) continue
    if (edit.start === edit.end && result.some((r) => r.start < edit.start && edit.start < r.end)) continue
    result.push(edit)
    coveredUntil = Math.max(coveredUntil, edit.end)
  }
  return result
}

function applyEdits(file: SourceFile, edits: Edit[]): void {
  let text = file.getFullText()
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  }
  file.replaceWithText(text)
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function rewriteImports(ctx: TransformContext): void {
  const { file } = ctx
  let insertIndex = 0
  const remainingTsRest: string[] = []

  for (const decl of file.getImportDeclarations()) {
    if (!TS_REST_MODULES.has(decl.getModuleSpecifierValue())) continue
    insertIndex = decl.getChildIndex()
    for (const spec of decl.getNamedImports()) {
      const name = spec.getName()
      if (CONTRACT_FACTORIES.has(name)) {
        spec.remove()
        continue
      }
      const renamed = TYPE_RENAMES[name]
      const nameNode = spec.getNameNode()
      if (renamed && !spec.getAliasNode() && Node.isIdentifier(nameNode)) {
        const stillUsed = nameNode.findReferencesAsNodes().some((r) => r !== nameNode)
        if (stillUsed) {
          nameNode.rename(renamed)
          ctx.contractTypeImports.add(renamed)
        }
        spec.remove()
        continue
      }
      remainingTsRest.push(name)
    }
    if (decl.getNamedImports().length === 0 && !decl.getDefaultImport() && !decl.getNamespaceImport()) {
      decl.remove()
    } else if (remainingTsRest.length > 0) {
      report(ctx, 'warn', 'ts-rest-import-remaining', `Still importing ${remainingTsRest.map((n) => `\`${n}\``).join(', ')} from @ts-rest/core; migrate these by hand.`, decl.getStartLineNumber())
    }
  }

  // Drop `const c = initContract()` once nothing references it.
  const removals: Node[] = []
  for (const decl of file.getVariableDeclarations()) {
    if (!ctx.contractIdents.has(decl.getName())) continue
    const init = decl.getInitializer()
    if (!init || !Node.isCallExpression(init)) continue
    const callee = init.getExpression()
    const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : ''
    if (!CONTRACT_FACTORIES.has(name)) continue
    const references = decl.findReferencesAsNodes().filter((r) => r !== decl.getNameNode())
    if (references.length === 0) {
      const statement = decl.getVariableStatement()
      if (statement && statement.getDeclarations().length === 1) removals.push(statement)
      else decl.remove()
    } else {
      report(ctx, 'warn', 'contract-instance-still-used', `\`${decl.getName()}\` is still referenced after conversion, so \`${name}()\` was kept.`, decl.getStartLineNumber())
    }
  }

  removeStatementsKeepingBlankLines(file, removals)

  if (ctx.contractImports.size > 0) {
    if (addNamedImports(ctx, '@orpc/contract', [...ctx.contractImports].sort(), insertIndex)) insertIndex++
  }
  if (ctx.contractTypeImports.size > 0) {
    if (addNamedImports(ctx, '@orpc/contract', [...ctx.contractTypeImports].sort(), insertIndex, true)) insertIndex++
  }
  if (ctx.needsOpenapi) {
    if (addNamedImports(ctx, '@orpc/openapi', ['openapi'], insertIndex)) insertIndex++
  }
  if (ctx.schema.kind === 'unknown' && usesGeneratedSchema(ctx)) {
    addNamedImports(ctx, 'zod', [ctx.schema.ident], insertIndex)
  }
}

function usesGeneratedSchema(ctx: TransformContext): boolean {
  const pattern = new RegExp(`\\b${ctx.schema.ident}\\.(object|union|literal|custom)\\(`)
  return pattern.test(ctx.file.getFullText())
}

/**
 * Remove whole statements while keeping the file's spacing sensible: the
 * statement, its own line break and at most one adjacent blank line go.
 */
function removeStatementsKeepingBlankLines(file: SourceFile, statements: Node[]): void {
  if (statements.length === 0) return
  let text = file.getFullText()
  const ranges = statements
    .map((s) => ({ start: s.getFullStart(), end: s.getEnd(), bodyStart: s.getStart() }))
    .sort((a, b) => b.start - a.start)
  for (const { start, end, bodyStart } of ranges) {
    let stop = end
    if (text[stop] === '\r') stop++
    if (text[stop] === '\n') stop++
    const hadBlankBefore = /\n[ \t]*\n/.test(text.slice(start, bodyStart))
    const hadBlankAfter = /^[ \t]*\r?\n/.test(text.slice(stop))
    let before = text.slice(0, start).replace(/[ \t]*\r?\n?$/, '')
    let after = text.slice(stop).replace(/^[ \t]*\r?\n/, '')
    const separator = before.length === 0 ? '' : hadBlankBefore || hadBlankAfter ? '\n\n' : '\n'
    text = before + separator + after
  }
  file.replaceWithText(text)
}

function usesSemicolons(file: SourceFile): boolean {
  const statements = file.getStatements()
  if (statements.length === 0) return true
  const withSemicolon = statements.filter((s) => s.getText().trimEnd().endsWith(';')).length
  return withSemicolon * 2 >= statements.length
}

/** Returns true when a new import declaration was inserted. */
function addNamedImports(ctx: TransformContext, moduleSpecifier: string, names: string[], index: number, typeOnly = false): boolean {
  const { file } = ctx
  const existing = file.getImportDeclaration((d) => d.getModuleSpecifierValue() === moduleSpecifier && d.isTypeOnly() === typeOnly)
  if (existing) {
    const present = new Set(existing.getNamedImports().map((s) => s.getName()))
    existing.addNamedImports(names.filter((n) => !present.has(n)))
    return false
  }
  const safeIndex = Math.min(index, file.getStatements().length)
  const decl = file.insertImportDeclaration(safeIndex, { moduleSpecifier, namedImports: names, isTypeOnly: typeOnly })
  if (!usesSemicolons(file)) decl.replaceWithText(decl.getText().replace(/;$/, ''))
  return true
}
