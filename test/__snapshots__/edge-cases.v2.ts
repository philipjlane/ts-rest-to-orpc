// Diagnostics:
// warn L3 [contract-instance-still-used] `c` is still referenced after conversion, so `initContract()` was kept.
// warn L7 [helper-not-converted] `c.responses()` used outside a route was left unchanged; oRPC has no direct equivalent.
// warn L11 [error-status-custom] Status 418 has no built-in oRPC error code; `HTTP_418` was generated. Map it with `errorStatusMap` on your OpenAPI handler.
// warn L16 [other-response] Response 200 used `c.otherResponse` with contentType 'application/pdf'; oRPC derives the content type from the schema, so set it via the OpenAPI spec if it matters.
// warn L23 [path-template] Path is a template literal; `:param` segments were rewritten to `{param}` textually. Check the result.
// warn L28 [path-not-literal] Path is not a string literal, so `:param` segments could not be rewritten to `{param}`.
// error L33 [route-spread] Route object contains a spread or method; it was left unchanged.
// error L39 [responses-not-literal] Responses are not an inline object literal, so they could not be split into `.output()` and `.errors()`.
// warn L44 [unknown-route-key] Unknown route property `somethingNew` was dropped.

import { oc, type } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

const c = initContract()

const BASE = '/v1'
const commonResponses = c.responses({ 500: z.object({ message: z.string() }) })
const shared = { summary: 'shared' }

export const contract = {
  // TODO(ts-rest-to-orpc): Status 418 has no built-in oRPC error code; `HTTP_418` was generated. Map it with `errorStatusMap` on your OpenAPI handler.
  teapot: oc
    .errors({ HTTP_418: { data: z.object({ reason: z.string() }) } })
    .meta(openapi({ method: 'GET', path: '/brew' }))
    .output(z.string()),
  // TODO(ts-rest-to-orpc): Response 200 used `c.otherResponse` with contentType 'application/pdf'; oRPC derives the content type from the schema, so set it via the OpenAPI spec if it matters.
  download: oc
    .meta(openapi({ method: 'GET', path: '/files/{id}' }))
    .input(z.object({
      id: z.string(),
    }))
    .output(type<Blob>()),
  // TODO(ts-rest-to-orpc): Path is a template literal; `:param` segments were rewritten to `{param}` textually. Check the result.
  templatePath: oc
    .meta(openapi({ method: 'GET', path: `${BASE}/things/{id}` }))
    .input(z.object({
      id: z.string(),
    }))
    .output(z.string()),
  // TODO(ts-rest-to-orpc): Path is not a string literal, so `:param` segments could not be rewritten to `{param}`.
  dynamicPath: oc
    .meta(openapi({ method: 'GET', path: BASE }))
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
    .meta(openapi({ method: 'GET', path: '/ref' })),
  // TODO(ts-rest-to-orpc): Unknown route property `somethingNew` was dropped.
  queryOnPost: oc
    .meta(openapi({ method: 'POST', path: '/search', inputStructure: 'detailed' }))
    .input(z.object({
      query: z.object({ q: z.string() }),
      body: z.object({ filters: z.array(z.string()) }),
    }))
    .output(z.array(z.string())),
  nullBody: oc
    .meta(openapi({ method: 'POST', path: '/null' }))
    .input(type<null>())
    .output(type<null>()),
}
