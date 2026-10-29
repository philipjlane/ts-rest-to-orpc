import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

const PostSchema = z.object({ id: z.string(), title: z.string() });

export const contract = c.router(
  {
    getPost: {
      method: 'GET',
      path: '/posts/:id',
      summary: 'Get a post',
      responses: {
        200: PostSchema,
        404: z.object({ message: z.string() }),
      },
    },
    listPosts: {
      method: 'GET',
      path: '/posts',
      query: z.object({ page: z.coerce.number().optional() }),
      responses: { 200: z.array(PostSchema) },
    },
    createPost: {
      method: 'POST',
      path: '/posts',
      body: z.object({ title: z.string() }),
      headers: z.object({ 'x-api-key': z.string() }),
      responses: { 201: PostSchema, 400: c.type<{ error: string }>() },
    },
    deletePost: {
      method: 'DELETE',
      path: '/posts/:id',
      pathParams: z.object({ id: z.string().uuid() }),
      body: c.noBody(),
      responses: { 204: c.noBody(), 404: c.noBody() },
      deprecated: true,
      metadata: { role: 'admin' },
    },
    // comments are kept
    nested: c.router({
      ping: { method: 'GET', path: '/ping', responses: { 200: z.literal('pong'), 201: z.string() } },
    }, { pathPrefix: '/health' }),
  },
  { pathPrefix: '/api', commonResponses: { 500: z.object({ message: z.string() }) }, strictStatusCodes: true },
);
