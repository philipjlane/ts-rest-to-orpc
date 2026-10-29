import { Node, SyntaxKind, type CallExpression, type Expression, type ObjectLiteralExpression } from 'ts-morph'
import type { TransformContext } from './context.js'

/** Property map of an object literal, keyed by property name. Returns null if it contains spreads. */
export function propertyMap(obj: ObjectLiteralExpression): Map<string, Expression> | null {
  const map = new Map<string, Expression>()
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = propertyName(prop.getNameNode())
      const init = prop.getInitializer()
      if (name === undefined || !init) return null
      map.set(name, init)
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      map.set(prop.getName(), prop.getNameNode())
    } else {
      // Spread assignments, methods, accessors: not a plain ts-rest route.
      return null
    }
  }
  return map
}

export function propertyName(node: Node): string | undefined {
  if (Node.isIdentifier(node) || Node.isPrivateIdentifier(node)) return node.getText()
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText()
  if (Node.isNumericLiteral(node)) return String(node.getLiteralValue())
  return undefined
}

/** Is this object literal shaped like a ts-rest route (`method` + `path`)? */
export function isRouteLiteral(node: Node): node is ObjectLiteralExpression {
  if (!Node.isObjectLiteralExpression(node)) return false
  const names = new Set(node.getProperties().map((p) => (Node.isPropertyNamed(p) ? p.getName() : '')))
  return names.has('method') && names.has('path')
}

/** Is this a bare `initContract()` / `initTsRest()` call? */
export function isFactoryCall(ctx: TransformContext, node: Node): node is CallExpression {
  if (!Node.isCallExpression(node)) return false
  const callee = node.getExpression()
  if (Node.isIdentifier(callee)) return ctx.factoryNames.has(callee.getText())
  if (Node.isPropertyAccessExpression(callee)) return callee.getName() === 'initContract' || callee.getName() === 'initTsRest'
  return false
}

/** `c.<member>(...)` where `c` is a contract instance (or `initContract().<member>(...)`). Returns the member name. */
export function contractCallMember(ctx: TransformContext, node: Node): string | undefined {
  if (!Node.isCallExpression(node)) return undefined
  const callee = node.getExpression()
  if (!Node.isPropertyAccessExpression(callee)) return undefined
  const target = callee.getExpression()
  if (Node.isIdentifier(target) && ctx.contractIdents.has(target.getText())) return callee.getName()
  if (isFactoryCall(ctx, target)) return callee.getName()
  return undefined
}

/** Unwrap `c.query({...})` / `c.mutation({...})` to the route literal, or return the node if it already is one. */
export function unwrapRoute(ctx: TransformContext, node: Node): ObjectLiteralExpression | undefined {
  const inner = Node.isExpression(node) ? unwrapExpression(node) : node
  if (isRouteLiteral(inner)) return inner
  const member = contractCallMember(ctx, inner)
  if (member === 'query' || member === 'mutation') {
    const arg = (inner as CallExpression).getArguments()[0]
    const unwrapped = arg && Node.isExpression(arg) ? unwrapExpression(arg) : arg
    if (unwrapped && isRouteLiteral(unwrapped)) return unwrapped
  }
  return undefined
}

/** Strip `as const` / `satisfies X` / parentheses wrappers. */
export function unwrapExpression(node: Expression): Expression {
  let current: Expression = node
  for (;;) {
    if (Node.isAsExpression(current) || Node.isSatisfiesExpression(current) || Node.isParenthesizedExpression(current)) {
      current = current.getExpression()
      continue
    }
    if (Node.isTypeAssertion(current)) {
      current = current.getExpression()
      continue
    }
    return current
  }
}

export function isRouterCall(ctx: TransformContext, node: Node): node is CallExpression {
  return contractCallMember(ctx, node) === 'router'
}

/** Is this object literal a ts-rest router (at least one route or nested router inside)? */
export function isRouterLiteral(ctx: TransformContext, node: Node, depth = 0): node is ObjectLiteralExpression {
  if (!Node.isObjectLiteralExpression(node) || depth > 5) return false
  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue
    const raw = prop.getInitializer()
    if (!raw) continue
    const init = unwrapExpression(raw)
    if (unwrapRoute(ctx, init) || isRouterCall(ctx, init)) return true
    if (Node.isObjectLiteralExpression(init) && isRouterLiteral(ctx, init, depth + 1)) return true
  }
  return false
}

export function literalString(node: Node): string | undefined {
  const inner = Node.isExpression(node) ? unwrapExpression(node) : node
  if (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner)) return inner.getLiteralText()
  return undefined
}

export function statusKey(node: Node): number | undefined {
  if (Node.isNumericLiteral(node)) return node.getLiteralValue()
  if (Node.isStringLiteral(node)) {
    const n = Number(node.getLiteralText())
    return Number.isInteger(n) ? n : undefined
  }
  if (node.getKind() === SyntaxKind.Identifier) {
    const n = Number(node.getText())
    return Number.isInteger(n) ? n : undefined
  }
  return undefined
}
