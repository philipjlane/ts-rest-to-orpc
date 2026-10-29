import { Node, type CallExpression, type Expression, type ObjectLiteralExpression } from 'ts-morph'
import { q, report, type TransformContext } from './context.js'
import { errorCodeForStatus } from './errors.js'
import { convertPath } from './path.js'
import {
  contractCallMember,
  isRouteLiteral,
  isRouterCall,
  isRouterLiteral,
  literalString,
  propertyMap,
  propertyName,
  statusKey,
  unwrapExpression,
  unwrapRoute,
} from './ts-rest.js'

/** A ts-rest response or request-part value, classified. */
interface SchemaValue {
  kind: 'schema' | 'plain' | 'noBody'
  /** Source text of the schema expression (kind = schema). */
  text?: string
  /** Type arguments of `c.type<T>()` (kind = plain). */
  typeArgs?: string
  contentType?: string
  /** True when the codemod generated this text (so it may be re-indented). */
  generated?: boolean
  /** Type-literal form of a synthesised schema, e.g. `{ id: string }`. */
  typeText?: string
}

/** Can this value be expressed purely as a TypeScript type (no runtime schema)? */
function isTypeOnly(value: SchemaValue): boolean {
  return value.kind === 'plain' || value.kind === 'noBody' || value.typeText !== undefined
}

function typeOf(value: SchemaValue): string {
  if (value.kind === 'plain') return value.typeArgs ?? 'unknown'
  if (value.typeText !== undefined) return value.typeText
  return 'unknown'
}

function typeLiteral(entries: Array<[string, string]>): string {
  if (entries.length === 0) return '{}'
  return `{ ${entries.map(([k, v]) => `${k}: ${v}`).join('; ')} }`
}

/** Options inherited from enclosing `c.router(routes, options)` calls. */
export interface InheritedOptions {
  baseHeaders?: string
  commonSuccess: Map<number, SchemaValue>
  /** Router-level `metadata` expression text (v1 only). */
  metadata?: string
  /** Path params declared in enclosing `pathPrefix` values, which oRPC requires in the input. */
  prefixParams: string[]
}

export const EMPTY_INHERITED: InheritedOptions = { commonSuccess: new Map(), prefixParams: [] }

const TODO = '// TODO(ts-rest-to-orpc):'

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function indentOf(node: Node): string {
  const text = node.getSourceFile().getFullText()
  const lineStart = text.lastIndexOf('\n', node.getStart() - 1) + 1
  const match = /^[ \t]*/.exec(text.slice(lineStart, node.getStart()))
  return match?.[0] ?? ''
}

/** Source text of an expression with any `c.type<T>()`-style calls rewritten to oRPC's `type<T>()`. */
function exprText(ctx: TransformContext, node: Node): string {
  const start = node.getStart()
  let text = node.getText()
  const replacements: Array<{ start: number; end: number; text: string }> = []
  node.forEachDescendant((desc) => {
    const member = contractCallMember(ctx, desc)
    if (member === 'type' || member === 'body' || member === 'response') {
      replacements.push({ start: desc.getStart() - start, end: desc.getEnd() - start, text: plainTypeText(ctx, desc as CallExpression) })
    }
  })
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, r.start) + r.text + text.slice(r.end)
  }
  return text
}

function plainTypeText(ctx: TransformContext, call: CallExpression): string {
  const typeArgs = call.getTypeArguments().map((t) => t.getText())
  return typeCall(ctx, typeArgs.join(', ') || 'unknown', call)
}

/**
 * Render oRPC's `type<T>()`. Inside a generic function or class TypeScript
 * cannot prove `T` equals itself for the zero-argument overload, so an
 * identity mapper is passed instead.
 */
export function typeCall(ctx: TransformContext, typeArgs: string, scope: Node | undefined): string {
  ctx.contractImports.add('type')
  if (ctx.isJs) return 'type()'
  return inGenericScope(scope) ? `type<${typeArgs}>((v) => v)` : `type<${typeArgs}>()`
}

