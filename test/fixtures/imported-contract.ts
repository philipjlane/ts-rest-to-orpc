import type { ClientInferResponseBody } from '@ts-rest/core'
import { c } from './contract-instance'
import { z } from 'zod'

export const health = c.router({
  check: {
    method: 'GET',
    path: '/health',
    responses: { 200: z.object({ ok: z.boolean() }) },
  },
})

export type HealthBody = ClientInferResponseBody<typeof health.check, 200>
