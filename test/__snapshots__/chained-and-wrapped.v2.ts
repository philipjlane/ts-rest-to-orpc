// Diagnostics:
// warn L26 [prefix-params] The router pathPrefix declares `orgId`; add them to this route's params schema, oRPC requires every path param in the input.
// warn L32 [path-optional-param] oRPC has no optional path params; `:q?` became required. Split the route or move the value to the query.
// info L44 [prefix-cast] pathPrefix is not a literal, so it was cast to oRPC's `/${string}` path type.

/**
 * Licence header that must survive.
 */
import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

const Org = z.object({ id: z.string(), name: z.string() })

export const chained = oc
  .meta(openapi({ prefix: '/api' }))
  .router({
    get: oc
      .meta(openapi({ method: 'GET', path: '/orgs/{orgId}' }))
      .input(z.object({
        orgId: z.string(),
      }))
      .output(Org),
    list: oc
      .meta(openapi({ method: 'GET', path: '/orgs' }))
      .input(z.object({ cursor: z.string().optional() }).strict())
      .output(z.array(Org)),
  })

export const members = oc
  .meta(openapi({ prefix: '/orgs/{orgId}' }))
  .router({
    // TODO(ts-rest-to-orpc): The router pathPrefix declares `orgId`; add them to this route's params schema, oRPC requires every path param in the input.
    get: oc
      .meta(openapi({ method: 'GET', path: '/members/{memberId}' }))
      .input(z.object({ memberId: z.string() }))
      .output(Org),
    // TODO(ts-rest-to-orpc): oRPC has no optional path params; `:q?` became required. Split the route or move the value to the query.
    search: oc
      .meta(openapi({ method: 'GET', path: '/members/{q}' }))
      .input(z.object({
        orgId: z.string(),
        q: z.string(),
      }))
      .output(z.array(Org)),
  })

const base = process.env['API_BASE']

export const factory = (prefix?: string) =>
  oc
    .meta(openapi({ prefix: (prefix ?? base ?? '/x') as `/${string}` }))
    .router({
      ping: oc
        .meta(openapi({ method: 'GET', path: '/ping' }))
        .output(z.literal('pong')),
    })
