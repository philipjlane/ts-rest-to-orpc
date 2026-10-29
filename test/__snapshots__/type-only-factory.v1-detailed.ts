// Diagnostics:
// info L12 [wrapper-stripped] Removed `as const` / `satisfies` wrapper from `baseRoutes`; oRPC builders carry their own types.
// info L41 [multiple-success] Multiple success statuses were converted to a detailed output union.
// info L49 [prefix-cast] pathPrefix is not a literal, so it was cast to oRPC's `/${string}` path type.
// info L49 [strict-status-codes] Dropped router-level `strictStatusCodes`.

import { oc, type } from '@orpc/contract';
import type { AnyContractRouter } from '@orpc/contract';

type Schemas = {
  entity: unknown;
  createBody: unknown;
  listQuery: unknown;
};

/** Builds a CRUD contract for an entity using plain types only. */
export const crudContract = <TEntity>(pathPrefix: string, schema: Schemas, extra?: AnyContractRouter) => {
  const baseRoutes = {
    findOne: oc
      .route({ method: 'GET', path: '/{id}', inputStructure: 'detailed' })
      .input(type<{ params: { id: string } }>((v) => v))
      .output(type<TEntity>((v) => v)),
    findMany: oc
      .route({ method: 'GET', path: '/', inputStructure: 'detailed' })
      .input(type<{ query: { page?: number } }>((v) => v))
      .output(type<{ records: TEntity[]; count: number }>((v) => v)),
    createOne: oc
      .route({ method: 'POST', path: '/', inputStructure: 'detailed', successStatus: 201 })
      .input(type<{ body: Partial<TEntity> }>((v) => v))
      .output(type<TEntity>((v) => v)),
    updateOne: oc
      .errors({ NOT_FOUND: { status: 404, data: type<{ message: string }>((v) => v) } })
      .route({ method: 'PATCH', path: '/{id}', inputStructure: 'detailed' })
      .input(type<{ params: { id: string }; body: Partial<TEntity> }>((v) => v))
      .output(type<TEntity>((v) => v)),
    deleteOne: oc
      .route({ method: 'DELETE', path: '/{id}', inputStructure: 'detailed', successStatus: 204 })
      .input(type<{ params: { id: string } }>((v) => v))
      .output(type<void>((v) => v)),
    archive: oc
      .route({
        method: 'POST',
        path: '/{id}/archive',
        inputStructure: 'detailed',
        outputStructure: 'detailed',
      })
      .input(type<{ params: { id: string } }>((v) => v))
      .output(type<{ status: 200; body: TEntity } | { status: 202 }>((v) => v)),
  };

  return oc
    .prefix(pathPrefix as `/${string}`)
    .router({
      ...baseRoutes,
      ...extra,
    });
};