function inGenericScope(node: Node | undefined): boolean {
  return node?.getAncestors().some((a) => Node.isTypeParametered(a) && a.getTypeParameters().length > 0) ?? false
}

/** One indentation level deeper, matching the file's tab or space style. */
function step(ctx: TransformContext, indent: string): string {
  return indent + ctx.indentUnit
}

function reindent(text: string, indent: string): string {
  // Only re-indent continuation lines; the first line sits after the property name.
  return text.replace(/\n/g, `\n${indent}`)
}

function renderConfig(entries: Array<[string, string]>, indent: string): string {
  const inline = `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`
  if (inline.length + indent.length <= 90 && !inline.includes('\n')) return inline
  return `{\n${entries.map(([k, v]) => `${indent}  ${k}: ${v},`).join('\n')}\n${indent}}`
}

// ---------------------------------------------------------------------------
// Value classification
// ---------------------------------------------------------------------------

function classify(ctx: TransformContext, node: Expression): SchemaValue {
  const member = contractCallMember(ctx, node)
  const call = node as CallExpression
  if (member === 'noBody') return { kind: 'noBody' }
  if (member === 'type' || member === 'body' || member === 'response') {
    return { kind: 'plain', typeArgs: call.getTypeArguments().map((t) => t.getText()).join(', ') || 'unknown' }
  }
  if (member === 'otherResponse') {
    const arg = call.getArguments()[0]
    const props = arg && Node.isObjectLiteralExpression(arg) ? propertyMap(arg) : null
    const body = props?.get('body')
    const contentType = props?.get('contentType')
    const value: SchemaValue = body ? classify(ctx, body) : { kind: 'plain', typeArgs: 'unknown' }
    return { ...value, contentType: contentType ? contentType.getText() : 'unknown' }
  }
  if (Node.isNullLiteral(node)) return { kind: 'plain', typeArgs: 'null' }
  return { kind: 'schema', text: exprText(ctx, node) }
}

/** Render a value as a standalone schema (for `.input()`/`.output()`/`data`). */
function standalone(ctx: TransformContext, value: SchemaValue, scope: Node): string | undefined {
  if (value.kind === 'noBody') return undefined
  if (value.kind === 'plain') return typeCall(ctx, value.typeArgs ?? 'unknown', scope)
  return value.text
}

/** Render a value as a member of a `z.object({...})` wrapper. */
function nested(ctx: TransformContext, value: SchemaValue, notes: string[], line: number): string | undefined {
  if (value.kind === 'noBody') return undefined
  if (value.kind === 'plain') {
    const message = `\`c.type<${value.typeArgs}>()\` was wrapped with \`${ctx.schema.ident}.custom\` so it can sit inside an object schema; it is typed but not validated at runtime.`
    notes.push(message)
    report(ctx, 'warn', 'plain-type-wrapped', message, line)
    return ctx.schema.custom(value.typeArgs ?? 'unknown')
  }
  if (value.typeText !== undefined && ctx.schema.kind === 'unknown') schemaLibWarning(ctx)
  return value.generated && value.text ? reindent(value.text, '  ') : value.text
}

