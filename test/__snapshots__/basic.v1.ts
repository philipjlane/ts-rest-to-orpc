// Diagnostics:
// info L8 [strict-status-codes] Dropped router-level `strictStatusCodes`.
// info L43 [multiple-success] Multiple success statuses were converted to a detailed output union.

import { oc, type } from '@orpc/contract';
import { z } from 'zod';

const PostSchema = z.object({ id: z.string(), title: z.string() });

export const contract = oc
  .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: z.object({ message: z.string() }) } })
  .prefix('/api')
  .router({
    getPost: oc
      .errors({ NOT_FOUND: { status: 404, data: z.object({ message: z.string() }) } })
      .route({ method: 'GET', path: '/posts/{id}', summary: 'Get a post' })
      .input(z.object({
        id: z.string(),
      }))
      .output(PostSchema),
    listPosts: oc
      .route({ method: 'GET', path: '/posts' })
      .input(z.object({ page: z.coerce.number().optional() }))
      .output(z.array(PostSchema)),
    createPost: oc
      .errors({ BAD_REQUEST: { status: 400, data: type<{ error: string }>() } })
      .route({ method: 'POST', path: '/posts', inputStructure: 'detailed', successStatus: 201 })
      .input(z.object({
        headers: z.object({ 'x-api-key': z.string() }),
        body: z.object({ title: z.string() }),
      }))
      .output(PostSchema),
    deletePost: oc
      .errors({ NOT_FOUND: { status: 404 } })
      .meta({ role: 'admin' })
      .route({ method: 'DELETE', path: '/posts/{id}', successStatus: 204, deprecated: true })
      .input(z.object({ id: z.string().uuid() }))
      .output(type<void>()),
    // comments are kept
    nested: oc
      .prefix('/health')
      .router({
        ping: oc
          .route({ method: 'GET', path: '/ping', outputStructure: 'detailed' })
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
