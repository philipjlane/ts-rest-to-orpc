# ts-rest-to-orpc

A codemod that rewrites [ts-rest](https://github.com/ts-rest/ts-rest) contract files into [oRPC](https://orpc.dev) contract files. It parses your TypeScript with ts-morph, converts `initContract()` / `c.router()` definitions into `oc` builders from `@orpc/contract`, and reports anything it could not convert safely. It ships as a CLI and as a programmatic API, and targets oRPC v1 or v2.

## Why

ts-rest is no longer maintained. oRPC is the natural successor: it has a contract-first mode, OpenAPI support, and an actively developed ecosystem. The contract is the part of a ts-rest codebase that is most mechanical to move, so this tool does that part for you and leaves a clear trail of TODOs for the rest.

## Quick start

Commit your work first, so the diff is easy to review and revert. Then do a dry run to see what would change:

```sh
npx ts-rest-to-orpc "src/**/*.contract.ts" --dry-run
```

When you are happy with the report, run it again without `--dry-run` to rewrite the files in place:

```sh
npx ts-rest-to-orpc "src/**/*.contract.ts"
```

Run your formatter (Prettier, Biome, dprint or similar) afterwards. The codemod matches each file's quote style, semicolon habit, line endings (CRLF is preserved) and indentation (tabs, 2 or 4 spaces, detected from the file), but it does not format its output, so line breaks and wrapping in generated code will not match your house style.

Notes on file selection:

- Quote the glob so your shell does not expand it.
- With no globs, it scans `**/*.{ts,tsx,mts,cts,js,mjs}` and always ignores `node_modules` and `dist`.
- Files that contain neither `@ts-rest` nor `.router(` are skipped without being parsed.
- Diagnostics and the summary go to stderr. `--print` writes the converted source to stdout instead of touching the file.

### CLI options

| Flag | Values | Default | Meaning |
| --- | --- | --- | --- |
| `--target <version>` | `v1`, `v2` | `v1` | oRPC major version to generate. See [Choosing `--target`](#choosing---target). |
| `--input-structure <mode>` | `auto`, `detailed`, `compact` | `auto` | Shape of `.input()`. See [Input structure](#input-structure). |
| `--schema <lib>` | `auto`, `zod`, `valibot` | `auto` | Schema library used for generated wrappers. `auto` detects it from the file's imports (zod first, then valibot). |
| `--no-comments` | | comments on | Do not insert `// TODO(ts-rest-to-orpc)` comments. Diagnostics are still printed. |
| `--dry-run` | | off | Report what would change without writing files. |
| `--print` | | off | Print the converted source to stdout instead of writing it. |
| `--quiet` | | off | Print only the summary line. |
| `--verbose` | | off | Also list info-level notes per file. By default only warnings and errors are listed; the summary line still counts notes. |

Exit codes: `0` on completion (even if diagnostics include errors), `1` if no files matched or an unexpected failure occurred, `2` for an invalid option value.

## Example

ts-rest input:

```ts
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
  },
  { pathPrefix: '/api' },
);
```

oRPC v1 output (`--target v1`, the default):

```ts
import { oc, type } from '@orpc/contract';
import { z } from 'zod';

const PostSchema = z.object({ id: z.string(), title: z.string() });

export const contract = oc
  .prefix('/api')
  .router({
    getPost: oc
      .errors({ NOT_FOUND: { status: 404, data: z.object({ message: z.string() }) } })
      .route({ method: 'GET', path: '/posts/{id}', summary: 'Get a post' })
      .input(z.object({
        id: z.string(),
      }))
      .output(PostSchema),
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
  });
```

oRPC v2 output (`--target v2`), excerpt:

```ts
import { oc, type } from '@orpc/contract';
import { openapi } from '@orpc/openapi';
import { z } from 'zod';

export const contract = oc
  .meta(openapi({ prefix: '/api' }))
  .router({
    getPost: oc
      .errors({ NOT_FOUND: { data: z.object({ message: z.string() }) } })
      .meta(openapi({ method: 'GET', path: '/posts/{id}', summary: 'Get a post' }))
      .input(z.object({
        id: z.string(),
      }))
      .output(PostSchema),
    // ...
    // TODO(ts-rest-to-orpc): oRPC v2 `.meta()` only accepts plugin-defined metadata (see `defineMeta`), so `metadata` was dropped.
    deletePost: oc
      .errors({ NOT_FOUND: {} })
      .meta(openapi({ method: 'DELETE', path: '/posts/{id}', successStatus: 204, deprecated: true }))
      .input(z.object({ id: z.string().uuid() }))
      .output(type<void>()),
  });
```

## What gets converted

| ts-rest | oRPC output |
| --- | --- |
| `c.router(routes)` | The routes object is emitted as a plain object of `oc` procedures. Nested `c.router()` calls and plain nested objects become nested objects. Routes declared in `const` objects are converted at any depth, including inside factory functions. |
| `c.router(routes, options)` | Options are applied as builder calls on `oc`, followed by `.router({...})`. See the router options rows below. |
| `method`, `path` | `method` is upper-cased and placed in `.route({...})` (v1) or `.meta(openapi({...}))` (v2). `path` has `:id` rewritten to `{id}`. An optional `:id?` becomes a required `{id}` (`path-optional-param`). Template-literal paths are rewritten textually (`path-template`); non-literal paths are left as they are (`path-not-literal`). `path: '/x/:id' as const` is handled. |
| `pathParams` | Becomes the `params` part of the input. When absent but the path (or a router `pathPrefix`) has `:param` segments, a schema is synthesised with each param as a string, for example `z.object({ id: z.string() })`. |
| `query` | The `query` part of the input. |
| `body` | The `body` part of the input. `c.noBody()` as a request body is dropped. |
| `headers` | The `headers` part of the input. The legacy form, a plain object of schemas (`headers: { 'x-key': z.string() }`), is wrapped in the schema library's `object()`. Any headers force a detailed input (see [Input structure](#input-structure)). If a route's `headers` is a `c.type<T>()` and the router has `baseHeaders`, only `baseHeaders` are kept (`headers-not-merged`). |
| `responses` 2xx/3xx, one status | `.output(schema)`. A status other than 200 adds `successStatus: <status>` to the route config. A `c.noBody()` success becomes `.output(type<void>())`. For status 204, `null`, `c.type<null>()` and `c.type<undefined>()` are also treated as no body. Any other `null` response becomes `type<null>()`. |
| `responses` 2xx/3xx, several statuses | `outputStructure: 'detailed'` and an `.output()` union of `{ status: literal, body }` objects (`multiple-success` note). |
| `responses` 4xx/5xx | `.errors({ CODE: { status, data } })` in v1. In v2 the `status` field is omitted. The code comes from the table below; `c.noBody()` entries have no `data`. |
| `c.type<T>()` | `type<T>()` from `@orpc/contract`. When every request part of a route is a plain type (`c.type<T>()`, a synthesised path-param shape or no body), the whole input is emitted as a type, for example `.input(type<{ params: { id: string }; body: Partial<T> }>())`; compact merges become `type<A & B>()`. Several success statuses that are all plain types become one output type, for example `.output(type<{ status: 200; body: A } \| { status: 202 }>())`. Only mixed routes (a runtime schema next to a plain type) wrap the plain type in `z.custom<T>()` (valibot: `v.custom<T>(() => true)`) so it can sit inside an object schema; that is typed but not validated at runtime, and is reported as `plain-type-wrapped`. Inside a generic function or class, `type<T>()` is emitted as `type<T>((v) => v)`, because TypeScript cannot prove that `T` equals itself for the zero-argument overload. `c.body<T>()` and `c.response<T>()` are treated the same way. In JavaScript files (`.js`, `.mjs`, `.cjs`, `.jsx`) there are no generics, so the output is `type()`, which is typed as `unknown`. |
| `c.noBody()` | Dropped from requests; `type<void>()` as the only success output; no `data` on an error. |
| `c.otherResponse({ contentType, body })` | The `body` is converted as usual. The content type is dropped with an `other-response` warning. |
| `summary`, `description`, `deprecated` | Copied into the route config. |
| `metadata` | v1: `.meta({...})`. v2: dropped with a `metadata-v2` warning. |
| `contentType` | `multipart/form-data` is dropped with an info note (oRPC sends multipart when the body schema contains a `File` or `Blob`). `application/json` is dropped silently. Anything else is dropped with a `content-type` warning. |
| `strictStatusCodes` | Dropped (info). Applies to routes and router options. |
| `validateResponseOnClient` | Dropped (info). Applies to routes and router options. |
| router option `pathPrefix` | v1: `oc.prefix('/api').router(...)`. v2: `oc.meta(openapi({ prefix: '/api' })).router(...)`. A prefix with `:param` segments is converted to `{param}` and the params are added to the synthesised input of child routes; a route that supplies its own `pathParams` must add them itself (`prefix-params`). A non-literal prefix is cast, as in ``.prefix(pathPrefix as `/${string}`)`` (v2: inside `openapi({ prefix: ... })`), parenthesised first if it is a compound expression, and reported as info `prefix-cast`. `pathPrefix: undefined` is ignored. |
| router option `baseHeaders` | Merged into the headers of every inline route beneath the router (`base-headers-inlined`). |
| router option `commonResponses` | 4xx/5xx entries become a router-level `.errors({...})`. 2xx/3xx entries are added to every inline route beneath the router; a route's own response for the same status wins. |
| router option `metadata` | v1: merged into the `.meta()` of every inline route (`metadata-inlined`), with the route's own metadata taking precedence. v2: dropped with a warning. |
| `c.query({...})`, `c.mutation({...})` | Unwrapped to the same `oc` procedure as a plain route object. |
| `satisfies AppRoute`, `satisfies AppRouter`, `as const` | Stripped from converted routes and routers (`wrapper-stripped`), since oRPC builders carry their own types. |
| `AppRouter`, `AppRoute` types | Renamed to `AnyContractRouter` and `AnyContractProcedure`, imported with `import type { ... } from '@orpc/contract'`, and only when still referenced. |
| Imports | `initContract` and `initTsRest` (including aliases such as `initContract as init`) are removed from `@ts-rest/core`, and the import is deleted if nothing else is left. The first new `@orpc/contract` import reuses that declaration in place, so a leading licence or header comment survives; other new imports go after the leading import block. Added imports: `oc` and `type` from `@orpc/contract`, `openapi` from `@orpc/openapi` (v2 only), and `import { z } from 'zod'` if a generated wrapper needs it and no schema library import was found (files that only use `c.type` need no zod import at all). `const c = initContract()` is deleted once nothing references it. If it is still referenced, or exported, it is kept (with `initContract` still imported) and flagged. An imported instance (`import { c } from './c'`) is removed once unused. |

### Supported shapes

Besides `const c = initContract()` at the top of a file, the codemod recognises:

- `initContract().router(...)` chained without a variable, and `const c = initContract()` inside functions.
- Aliased imports such as `import { initContract as init }`.
- Routes or routers wrapped in `as const` or `satisfies` inside a router.
- A router call used as an arrow-function body (parenthesised when it becomes a plain object).
- An imported contract instance (`import { c } from './c'`) used with identifier-only routers, for example `c.router({ users: usersContract }, { pathPrefix: '/api' })`. The now-unused `c` import is removed.
- Routes declared in `const` objects at any depth, including inside factory functions.

### Error status to code

Used for `.errors()` in both targets. Statuses without a built-in oRPC code become `HTTP_<status>` (for example `HTTP_418`).

| Status | Code |
| --- | --- |
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 405 | `METHOD_NOT_SUPPORTED` |
| 406 | `NOT_ACCEPTABLE` |
| 408 | `TIMEOUT` |
| 409 | `CONFLICT` |
| 412 | `PRECONDITION_FAILED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `UNPROCESSABLE_CONTENT` |
| 429 | `TOO_MANY_REQUESTS` |
| 499 | `CLIENT_CLOSED_REQUEST` |
| 500 | `INTERNAL_SERVER_ERROR` |
| 501 | `NOT_IMPLEMENTED` |
| 502 | `BAD_GATEWAY` |
| 503 | `SERVICE_UNAVAILABLE` |
| 504 | `GATEWAY_TIMEOUT` |

## Input structure

oRPC procedures take one input. ts-rest keeps path params, query, headers and body separate, so the codemod has to decide how to pack them. `--input-structure` controls this.

- `detailed`: always emits `{ params, query, headers, body }` containing only the parts the route has, and sets `inputStructure: 'detailed'` on the route. Nothing is merged, so nothing can collide or be lost. If every part is a plain type, the wrapper is a type literal inside `type<...>()` instead of a schema object.
- `compact`: oRPC's default shape. A single part becomes the input directly. Path params together with query (on `GET`/`HEAD`) or body (on other methods) are merged into one object schema (`.extend(x.shape)` for zod, spread `.entries` for valibot) and reported as `input-merged`. The merge assumes both parts are plain object schemas and does not check, so merging real schemas is reported as an `input-merged` warning with a TODO; when both are plain types the merge is emitted as `type<A & B>()` and reported as info. Headers, query on a non-`GET`/`HEAD` route, and body on a `GET`/`HEAD` route cannot be represented compactly, so the route falls back to detailed with an `input-forced-detailed` warning.
- `auto` (default): chooses per route. A route is compact when it has at most one request part and no headers (and that part is the natural one for the method: params, query on `GET`/`HEAD`, or body otherwise). Every other route is detailed.

`auto` is the default because it produces the flattest input wherever that is lossless, and falls back to the explicit shape wherever compact would have to merge schemas or could not express a part at all. It never emits the `input-forced-detailed` warning, and it never merges schemas behind your back.

## Choosing `--target`

| | `v1` | `v2` |
| --- | --- | --- |
| oRPC status | Current npm `latest`. | Beta. |
| Route config | `oc.route({ method, path, ... })` | `oc.meta(openapi({ method, path, ... }))` with `openapi` from `@orpc/openapi` |
| Router prefix | `oc.prefix('/api')` | `oc.meta(openapi({ prefix: '/api' }))` |
| `.errors()` entries | `{ status, data }` | `{ data }` only. The status comes from oRPC's built-in code map. |
| Custom statuses | The status is written explicitly (`HTTP_418: { status: 418 }`). | `HTTP_<status>` codes are generated with an `error-status-custom` warning. Provide an `errorStatusMap` on your OpenAPI handler to give them a status. |
| `metadata` | `.meta({...})` | Not supported. `.meta()` only accepts plugin-defined metadata, so it is dropped with a warning. |

Pick `v1` unless you are already on the v2 beta. The same ts-rest input converts cleanly to either.

## Diagnostics

Each finding has a level, a code, a message and a 1-based line in the original source.

- `info`: something was changed or dropped deliberately and needs no action.
- `warn`: output was produced but may not match the original behaviour. Review it.
- `error`: the construct could not be converted and was left unchanged.

The CLI prints warnings and errors to stderr, grouped by file, plus a summary count that includes info notes. Pass `--verbose` to list the info notes too, or `--quiet` to print only the summary. Route-level warnings and errors also become `// TODO(ts-rest-to-orpc): ...` comments above the affected procedure unless you pass `--no-comments`. Router-level and file-level findings, and all `info` notes, are reported but never written as comments. The programmatic `comments: false` option is equivalent to `--no-comments`.

| Code | Level | Meaning |
| --- | --- | --- |
| `base-headers-inlined` | info | Router `baseHeaders` were merged into each inline route's headers. |
| `content-type` | info / warn | A route `contentType` was dropped. Info for `multipart/form-data`, warning for anything other than `application/json`. |
| `input-merged` | info / warn | Path params and query/body were merged into one compact input. Info for plain-type merges (`type<A & B>()`); warning when real schemas are merged with `.extend(...shape)` or `.entries`, because both sides must be plain object schemas. |
| `metadata-inlined` | info | Router `metadata` was merged into each inline route's `.meta()` (v1). |
| `multiple-success` | info | Several success statuses became a detailed output union. |
| `prefix-cast` | info | A non-literal `pathPrefix` was cast to oRPC's `/${string}` path type. |
| `strict-status-codes` | info | `strictStatusCodes` was dropped. |
| `validate-response-on-client` | info | `validateResponseOnClient` was dropped. |
| `wrapper-stripped` | info | `as const` / `satisfies` was removed from a converted declaration. |
| `contract-instance-exported` | warn | `export const c = initContract()` was kept so importers keep working. |
| `contract-instance-still-used` | warn | `initContract()` was kept because the contract variable is still referenced. |
| `contract-not-converted` | warn | An `initContract()` call is used in an unsupported way, such as being destructured, so nothing depending on it was converted. |
| `error-status-custom` | warn | The status has no built-in oRPC code; `HTTP_<status>` was generated (v2). |
| `headers-not-merged` | warn | A route's `headers: c.type<T>()` could not be merged with router `baseHeaders`; only `baseHeaders` were kept. |
| `helper-not-converted` | warn | A `c.<helper>()` call outside a route, such as `c.responses()`, was left unchanged. |
| `input-forced-detailed` | warn | `--input-structure compact` was overridden for a route that cannot be compact. |
| `metadata-v2` | warn | `metadata` was dropped because v2 `.meta()` takes plugin-defined metadata only. |
| `options-not-applied` | warn | Router options could not be applied to a route that is not an inline object. |
| `other-response` | warn | `c.otherResponse` content type was dropped. |
| `path-optional-param` | warn | An optional `:id?` path param became required, because oRPC has no optional path params. |
| `path-not-literal` | warn | The path is not a string literal, so `:param` segments were not rewritten. |
| `path-template` | warn | The path is a template literal; params were rewritten textually. |
| `plain-type-wrapped` | warn | A plain `c.type<T>()` was wrapped in `z.custom<T>()` next to a runtime schema; it is not validated at runtime. |
| `prefix-params` | warn | A router `pathPrefix` has `:param` segments and the route supplies its own `pathParams`; add the prefix params to that schema. |
| `route-not-converted` | warn | `c.query()` / `c.mutation()` outside a router or variable declaration was left unchanged. |
| `schema-lib-unknown` | warn | No schema library import was found, so generated wrappers assume zod and a zod import was added. Reported once per file, on line 1. |
| `ts-rest-import-remaining` | warn | Names are still imported from `@ts-rest/core` and need manual migration. |
| `unknown-route-key` | warn | A route property the codemod does not know was dropped. |
| `unknown-router-option` | warn | A router option the codemod does not know was dropped. |
| `common-responses-not-literal` | error | `commonResponses` is not an inline object and was dropped. |
| `response-status-not-literal` | error | A response key is not a numeric status and was skipped. |
| `responses-not-literal` | error | `responses` is not an inline object, so it was not split into `.output()` and `.errors()`. |
| `responses-spread` | error | `responses` contains a spread or shorthand entry that was skipped. |
| `route-spread` | error | The route contains a spread or method, so it was left unchanged. |
| `router-not-converted` | error | A `.router()` call was left as it was: its routes are not an object literal or identifier in a supported position. |
| `router-options-not-literal` | error | Router options are not an inline object and were dropped. |

## What is not converted

This tool only rewrites contract definitions. Everything built on top of them is yours to migrate:

- Server handlers and routers (`@ts-rest/express`, `@ts-rest/fastify`, `@ts-rest/next`, `@ts-rest/nest` and so on). Implement the contract with `@orpc/server` instead.
- Clients (`initClient`, `initQueryClient`, `@ts-rest/react-query` and the like). Use oRPC's client and its TanStack Query integration.
- Any `@ts-rest/*` package other than `@ts-rest/core` is not touched. Names left in a `@ts-rest/core` import are flagged with `ts-rest-import-remaining`.
- Type helpers such as `ClientInferResponses`, `ClientInferRequest`, `ServerInferResponses` and `InferResponseBody`. Only `AppRouter` and `AppRoute` are renamed.
- Contracts whose paths, `responses` or router options are not inline literals, and routes containing spreads. These are left in place or partially converted and flagged.
- Enum or computed response keys such as `[HttpStatus.OK]`, and a variable passed as router options.
- A destructured `initContract()` (`contract-not-converted`), and `.router()` calls whose routes are not an object literal or identifier in a supported position (`router-not-converted`).
- Inline comments inside route objects, which are lost.
- Compact merging of real schemas assumes plain object schemas (see [Input structure](#input-structure)).
- Contract objects shared across files are converted where they are defined. A file that only uses an imported `c` is handled when it contains an inline `c.router({...})` call with recognisable routes.

See the [oRPC documentation](https://orpc.dev) for implementing contracts, building clients, error handling and OpenAPI generation.

## Tested against real contracts

The codemod has been run over a 60-file production contract set, covering both type-only and zod-based contracts. The output compiled against both oRPC 1.16 and 2.0.0-beta.47.

## Programmatic API

```ts
import { transform } from 'ts-rest-to-orpc'

const source = `
import { initContract } from '@ts-rest/core'
import { z } from 'zod'

const c = initContract()

export const contract = c.router({
  getUser: { method: 'GET', path: '/users/:id', responses: { 200: z.object({ id: z.string() }) } },
})
`

const { code, changed, diagnostics } = transform(
  source,
  { target: 'v1', inputStructure: 'auto', schema: 'auto', comments: true },
  'user.contract.ts',
)

if (changed) console.log(code)
for (const d of diagnostics) console.warn(`${d.level} L${d.line} [${d.code}] ${d.message}`)
```

`transform(code, options?, filePath?)` returns `{ code, changed, diagnostics }`. All options are optional and default to the values shown in the CLI table. `filePath` defaults to `contract.ts`; its extension selects the script kind (`.tsx`, `.jsx`, `.js` and so on). `diagnostics` is sorted by line, where `line` is 1-based and refers to the original source.

The package is ESM only. It also exports `transformSourceFile`, `createProject`, `convertPath` and `errorCodeForStatus`, plus the types `TransformOptions`, `TransformResult`, `Diagnostic`, `DiagnosticLevel`, `Target`, `InputStructureMode` and `SchemaLibrary`.

## Development

Requires Node 20 or later and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm test               # vitest: fixture snapshots and unit tests
pnpm typecheck          # tsc --noEmit on the codemod itself
pnpm typecheck:fixtures # compile the converted fixtures against real oRPC packages
pnpm build              # tsdown, writes dist/
```

Fixtures live in `test/fixtures` and their expected outputs, for each target and input structure, in `test/__snapshots__`. Each snapshot starts with a header listing its diagnostics.

`pnpm typecheck:fixtures` regenerates the converted fixtures into `typecheck/v1/generated` and `typecheck/v2/generated`, then runs `tsc` in each workspace. `typecheck/v1` installs the real `@orpc/contract` v1 package and `typecheck/v2` installs the v2 beta packages (`@orpc/contract`, `@orpc/openapi`, `@orpc/server`), so the generated code is checked against the actual builder APIs rather than against our own assumptions. The fixtures `edge-cases`, `imported-contract` and `no-schema-lib` are skipped because they are deliberately unconvertible or import local modules.

## Licence

[MIT](./LICENSE)