/** Warn once per file when generated wrappers assume zod. */
function schemaLibWarning(ctx: TransformContext): void {
  if (ctx.schemaLibWarned) return
  ctx.schemaLibWarned = true
  report(ctx, 'warn', 'schema-lib-unknown', `No schema library import was found, so generated wrappers assume zod and \`import { ${ctx.schema.ident} } from 'zod'\` was added. Pass --schema valibot if that is wrong.`, 1)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface RenderedRoute {
  text: string
  notes: string[]
}

const KNOWN_ROUTE_KEYS = new Set([
  'method', 'path', 'pathParams', 'query', 'headers', 'body', 'responses', 'summary', 'description',
  'deprecated', 'metadata', 'contentType', 'strictStatusCodes', 'validateResponseOnClient',
])

export function renderRoute(
  ctx: TransformContext,
  route: ObjectLiteralExpression,
  inherited: InheritedOptions,
  indent: string,
): RenderedRoute {
  const line = route.getStartLineNumber()
  const notes: string[] = []
  const note = (level: 'info' | 'warn' | 'error', code: string, message: string): void => {
    report(ctx, level, code, message, line)
    if (level !== 'info') notes.push(message)
  }
  const props = propertyMap(route)
  if (!props) {
    note('error', 'route-spread', 'Route object contains a spread or method; it was left unchanged.')
    return { text: route.getText(), notes }
  }
  const inner = step(ctx, indent)
  const chain: string[] = []
  const config: Array<[string, string]> = []

  // --- method & path -------------------------------------------------------
  const methodNode = props.get('method')!
  const methodLiteral = literalString(methodNode)
  const method = methodLiteral ? methodLiteral.toUpperCase() : undefined
  config.push(['method', methodLiteral ? q(ctx, method!) : methodNode.getText()])

  const pathNode = props.get('path')!
  const pathLiteral = literalString(pathNode)
  let pathParams: string[] = [...inherited.prefixParams]
  const pathTemplate = unwrapExpression(pathNode)
  if (pathLiteral !== undefined) {
    const converted = convertPath(pathLiteral)
    pathParams.push(...converted.params)
    config.push(['path', q(ctx, converted.path)])
    if (converted.optionalParams.length > 0) {
      note('warn', 'path-optional-param', `oRPC has no optional path params; ${converted.optionalParams.map((p) => `\`:${p}?\``).join(', ')} became required. Split the route or move the value to the query.`)
    }
  } else if (Node.isTemplateExpression(pathTemplate)) {
    const converted = convertPath(pathTemplate.getText())
    pathParams.push(...converted.params)
    config.push(['path', converted.path])
    note('warn', 'path-template', 'Path is a template literal; `:param` segments were rewritten to `{param}` textually. Check the result.')
  } else {
    config.push(['path', pathNode.getText()])
    note('warn', 'path-not-literal', 'Path is not a string literal, so `:param` segments could not be rewritten to `{param}`.')
  }

  // --- request parts -------------------------------------------------------
  const parts: Partial<Record<'params' | 'query' | 'headers' | 'body', SchemaValue>> = {}
  const paramsNode = props.get('pathParams')
  if (paramsNode) {
    parts.params = classify(ctx, paramsNode)
    if (inherited.prefixParams.length > 0) {
      note('warn', 'prefix-params', `The router pathPrefix declares ${inherited.prefixParams.map((p) => `\`${p}\``).join(', ')}; add them to this route's params schema, oRPC requires every path param in the input.`)
    }
  } else if (pathParams.length > 0) {
    parts.params = {
      kind: 'schema',
      generated: true,
      text: ctx.schema.object(pathParams.map((p) => [p, ctx.schema.string()]), inner),
      typeText: typeLiteral(pathParams.map((p) => [p, 'string'])),
    }
  }
  const queryNode = props.get('query')
  if (queryNode) parts.query = classify(ctx, queryNode)
  const bodyNode = props.get('body')
  if (bodyNode) {
    const body = classify(ctx, bodyNode)
    if (body.kind !== 'noBody') parts.body = body
  }
  const headersNode = props.get('headers')
  let headers: SchemaValue | undefined
  if (headersNode) {
    if (Node.isObjectLiteralExpression(headersNode)) {
      // Legacy ts-rest form: a plain object of schemas.
      const entries = headersNode.getProperties().flatMap((p): Array<[string, string]> => {
        if (!Node.isPropertyAssignment(p)) return []
        const name = propertyName(p.getNameNode())
        const init = p.getInitializer()
        if (name === undefined || !init) return []
        const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : q(ctx, name)
        return [[key, exprText(ctx, init)]]
      })
      headers = { kind: 'schema', generated: true, text: ctx.schema.object(entries, inner) }
    } else {
      headers = classify(ctx, headersNode)
    }
  }
  if (inherited.baseHeaders) {
    if (headers && headers.kind === 'plain') {
      note('warn', 'headers-not-merged', `Route headers \`c.type<${headers.typeArgs}>()\` could not be merged with the router baseHeaders; only baseHeaders were kept.`)
    }
    headers = headers?.text
      ? { kind: 'schema', generated: true, text: ctx.schema.merge(inherited.baseHeaders, headers.text) }
      : { kind: 'schema', generated: true, text: inherited.baseHeaders }
  }
  if (headers) parts.headers = headers

  // --- input structure -----------------------------------------------------
  const isGet = method === 'GET' || method === 'HEAD'
  const mergeable = (['params', isGet ? 'query' : 'body'] as const).filter((k) => parts[k])
  const unmergeable = Object.keys(parts).filter((k) => !mergeable.includes(k as never)) as Array<keyof typeof parts>
  let mode = ctx.options.inputStructure
  if (mode === 'compact' && unmergeable.length > 0) {
    note('warn', 'input-forced-detailed', `Input uses \`inputStructure: 'detailed'\` because ${unmergeable.map((k) => `\`${k}\``).join(', ')} cannot be merged into a compact input.`)
    mode = 'detailed'
  }
  if (mode === 'auto') mode = unmergeable.length === 0 && mergeable.length <= 1 ? 'compact' : 'detailed'

  // Prefer oRPC's `type<T>()` when nothing in the route carries a runtime schema
  // (typical for contracts written with `c.type<T>()`), or when a synthesised
  // params schema would otherwise force a zod dependency on a file without one.
  const presentParts = Object.values(parts).filter((v): v is SchemaValue => v !== undefined)
  const allPlainOrSynthesised = presentParts.every((v) => v.kind === 'plain' || (v.typeText !== undefined && ctx.schema.kind === 'unknown'))
  const allTypeOnlyWithPlain = presentParts.every(isTypeOnly) && presentParts.some((v) => v.kind === 'plain')
  const typeOnly = !ctx.isJs && presentParts.length > 0 && (allPlainOrSynthesised || allTypeOnlyWithPlain)
  const tc = (typeArgs: string): string => typeCall(ctx, typeArgs, route)

  let input: string | undefined
  if (mode === 'compact') {
    if (mergeable.length === 1) {
      const value = parts[mergeable[0]!]!
      if (typeOnly) {
        input = tc(typeOf(value))
      } else {
        input = standalone(ctx, value, route)
      }
    } else if (mergeable.length === 2) {
      const [a, b] = [parts.params!, parts[mergeable[1]!]!]
      if (typeOnly) {
        input = tc(`${typeOf(a)} & ${typeOf(b)}`)
      } else {
        const aText = nested(ctx, a, notes, line)
        const bText = nested(ctx, b, notes, line)
        input = aText && bText ? ctx.schema.merge(aText, bText) : (aText ?? bText)
      }
      if (typeOnly) note('info', 'input-merged', 'Path params and query/body types were merged into one compact input.')
      else note('warn', 'input-merged', `Path params and ${mergeable[1]} schemas were merged with \`${ctx.schema.kind === 'valibot' ? '.entries' : '.extend(...shape)'}\`; both must be plain object schemas.`)
    }
  } else {
    const entries: Array<[string, string]> = []
    for (const key of ['params', 'query', 'headers', 'body'] as const) {
      const value = parts[key]
      if (!value) continue
      if (typeOnly) {
        entries.push([key, typeOf(value)])
        continue
      }
      const text = nested(ctx, value, notes, line)
      if (text) entries.push([key, text])
    }
    if (entries.length > 0) {
      if (typeOnly) {
        input = tc(typeLiteral(entries))
      } else {
        input = ctx.schema.object(entries, inner)
        if (ctx.schema.kind === 'unknown') schemaLibWarning(ctx)
      }
      config.push(['inputStructure', q(ctx, 'detailed')])
    }
  }

  // --- responses -----------------------------------------------------------
  const success = new Map<number, SchemaValue>(inherited.commonSuccess)
  const errors: Array<[number, SchemaValue]> = []
  const responsesNode = props.get('responses')
  let responses: ObjectLiteralExpression | undefined
  if (responsesNode) {
    const unwrapped = unwrapExpression(responsesNode)
    if (Node.isObjectLiteralExpression(unwrapped)) {
      responses = unwrapped
    } else if (contractCallMember(ctx, unwrapped) === 'responses') {
      const arg = (unwrapped as CallExpression).getArguments()[0]
      if (arg && Node.isObjectLiteralExpression(arg)) responses = arg
    }
  }
  if (responsesNode && !responses) {
    note('error', 'responses-not-literal', 'Responses are not an inline object literal, so they could not be split into `.output()` and `.errors()`.')
  }
  if (responses) {
    for (const prop of responses.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) {
        note('error', 'responses-spread', 'Responses contain a spread or shorthand entry that could not be converted.')
        continue
      }
      const status = statusKey(prop.getNameNode())
      const init = prop.getInitializer()
      if (status === undefined || !init) {
        note('error', 'response-status-not-literal', `Response key \`${prop.getNameNode().getText()}\` is not a numeric status code and was skipped.`)
        continue
      }
      let value = classify(ctx, init)
      if (status === 204 && (value.kind === 'plain') && (value.typeArgs === 'null' || value.typeArgs === 'undefined' || value.typeArgs === 'void')) value = { kind: 'noBody' }
      if (value.contentType) {
        note('warn', 'other-response', `Response ${status} used \`c.otherResponse\` with contentType ${value.contentType}; oRPC derives the content type from the schema, so set it via the OpenAPI spec if it matters.`)
      }
      if (status < 400) success.set(status, value)
      else errors.push([status, value])
    }
  }

  const successEntries = [...success.entries()].sort((a, b) => a[0] - b[0])
  let output: string | undefined
  if (successEntries.length === 1) {
    const [status, value] = successEntries[0]!
    output = standalone(ctx, value, route)
    if (!output) output = tc('void')
    if (status !== 200) config.push(['successStatus', String(status)])
  } else if (successEntries.length > 1) {
    if (successEntries.every(([, value]) => isTypeOnly(value))) {
      const members = successEntries.map(([status, value]) => {
        const entries: Array<[string, string]> = [['status', String(status)]]
        if (value.kind !== 'noBody') entries.push(['body', typeOf(value)])
        return typeLiteral(entries)
      })
      output = tc(members.join(' | '))
    } else {
      const members = successEntries.map(([status, value]) => {
        const entries: Array<[string, string]> = [['status', ctx.schema.literal(String(status))]]
        const body = nested(ctx, value, notes, line)
        if (body) entries.push(['body', body])
        return ctx.schema.object(entries, step(ctx, inner))
      })
      output = ctx.schema.union(members, inner)
      if (ctx.schema.kind === 'unknown') schemaLibWarning(ctx)
    }
    config.push(['outputStructure', q(ctx, 'detailed')])
    note('info', 'multiple-success', 'Multiple success statuses were converted to a detailed output union.')
  }

  // --- simple metadata -----------------------------------------------------
  for (const key of ['summary', 'description', 'deprecated'] as const) {
    const node = props.get(key)
    if (node) config.push([key, exprText(ctx, node)])
  }

  const contentType = props.get('contentType')
  if (contentType) {
    const value = literalString(contentType) ?? contentType.getText()
    if (value === 'multipart/form-data') {
      note('info', 'content-type', 'Dropped `contentType: multipart/form-data`; oRPC sends multipart automatically when the body schema contains a File or Blob.')
    } else if (value !== 'application/json') {
      note('warn', 'content-type', `Dropped \`contentType: ${value}\`; oRPC has no per-route request content type. Check the oRPC docs for body hints.`)
    }
  }
  if (props.has('strictStatusCodes')) report(ctx, 'info', 'strict-status-codes', 'Dropped `strictStatusCodes`; oRPC always types responses by status.', line)
  if (props.has('validateResponseOnClient')) report(ctx, 'info', 'validate-response-on-client', 'Dropped `validateResponseOnClient`; oRPC clients validate output by schema.', line)
  for (const key of props.keys()) {
    if (!KNOWN_ROUTE_KEYS.has(key)) note('warn', 'unknown-route-key', `Unknown route property \`${key}\` was dropped.`)
  }

  // --- assemble chain ------------------------------------------------------
  if (errors.length > 0) {
    const entries = errors.map(([status, value]): [string, string] => {
      const { code, standard } = errorCodeForStatus(status)
      const fields: Array<[string, string]> = []
      if (ctx.options.target === 'v1') fields.push(['status', String(status)])
      else if (!standard) {
        note('warn', 'error-status-custom', `Status ${status} has no built-in oRPC error code; \`${code}\` was generated. Map it with \`errorStatusMap\` on your OpenAPI handler.`)
      }
      const data = standalone(ctx, value, route)
      if (data) fields.push(['data', data])
      return [code, fields.length > 0 ? renderConfig(fields, step(ctx, inner)) : '{}']
    })
    chain.push(`.errors(${renderConfig(entries, inner)})`)
  }

  const metadata = props.get('metadata')
  if (ctx.options.target === 'v1') {
    const own = metadata ? exprText(ctx, metadata) : undefined
    if (own && inherited.metadata) chain.push(`.meta({ ...${inherited.metadata}, ...${own} })`)
    else if (own) chain.push(`.meta(${own})`)
    else if (inherited.metadata) chain.push(`.meta(${inherited.metadata})`)
  } else if (metadata) {
    note('warn', 'metadata-v2', 'oRPC v2 `.meta()` only accepts plugin-defined metadata (see `defineMeta`), so `metadata` was dropped.')
  }

  const configText = renderConfig(config, inner)
  if (ctx.options.target === 'v1') {
    chain.push(`.route(${configText})`)
  } else {
    ctx.needsOpenapi = true
    chain.push(`.meta(openapi(${configText}))`)
  }
  if (input) chain.push(`.input(${input})`)
  if (output) chain.push(`.output(${output})`)

  ctx.contractImports.add('oc')
  return { text: `oc\n${chain.map((c) => `${inner}${c}`).join('\n')}`, notes }
}

