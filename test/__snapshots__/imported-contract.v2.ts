// Diagnostics:
// warn L1 [ts-rest-import-remaining] Still importing `ClientInferResponseBody` from @ts-rest/core; migrate these by hand.

import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import type { ClientInferResponseBody } from '@ts-rest/core'
import { c } from './contract-instance'
import { z } from 'zod'

export const health = {
  check: oc
    .meta(openapi({ method: 'GET', path: '/health' }))
    .output(z.object({ ok: z.boolean() })),
}

export type HealthBody = ClientInferResponseBody<typeof health.check, 200>
