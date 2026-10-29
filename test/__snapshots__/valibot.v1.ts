// Diagnostics:
// info L16 [multiple-success] Multiple success statuses were converted to a detailed output union.

import { oc } from '@orpc/contract'
import * as v from 'valibot'

export const contract = {
  getItem: oc
    .errors({ NOT_FOUND: { status: 404, data: v.object({ message: v.string() }) } })
    .route({ method: 'GET', path: '/items/{id}', inputStructure: 'detailed' })
    .input(v.object({
      params: v.object({
        id: v.string(),
      }),
      query: v.object({ expand: v.optional(v.string()) }),
    }))
    .output(v.object({ id: v.string() })),
  createItem: oc
    .route({ method: 'POST', path: '/items', outputStructure: 'detailed' })
    .input(v.object({ name: v.string() }))
    .output(v.union([
      v.object({
        status: v.literal(200),
        body: v.object({ id: v.string(), existing: v.literal(true) }),
      }),
      v.object({
        status: v.literal(201),
        body: v.object({ id: v.string() }),
      }),
    ])),
}