// ---------------------------------------------------------------------------
// Routers
// ---------------------------------------------------------------------------

function todoComments(notes: string[], indent: string): string {
  return notes.map((n) => `${indent}${TODO} ${n}\n`).join('')
}

function leadingComments(node: Node, indent: string): string {
  const ranges = node.getLeadingCommentRanges()
  if (ranges.length === 0) return ''
  return ranges.map((r) => `${reindent(r.getText(), indent)}\n${indent}`).join('')
}

/** Render a plain object literal of routes / nested routers as an oRPC router object. */
export function renderRouterObject(
  ctx: TransformContext,
  obj: ObjectLiteralExpression,
  inherited: InheritedOptions,
  indent: string,
): string {
  const inner = step(ctx, indent)
  const lines: string[] = []
  for (const prop of obj.getProperties()) {
    const comments = leadingComments(prop, inner)
    if (Node.isPropertyAssignment(prop)) {
      const raw = prop.getInitializer()
      const name = prop.getNameNode().getText()
      if (!raw) continue
      const init = unwrapExpression(raw)
      const route = unwrapRoute(ctx, init)
      if (route) {
        const rendered = renderRoute(ctx, route, inherited, inner)
        lines.push(`${ctx.options.comments ? todoComments(rendered.notes, inner) : ''}${inner}${comments}${name}: ${rendered.text},`)
        continue
      }
      if (isRouterCall(ctx, init)) {
        lines.push(`${inner}${comments}${name}: ${renderRouterCall(ctx, init, inherited, inner)},`)
        continue
      }
      if (Node.isObjectLiteralExpression(init) && isRouterLiteral(ctx, init)) {
        lines.push(`${inner}${comments}${name}: ${renderRouterObject(ctx, init, inherited, inner)},`)
        continue
      }
      lines.push(`${inner}${comments}${name}: ${reindent(exprText(ctx, init), inner)},`)
      warnUnappliedOptions(ctx, inherited, prop, name)
      continue
    }
    if (Node.isShorthandPropertyAssignment(prop)) {
      lines.push(`${inner}${comments}${prop.getName()},`)
      warnUnappliedOptions(ctx, inherited, prop, prop.getName())
      continue
    }
    lines.push(`${inner}${comments}${reindent(exprText(ctx, prop), inner)},`)
    warnUnappliedOptions(ctx, inherited, prop, prop.getText())
  }
  if (lines.length === 0) return '{}'
  return `{\n${lines.join('\n')}\n${indent}}`
}

