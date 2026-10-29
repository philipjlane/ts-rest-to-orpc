import {
  Node,
  Project,
  QuoteKind,
  ScriptKind,
  SyntaxKind,
  type CallExpression,
  type ImportDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from 'ts-morph'
import { detectIndentUnit, detectQuote, report, type TransformContext } from './context.js'
import { EMPTY_INHERITED, renderRoute, renderRouterCall, renderRouterObject, typeCall } from './render.js'
import { detectSchemaLib } from './schema-lib.js'
import { contractCallMember, isFactoryCall, isRouterCall, isRouterLiteral, unwrapExpression, unwrapRoute } from './ts-rest.js'
import { resolveOptions, type Diagnostic, type TransformOptions, type TransformResult } from './types.js'

const TS_REST_MODULES = new Set(['@ts-rest/core'])
const CONTRACT_FACTORIES = new Set(['initContract', 'initTsRest'])
const ROUTER_OPTION_KEYS = new Set(['pathPrefix', 'baseHeaders', 'strictStatusCodes', 'commonResponses', 'metadata', 'validateResponseOnClient'])
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
  if (isJsPath(filePath)) return ScriptKind.JS
  return ScriptKind.TS
}

function isJsPath(filePath: string): boolean {
  return /\.(js|mjs|cjs|jsx)$/.test(filePath)
}

