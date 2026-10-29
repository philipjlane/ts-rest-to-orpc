// Diagnostics:
// warn L1 [ts-rest-import-remaining] Still importing `initContract` from @ts-rest/core; migrate these by hand.
// warn L4 [contract-instance-still-used] `c` is still referenced after conversion, so `initContract()` was kept.
// warn L7 [helper-not-converted] `c.responses()` used outside a route was left unchanged; oRPC has no direct equivalent.
// warn L16 [other-response] Response 200 used `c.otherResponse` with contentType 'application/pdf'; oRPC derives the content type from the schema, so set it via the OpenAPI spec if it matters.
// warn L23 [path-template] Path is a template literal; `:param` segments were rewritten to `{param}` textually. Check the result.
// warn L28 [path-not-literal] Path is not a string literal, so `:param` segments could not be rewritten to `{param}`.
// error L33 [route-spread] Route object contains a spread or method; it was left unchanged.
// error L39 [responses-not-literal] Responses are not an inline object literal, so they could not be split into `.output()` and `.errors()`.
// warn L44 [unknown-route-key] Unknown route property `somethingNew` was dropped.

import { initContract } from '@ts-rest/core'
import { z } from 'zod'
import { oc, type } from '@orpc/contract'

const c = initContract()

const BASE = '/v1'
const commonResponses = c.responses({ 500: z.object({ message: z.string() }) })
const shared = { summary: 'shared' }

export const contract = {
  teapot: oc
    .errors({ HTTP_418: { status: 418, data: z.object({ reason: z.string() }) } })
    .route({ method: 'GET', path: '/brew' })
    .output(z.string()),
  // TODO(ts-rest-to-orpc): Response 200 used `c.otherResponse` with contentType 'application/pdf'; oRPC derives the content type from the schema, so set it via the OpenAPI spec if it matters.
  download: oc
    .route({ method: 'GET', path: '/files/{id}', inputStructure: 'detailed' })
    .input(z.object({
      params: z.object({
        id: z.string(),
      }),
    }))
    .output(type<Blob>()),
  // TODO(ts-rest-to-orpc): Path is a template literal; `:param` segments were rewritten to `{param}` textually. Check the result.
  templatePath: oc
    .route({ method: 'GET', path: `${BASE}/things/{id}`, inputStructure: 'detailed' })
    .input(z.object({
      params: z.object({
        id: z.string(),
      }),
    }))
    .output(z.string()),
  // TODO(ts-rest-to-orpc): Path is not a string literal, so `:param` segments could not be rewritten to `{param}`.
  dynamicPath: oc
    .route({ method: 'GET', path: BASE })
    .output(z.string()),
  // TODO(ts-rest-to-orpc): Route object contains a spread or method; it was left unchanged.
  spreadRoute: {
    ...shared,
    method: 'GET',
    path: '/spread',
    responses: { 200: z.string() },
  },
  // TODO(ts-rest-to-orpc): Responses are not an inline object literal, so they could not be split into `.output()` and `.errors()`.
  refResponses: oc
    .route({ method: 'GET', path: '/ref' }),
  // TODO(ts-rest-to-orpc): Unknown route property `somethingNew` was dropped.
  queryOnPost: oc
    .route({ method: 'POST', path: '/search', inputStructure: 'detailed' })
    .input(z.object({
      query: z.object({ q: z.string() }),
      body: z.object({ filters: z.array(z.string()) }),
    }))
    .output(z.array(z.string())),
  nullBody: oc
    .route({ method: 'POST', path: '/null', inputStructure: 'detailed' })
    .input(type<{ body: null }>())
    .output(type<null>()),
}