function warnUnappliedOptions(ctx: TransformContext, inherited: InheritedOptions, node: Node, name: string): void {
  const unapplied: string[] = []
  if (inherited.baseHeaders) unapplied.push('baseHeaders')
  if (inherited.commonSuccess.size > 0) unapplied.push('commonResponses (success statuses)')
  if (inherited.metadata) unapplied.push('metadata')
  if (unapplied.length > 0) {
    report(ctx, 'warn', 'options-not-applied', `Router options ${unapplied.join(', ')} could not be applied to \`${name}\` because it is not an inline route.`, node.getStartLineNumber())
  }
}

/** Render `c.router(routes, options?)`. */
export function renderRouterCall(
  ctx: TransformContext,
  call: CallExpression,
  inherited: InheritedOptions,
  indent: string,
): string {
  const line = call.getStartLineNumber()
  const [routesArg, optionsArg] = call.getArguments().map((a) => (Node.isExpression(a) ? unwrapExpression(a) : a))
  const builders: string[] = []
  const next: InheritedOptions = { ...inherited, commonSuccess: new Map(inherited.commonSuccess), prefixParams: [...inherited.prefixParams] }
  const inner = step(ctx, indent)

  if (optionsArg) {
    const options = Node.isObjectLiteralExpression(optionsArg) ? propertyMap(optionsArg) : null
    if (!options) {
      report(ctx, 'error', 'router-options-not-literal', 'Router options are not an inline object literal and were dropped.', line)
    } else {
      const metadata = options.get('metadata')
      if (metadata) {
        if (ctx.options.target === 'v1') {
          const text = exprText(ctx, metadata)
          next.metadata = next.metadata ? `{ ...${next.metadata}, ...${text} }` : text
          report(ctx, 'info', 'metadata-inlined', 'Router-level `metadata` was merged into the `.meta()` of every inline route.', line)
        } else {
          report(ctx, 'warn', 'metadata-v2', 'Router-level `metadata` was dropped; oRPC v2 `.meta()` only accepts plugin-defined metadata.', line)
        }
      }
      const common = options.get('commonResponses')
      if (common) {
        const unwrapped = unwrapExpression(common)
        if (Node.isObjectLiteralExpression(unwrapped)) {
          const errorEntries: Array<[string, string]> = []
          for (const prop of unwrapped.getProperties()) {
            const status = Node.isPropertyAssignment(prop) ? statusKey(prop.getNameNode()) : undefined
            const init = Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
            if (status === undefined || !init) {
              report(ctx, 'error', 'response-status-not-literal', 'A commonResponses entry does not use a numeric status key and was skipped.', line)
              continue
            }
            const value = classify(ctx, init)
            if (status < 400) {
              next.commonSuccess.set(status, value)
              continue
            }
            const { code, standard } = errorCodeForStatus(status)
            const fields: Array<[string, string]> = []
            if (ctx.options.target === 'v1') fields.push(['status', String(status)])
            else if (!standard) report(ctx, 'warn', 'error-status-custom', `Status ${status} has no built-in oRPC error code; \`${code}\` was generated.`, line)
            const data = standalone(ctx, value, call)
            if (data) fields.push(['data', data])
            errorEntries.push([code, fields.length > 0 ? renderConfig(fields, step(ctx, inner)) : '{}'])
          }
          if (errorEntries.length > 0) builders.push(`.errors(${renderConfig(errorEntries, inner)})`)
        } else {
          report(ctx, 'error', 'common-responses-not-literal', 'commonResponses is not an inline object literal and was dropped.', line)
        }
      }
      const prefixRaw = options.get('pathPrefix')
      const prefix = prefixRaw && !(Node.isIdentifier(prefixRaw) && prefixRaw.getText() === 'undefined') ? unwrapExpression(prefixRaw) : undefined
      if (prefix) {
        const literal = literalString(prefix)
        let text: string
        if (literal !== undefined) {
          const converted = convertPath(literal)
          next.prefixParams.push(...converted.params)
          text = q(ctx, converted.path)
        } else if (Node.isTemplateExpression(prefix)) {
          const converted = convertPath(prefix.getText())
          next.prefixParams.push(...converted.params)
          text = converted.path
        } else {
          const expr = exprText(ctx, prefix)
          const simple = Node.isIdentifier(prefix) || Node.isPropertyAccessExpression(prefix) || Node.isCallExpression(prefix)
          text = `${simple ? expr : `(${expr})`} as \`/\${string}\``
          report(ctx, 'info', 'prefix-cast', 'pathPrefix is not a literal, so it was cast to oRPC\'s `/${string}` path type.', line)
        }
        if (ctx.options.target === 'v1') builders.push(`.prefix(${text})`)
        else {
          ctx.needsOpenapi = true
          builders.push(`.meta(openapi({ prefix: ${text} }))`)
        }
      }
      const baseHeaders = options.get('baseHeaders')
      if (baseHeaders) {
        const text = Node.isObjectLiteralExpression(baseHeaders)
          ? ctx.schema.object(
              baseHeaders.getProperties().flatMap((p): Array<[string, string]> => {
                if (!Node.isPropertyAssignment(p)) return []
                const name = propertyName(p.getNameNode())
                const init = p.getInitializer()
                if (name === undefined || !init) return []
                return [[/^[A-Za-z_$][\w$]*$/.test(name) ? name : q(ctx, name), exprText(ctx, init)]]
              }),
              inner,
            )
          : exprText(ctx, baseHeaders)
        next.baseHeaders = next.baseHeaders ? ctx.schema.merge(next.baseHeaders, text) : text
        report(ctx, 'info', 'base-headers-inlined', 'baseHeaders were merged into the headers of every inline route.', line)
      }
      if (options.has('strictStatusCodes')) report(ctx, 'info', 'strict-status-codes', 'Dropped router-level `strictStatusCodes`.', line)
      if (options.has('validateResponseOnClient')) report(ctx, 'info', 'validate-response-on-client', 'Dropped router-level `validateResponseOnClient`.', line)
      for (const key of options.keys()) {
        if (!['metadata', 'commonResponses', 'pathPrefix', 'baseHeaders', 'strictStatusCodes', 'validateResponseOnClient'].includes(key)) {
          report(ctx, 'warn', 'unknown-router-option', `Unknown router option \`${key}\` was dropped.`, line)
        }
      }
    }
  }

  let routes: string
  if (routesArg && Node.isObjectLiteralExpression(routesArg)) {
    routes = renderRouterObject(ctx, routesArg, next, builders.length > 0 ? inner : indent)
  } else if (routesArg) {
    routes = exprText(ctx, routesArg)
    if (next.baseHeaders || next.commonSuccess.size > 0 || next.metadata) {
      report(ctx, 'warn', 'options-not-applied', 'baseHeaders, metadata and success commonResponses could not be applied because the routes argument is not an inline object.', line)
    }
  } else {
    routes = '{}'
  }

  if (builders.length === 0) return routes
  ctx.contractImports.add('oc')
  return `oc${builders.map((b) => `\n${inner}${b}`).join('')}\n${inner}.router(${routes})`
}

export { isRouteLiteral }
