// Diagnostics:
// warn L1 [ts-rest-import-remaining] Still importing `ClientInferResponseBody` from @ts-rest/core; migrate these by hand.

import type { ClientInferResponseBody } from '@ts-rest/core'
import { z } from 'zod'
import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

export const health = {
  check: oc
    .meta(openapi({ method: 'GET', path: '/health' }))
    .output(z.object({ ok: z.boolean() })),
}

export type HealthBody = ClientInferResponseBody<typeof health.check, 200>

import { usersContract } from './users'
export const api = oc
  .meta(openapi({ prefix: '/api' }))
  .router({
    users: usersContract,
    health,
  })
