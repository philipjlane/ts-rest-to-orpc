/**
 * Licence header that must survive.
 */
import { initContract as init, type AppRoute } from '@ts-rest/core'
import { z } from 'zod'

const c = init()

const Org = z.object({ id: z.string(), name: z.string() })

export const chained = init().router(
  {
    get: { method: 'GET', path: '/orgs/:orgId', responses: { 200: Org } } as const,
    list: {
      method: 'GET',
      path: '/orgs',
      query: z.object({ cursor: z.string().optional() }).strict(),
      responses: { 200: z.array(Org) },
    } satisfies AppRoute,
  } as const,
  { pathPrefix: '/api' },
)

export const members = c.router(
  {
    get: {
      method: 'GET',
      path: '/members/:memberId',
      pathParams: z.object({ memberId: z.string() }),
      responses: { 200: Org },
    },
    search: {
      method: 'GET',
      path: '/members/:q?',
      responses: { 200: z.array(Org) },
    },
  },
  { pathPrefix: '/orgs/:orgId' },
)

const base = process.env['API_BASE']

export const factory = (prefix?: string) =>
  c.router({ ping: { method: 'GET', path: '/ping', responses: { 200: z.literal('pong') } } }, { pathPrefix: prefix ?? base ?? '/x' })
