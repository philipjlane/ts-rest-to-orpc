// Diagnostics:
// info L8 [wrapper-stripped] Removed `as const` / `satisfies` wrapper from `getUser`; oRPC builders carry their own types.
// info L29 [wrapper-stripped] Removed `as const` / `satisfies` wrapper from `userRoutes`; oRPC builders carry their own types.

import { oc } from '@orpc/contract'
import type { AnyContractRouter } from '@orpc/contract'
import { z } from 'zod'

const User = z.object({ id: z.number(), name: z.string() })

export const getUser = oc
  .errors({ NOT_FOUND: { status: 404, data: z.object({ message: z.string() }) } })
  .route({ method: 'GET', path: '/users/{id}', inputStructure: 'detailed' })
  .input(z.object({
    params: z.object({
      id: z.string(),
    }),
  }))
  .output(User)

export const listUsers = oc
  .route({ method: 'GET', path: '/users', inputStructure: 'detailed' })
  .input(z.object({
    query: z.object({ q: z.string().optional() }),
  }))
  .output(z.array(User))

export const updateUser = oc
  .route({ method: 'PATCH', path: '/users/{id}', inputStructure: 'detailed' })
  .input(z.object({
    params: z.object({ id: z.coerce.number() }),
    body: User.partial(),
  }))
  .output(User)

export const userRoutes = {
  getUser,
  listUsers,
  updateUser,
  stats: oc
    .route({ method: 'GET', path: '/users/stats' })
    .output(z.object({ count: z.number() })),
}

export const contract = userRoutes

export type Contract = typeof contract
export const isRouter = (x: AnyContractRouter): x is AnyContractRouter => typeof x === 'object'
