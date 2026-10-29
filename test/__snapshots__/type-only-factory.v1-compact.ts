// Diagnostics:
// info L12 [wrapper-stripped] Removed `as const` / `satisfies` wrapper from `baseRoutes`; oRPC builders carry their own types.
// info L30 [input-merged] Path params and query/body schemas were merged into one compact input.
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
export const repositoryContract = <TEntity>(pathPrefix: string, schema: Schemas, extra?: AnyContractRouter) => {
  const baseRoutes = {
    findOne: oc
      .route({ method: 'GET', path: '/{id}' })
      .input(type<{ id: string }>((v) => v))
      .output(type<TEntity>((v) => v)),
    findMany: oc
      .route({ method: 'GET', path: '/' })
      .input(type<{ page?: number }>((v) => v))
      .output(type<{ records: TEntity[]; count: number }>((v) => v)),
    createOne: oc
      .route({ method: 'POST', path: '/', successStatus: 201 })
      .input(type<Partial<TEntity>>((v) => v))
      .output(type<TEntity>((v) => v)),
    updateOne: oc
      .errors({ NOT_FOUND: { status: 404, data: type<{ message: string }>((v) => v) } })
      .route({ method: 'PATCH', path: '/{id}' })
      .input(type<{ id: string } & Partial<TEntity>>((v) => v))
      .output(type<TEntity>((v) => v)),
    deleteOne: oc
      .route({ method: 'DELETE', path: '/{id}', successStatus: 204 })
      .input(type<{ id: string }>((v) => v))
      .output(type<void>((v) => v)),
    archive: oc
      .route({ method: 'POST', path: '/{id}/archive', outputStructure: 'detailed' })
      .input(type<{ id: string }>((v) => v))
      .output(type<{ status: 200; body: TEntity } | { status: 202 }>((v) => v)),
  };

  return oc
    .prefix(pathPrefix as `/${string}`)
    .router({
      ...baseRoutes,
      ...extra,
    });
};
