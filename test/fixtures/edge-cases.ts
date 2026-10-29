import { initContract } from '@ts-rest/core'
import { z } from 'zod'

const c = initContract()

const BASE = '/v1'
const commonResponses = c.responses({ 500: z.object({ message: z.string() }) })
const shared = { summary: 'shared' }

export const contract = c.router({
  teapot: {
    method: 'GET',
    path: '/brew',
    responses: { 200: z.string(), 418: z.object({ reason: z.string() }) },
  },
  download: {
    method: 'GET',
    path: '/files/:id',
    responses: {
      200: c.otherResponse({ contentType: 'application/pdf', body: c.type<Blob>() }),
    },
  },
  templatePath: {
    method: 'GET',
    path: `${BASE}/things/:id`,
    responses: { 200: z.string() },
  },
  dynamicPath: {
    method: 'GET',
    path: BASE,
    responses: { 200: z.string() },
  },
  spreadRoute: {
    ...shared,
    method: 'GET',
    path: '/spread',
    responses: { 200: z.string() },
  },
  refResponses: {
    method: 'GET',
    path: '/ref',
    responses: commonResponses,
  },
  queryOnPost: {
    method: 'POST',
    path: '/search',
    query: z.object({ q: z.string() }),
    body: z.object({ filters: z.array(z.string()) }),
    responses: { 200: z.array(z.string()) },
    somethingNew: true,
  },
  nullBody: {
    method: 'POST',
    path: '/null',
    body: c.type<null>(),
    responses: { 200: null },
  },
})
