// Diagnostics:
// warn L1 [ts-rest-import-remaining] Still importing `ClientInferResponseBody` from @ts-rest/core; migrate these by hand.

import type { ClientInferResponseBody } from '@ts-rest/core'
import { z } from 'zod'
import { oc } from '@orpc/contract'

export const health = {
  check: oc
    .route({ method: 'GET', path: '/health' })
    .output(z.object({ ok: z.boolean() })),
}

export type HealthBody = ClientInferResponseBody<typeof health.check, 200>

import { usersContract } from './users'
export const api = oc
  .prefix('/api')
  .router({
    users: usersContract,
    health,
  })