export function transformSourceFile(file: SourceFile, rawOptions: TransformOptions = {}): TransformResult {
  const original = file.getFullText()
  const options = resolveOptions(rawOptions)
  const tsRestImports = file.getImportDeclarations().filter((d) => TS_REST_MODULES.has(d.getModuleSpecifierValue()))
  const factoryNames = findFactoryNames(tsRestImports)
  const contractIdents = findContractIdents(file, factoryNames)

  if (contractIdents.size === 0 && tsRestImports.length === 0 && factoryNames.size === 0) {
    return { code: original, changed: false, diagnostics: [] }
  }

  const ctx: TransformContext = {
    file,
    options,
    schema: detectSchemaLib(file, options.schema),
    contractIdents,
    factoryNames,
    isJs: isJsPath(file.getFilePath()),
    quote: detectQuote(file),
    indentUnit: detectIndentUnit(file),
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

  let code = file.getFullText()
  if (original.includes('\r\n')) code = code.replace(/\r?\n/g, '\r\n')
  return { code, changed: code !== original, diagnostics: sortDiagnostics(ctx.diagnostics) }
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => a.line - b.line)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Local names under which `initContract` / `initTsRest` are imported. */
function findFactoryNames(tsRestImports: ImportDeclaration[]): Set<string> {
  const names = new Set<string>()
  for (const decl of tsRestImports) {
    for (const spec of decl.getNamedImports()) {
      if (CONTRACT_FACTORIES.has(spec.getName())) names.add((spec.getAliasNode() ?? spec.getNameNode()).getText())
    }
  }
  return names
}

function factoryCallee(node: Node, factoryNames: Set<string>): string | undefined {
  if (!Node.isCallExpression(node)) return undefined
  const callee = node.getExpression()
  if (Node.isIdentifier(callee)) return factoryNames.has(callee.getText()) ? callee.getText() : undefined
  if (Node.isPropertyAccessExpression(callee) && CONTRACT_FACTORIES.has(callee.getName())) return callee.getName()
  return undefined
}

function findContractIdents(file: SourceFile, factoryNames: Set<string>): Set<string> {
  const idents = new Set<string>()
  for (const decl of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer()
    if (!init || factoryCallee(init, factoryNames) === undefined) continue
    if (Node.isIdentifier(decl.getNameNode())) idents.add(decl.getName())
  }

  // The contract instance may be imported from another file: accept `x.router(...)`
  // when `x` is an imported identifier and the call looks like a ts-rest router.
  const imported = new Set<string>()
  for (const decl of file.getImportDeclarations()) {
    if (TS_REST_MODULES.has(decl.getModuleSpecifierValue())) continue
    for (const spec of decl.getNamedImports()) imported.add((spec.getAliasNode() ?? spec.getNameNode()).getText())
    const def = decl.getDefaultImport()
    if (def) imported.add(def.getText())
  }
  file.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return
    const callee = node.getExpression()
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'router') return
    const target = callee.getExpression()
    if (!Node.isIdentifier(target) || !imported.has(target.getText()) || idents.has(target.getText())) return
    const [routes, options] = node.getArguments().map((a) => (Node.isExpression(a) ? unwrapExpression(a) : a))
    const probe = { contractIdents: new Set([target.getText()]), factoryNames: new Set<string>() } as TransformContext
    const routesObj = routes !== undefined && Node.isObjectLiteralExpression(routes) ? routes : undefined
    const routesLookRight = routesObj !== undefined
      && (isRouterLiteral(probe, routesObj as Node) || routesObj.getProperties().every((p: Node) => Node.isShorthandPropertyAssignment(p) || Node.isSpreadAssignment(p)))
    const optionsLookRight = options !== undefined && Node.isObjectLiteralExpression(options) && options.getProperties().every((p) => Node.isPropertyNamed(p) && ROUTER_OPTION_KEYS.has(p.getName()))
    if (routesLookRight || optionsLookRight) idents.add(target.getText())
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

/** An object literal in these positions would parse as a block, so it needs parentheses. */
function needsParens(call: CallExpression, rendered: string): boolean {
  if (!rendered.startsWith('{')) return false
  const parent = call.getParent()
  return (Node.isArrowFunction(parent) && parent.getBody() === call) || Node.isExpressionStatement(parent)
}

function collectEdits(ctx: TransformContext): Edit[] {
  const edits: Edit[] = []
  const { file } = ctx

  // 1. Router calls (outermost only; nested ones are rendered recursively).
  file.forEachDescendant((node) => {
    if (!isRouterCall(ctx, node) || insideRouterCall(ctx, node)) return
    const call = node as CallExpression
    let text = renderRouterCall(ctx, call, EMPTY_INHERITED, indentOf(call))
    if (needsParens(call, text)) text = `(${text})`
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
      report(ctx, 'error', 'router-not-converted', 'This `.router()` call could not be converted (its routes are not an object literal or identifier in a supported position).', line)
    } else if (member === 'query' || member === 'mutation') {
      if (!Node.isVariableDeclaration(call.getParent())) {
        report(ctx, 'warn', 'route-not-converted', `\`c.${member}()\` used outside a router or variable declaration was left unchanged.`, line)
      }
    } else {
      report(ctx, 'warn', 'helper-not-converted', `\`c.${member}()\` used outside a route was left unchanged; oRPC has no direct equivalent.`, line)
    }
  })

  // 4. Factory calls that were neither bound to an identifier nor chained into a router.
  file.forEachDescendant((node) => {
    if (!isFactoryCall(ctx, node) || alreadyConverted(node)) return
    const parent = node.getParent()
    if (Node.isVariableDeclaration(parent) && Node.isIdentifier(parent.getNameNode())) return
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === node) return
    report(ctx, 'warn', 'contract-not-converted', 'This `initContract()` call is used in a way the codemod does not understand (for example destructured), so nothing that depends on it was converted.', node.getStartLineNumber())
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

function hasOtherReferences(node: Node): boolean {
  if (!Node.isReferenceFindable(node)) return false
  return node.findReferencesAsNodes().some((r) => r !== node)
}

function rewriteImports(ctx: TransformContext): void {
  const { file } = ctx

  // Drop `const c = initContract()` once nothing references it (never an exported one).
  const removals: Node[] = []
  for (const decl of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (!ctx.contractIdents.has(decl.getName())) continue
    const init = decl.getInitializer()
    const callee = init ? factoryCallee(init, ctx.factoryNames) : undefined
    if (!init || callee === undefined) continue
    const statement = decl.getVariableStatement()
    if (statement?.isExported()) {
      report(ctx, 'warn', 'contract-instance-exported', `\`${decl.getName()}\` is exported, so \`${callee}()\` was kept; remove it once no other file imports it.`, decl.getStartLineNumber())
      continue
    }
    if (hasOtherReferences(decl.getNameNode())) {
      report(ctx, 'warn', 'contract-instance-still-used', `\`${decl.getName()}\` is still referenced after conversion, so \`${callee}()\` was kept.`, decl.getStartLineNumber())
      continue
    }
    if (statement && statement.getDeclarations().length === 1) removals.push(statement)
    else decl.remove()
  }
  removeStatementsKeepingBlankLines(file, removals)

  // Imported contract instances (`import { c } from './c'`) that are no longer used.
  for (const decl of file.getImportDeclarations()) {
    if (TS_REST_MODULES.has(decl.getModuleSpecifierValue())) continue
    for (const spec of decl.getNamedImports()) {
      const local = spec.getAliasNode() ?? spec.getNameNode()
      if (ctx.contractIdents.has(local.getText()) && !hasOtherReferences(local)) spec.remove()
    }
    const def = decl.getDefaultImport()
    if (def && ctx.contractIdents.has(def.getText()) && !hasOtherReferences(def)) decl.removeDefaultImport()
    if (decl.getNamedImports().length === 0 && !decl.getDefaultImport() && !decl.getNamespaceImport() && !decl.getText().includes('{}')) {
      // Only remove declarations we emptied ourselves (a side-effect import has no `{}` either, but it never had specifiers).
      if (decl.getImportClause() === undefined) continue
      decl.remove()
    }
  }

  // `@ts-rest/core` imports: strip what was converted, rename what has a direct equivalent.
  let replaced: ImportDeclaration | undefined
  // New imports go after the leading block of imports, not after a stray import further down.
  let lastImportIndex = -1
  for (const statement of file.getStatements()) {
    if (!Node.isImportDeclaration(statement)) break
    lastImportIndex = statement.getChildIndex()
  }
  for (const decl of file.getImportDeclarations()) {
    if (!TS_REST_MODULES.has(decl.getModuleSpecifierValue())) continue
    const remaining: string[] = []
    for (const spec of decl.getNamedImports()) {
      const name = spec.getName()
      const local = spec.getAliasNode() ?? spec.getNameNode()
      if (CONTRACT_FACTORIES.has(name)) {
        if (hasOtherReferences(local)) remaining.push(name)
        else spec.remove()
        continue
      }
      const renamed = TYPE_RENAMES[name]
      if (renamed && !spec.getAliasNode() && Node.isIdentifier(local)) {
        if (hasOtherReferences(local)) {
          local.rename(renamed)
          ctx.contractTypeImports.add(renamed)
        }
        spec.remove()
        continue
      }
      remaining.push(name)
    }
    if (remaining.length > 0) {
      report(ctx, 'warn', 'ts-rest-import-remaining', `Still importing ${remaining.map((n) => `\`${n}\``).join(', ')} from @ts-rest/core; migrate these by hand.`, decl.getStartLineNumber())
    } else if (!decl.getDefaultImport() && !decl.getNamespaceImport()) {
      // Reuse the declaration (and its leading comments) for the first new import.
      if (!replaced && ctx.contractImports.size > 0) {
        decl.setModuleSpecifier('@orpc/contract')
        decl.addNamedImports([...ctx.contractImports].sort())
        decl.setIsTypeOnly(false)
        replaced = decl
        ctx.contractImports.clear()
      } else {
        decl.remove()
      }
    }
  }

  let insertIndex = replaced ? replaced.getChildIndex() + 1 : lastImportIndex + 1
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
    // Keep comments that sit in the removed statement's leading trivia.
    const leading = text.slice(start, bodyStart)
    const comments = leading.replace(/^\s+/, '').replace(/\s+$/, '')
    const before = text.slice(0, start).replace(/[ \t]*\r?\n?$/, '')
    const after = text.slice(stop).replace(/^[ \t]*\r?\n/, '')
    const separator = before.length === 0 ? '' : hadBlankBefore || hadBlankAfter ? '\n\n' : '\n'
    text = before + separator + (comments ? `${comments}\n` : '') + after
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
  const existing = file.getImportDeclaration((d) => d.getModuleSpecifierValue() === moduleSpecifier && d.isTypeOnly() === typeOnly && !d.getNamespaceImport())
  if (existing) {
    const present = new Set(existing.getNamedImports().map((s) => s.getName()))
    existing.addNamedImports(names.filter((n) => !present.has(n)))
    return false
  }
  const safeIndex = Math.max(0, Math.min(index, file.getStatements().length))
  const decl = file.insertImportDeclaration(safeIndex, { moduleSpecifier, namedImports: names, isTypeOnly: typeOnly })
  if (!usesSemicolons(file)) decl.replaceWithText(decl.getText().replace(/;$/, ''))
  return true
}
