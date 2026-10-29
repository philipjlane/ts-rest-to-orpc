import { AppRouter, initContract } from '@ts-rest/core';
const c = initContract();

type Schemas = {
  entity: unknown;
  createBody: unknown;
  listQuery: unknown;
};

/** Builds a CRUD contract for an entity using plain types only. */
export const crudContract = <TEntity>(pathPrefix: string, schema: Schemas, extra?: AppRouter) => {
  const baseRoutes = {
    findOne: {
      method: 'GET',
      path: `/:id`,
      responses: { 200: c.type<TEntity>() },
    },
    findMany: {
      method: 'GET',
      path: '/',
      query: c.type<{ page?: number }>(),
      responses: { 200: c.type<{ records: TEntity[]; count: number }>() },
    },
    createOne: {
      method: 'POST',
      path: '/',
      body: c.type<Partial<TEntity>>(),
      responses: { 201: c.type<TEntity>() },
    },
    updateOne: {
      method: 'PATCH',
      path: '/:id',
      body: c.type<Partial<TEntity>>(),
      responses: { 200: c.type<TEntity>(), 404: c.type<{ message: string }>() },
    },
    deleteOne: {
      method: 'DELETE',
      path: '/:id',
      responses: { 204: null },
    },
    archive: {
      method: 'POST',
      path: '/:id/archive',
      body: c.noBody(),
      responses: { 200: c.type<TEntity>(), 202: c.noBody() },
    },
  } as const;

  return c.router({ ...baseRoutes, ...extra }, { strictStatusCodes: true, pathPrefix });
};
