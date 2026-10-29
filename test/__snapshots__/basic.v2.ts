// Diagnostics:
// info L8 [strict-status-codes] Dropped router-level `strictStatusCodes`.
// warn L32 [metadata-v2] oRPC v2 `.meta()` only accepts plugin-defined metadata (see `defineMeta`), so `metadata` was dropped.
// info L43 [multiple-success] Multiple success statuses were converted to a detailed output union.

import { oc, type } from '@orpc/contract';
import { openapi } from '@orpc/openapi';
import { z } from 'zod';

const PostSchema = z.object({ id: z.string(), title: z.string() });

export const contract = oc
  .errors({ INTERNAL_SERVER_ERROR: { data: z.object({ message: z.string() }) } })
  .meta(openapi({ prefix: '/api' }))
  .router({
    getPost: oc
      .errors({ NOT_FOUND: { data: z.object({ message: z.string() }) } })
      .meta(openapi({ method: 'GET', path: '/posts/{id}', summary: 'Get a post' }))
      .input(z.object({
        id: z.string(),
      }))
      .output(PostSchema),
    listPosts: oc
      .meta(openapi({ method: 'GET', path: '/posts' }))
      .input(z.object({ page: z.coerce.number().optional() }))
      .output(z.array(PostSchema)),
    createPost: oc
      .errors({ BAD_REQUEST: { data: type<{ error: string }>() } })
      .meta(openapi({ method: 'POST', path: '/posts', inputStructure: 'detailed', successStatus: 201 }))
      .input(z.object({
        headers: z.object({ 'x-api-key': z.string() }),
        body: z.object({ title: z.string() }),
      }))
      .output(PostSchema),
    // TODO(ts-rest-to-orpc): oRPC v2 `.meta()` only accepts plugin-defined metadata (see `defineMeta`), so `metadata` was dropped.
    deletePost: oc
      .errors({ NOT_FOUND: {} })
      .meta(openapi({ method: 'DELETE', path: '/posts/{id}', successStatus: 204, deprecated: true }))
      .input(z.object({ id: z.string().uuid() }))
      .output(type<void>()),
    // comments are kept
    nested: oc
      .meta(openapi({ prefix: '/health' }))
      .router({
        ping: oc
          .meta(openapi({ method: 'GET', path: '/ping', outputStructure: 'detailed' }))
          .output(z.union([
            z.object({
              status: z.literal(200),
              body: z.literal('pong'),
            }),
            z.object({
              status: z.literal(201),
              body: z.string(),
            }),
          ])),
      }),
  });
