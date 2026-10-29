// Diagnostics:
// info L12 [wrapper-stripped] Removed `as const` / `satisfies` wrapper from `baseRoutes`; oRPC builders carry their own types.
// info L41 [multiple-success] Multiple success statuses were converted to a detailed output union.
// info L49 [prefix-cast] pathPrefix is not a literal, so it was cast to oRPC's `/${string}` path type.
// info L49 [strict-status-codes] Dropped router-level `strictStatusCodes`.

import { oc, type } from '@orpc/contract';
import type { AnyContractRouter } from '@orpc/contract';
import { openapi } from '@orpc/openapi';

type Schemas = {
  entity: unknown;
  createBody: unknown;
  listQuery: unknown;
};

/** Builds a CRUD contract for an entity using plain types only. */
export const crudContract = <TEntity>(pathPrefix: string, schema: Schemas, extra?: AnyContractRouter) => {
  const baseRoutes = {
    findOne: oc
      .meta(openapi({ method: 'GET', path: '/{id}' }))
      .input(type<{ id: string }>((v) => v))
      .output(type<TEntity>((v) => v)),
    findMany: oc
      .meta(openapi({ method: 'GET', path: '/' }))
      .input(type<{ page?: number }>((v) => v))
      .output(type<{ records: TEntity[]; count: number }>((v) => v)),
    createOne: oc
      .meta(openapi({ method: 'POST', path: '/', successStatus: 201 }))
      .input(type<Partial<TEntity>>((v) => v))
      .output(type<TEntity>((v) => v)),
    updateOne: oc
      .errors({ NOT_FOUND: { data: type<{ message: string }>((v) => v) } })
      .meta(openapi({ method: 'PATCH', path: '/{id}', inputStructure: 'detailed' }))
      .input(type<{ params: { id: string }; body: Partial<TEntity> }>((v) => v))
      .output(type<TEntity>((v) => v)),
    deleteOne: oc
      .meta(openapi({ method: 'DELETE', path: '/{id}', successStatus: 204 }))
      .input(type<{ id: string }>((v) => v))
      .output(type<void>((v) => v)),
    archive: oc
      .meta(openapi({ method: 'POST', path: '/{id}/archive', outputStructure: 'detailed' }))
      .input(type<{ id: string }>((v) => v))
      .output(type<{ status: 200; body: TEntity } | { status: 202 }>((v) => v)),
  };

  return oc
    .meta(openapi({ prefix: pathPrefix as `/${string}` }))
    .router({
      ...baseRoutes,
      ...extra,
    });
};
