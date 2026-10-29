import { initContract } from '@ts-rest/core'
import * as v from 'valibot'

const c = initContract()

export const contract = c.router({
  getItem: {
    method: 'GET',
    path: '/items/:id',
    query: v.object({ expand: v.optional(v.string()) }),
    responses: {
      200: v.object({ id: v.string() }),
      404: v.object({ message: v.string() }),
    },
  },
  createItem: {
    method: 'POST',
    path: '/items',
    body: v.object({ name: v.string() }),
    responses: { 201: v.object({ id: v.string() }), 200: v.object({ id: v.string(), existing: v.literal(true) }) },
  },
})
