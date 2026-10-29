# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-29

### Added

- Initial release of the `ts-rest-to-orpc` codemod, available as a CLI (`npx ts-rest-to-orpc "src/**/*.ts"`) and as a programmatic API (`transform(code, options, filePath)` returning `{ code, changed, diagnostics }`).
- Conversion of ts-rest contracts to oRPC contracts: `c.router()` (including nested routers), `c.query()` and `c.mutation()`, `method` and `path` (`:id` to `{id}`), `pathParams` (with synthesised string params when absent), `query`, `body`, `headers` (including the legacy plain-object form), `summary`, `description`, `deprecated` and `metadata`.
- Response conversion: a single 2xx response becomes `.output()` with `successStatus`; several become a detailed output union; 4xx and 5xx responses become `.errors()` using oRPC's status-to-code table, with `HTTP_<status>` for unknown statuses.
- Support for `c.type<T>()`, `c.noBody()` and `c.otherResponse`.
- Router options: `pathPrefix`, `baseHeaders`, `commonResponses` and `metadata`.
- Import rewriting, removal of `satisfies AppRoute` / `satisfies AppRouter` / `as const`, and renaming of the `AppRouter` and `AppRoute` types.
- `--target v1|v2` to generate either `oc.route({...})` (oRPC v1) or `.meta(openapi({...}))` from `@orpc/openapi` (oRPC v2 beta).
- `--input-structure auto|detailed|compact`, with `auto` as the default.
- `--schema auto|zod|valibot` for generated wrappers, with detection from the file's imports.
- Diagnostics at `info`, `warn` and `error` levels, with `// TODO(ts-rest-to-orpc): ...` comments for route-level problems (disable with `--no-comments`).
- `--dry-run`, `--print` and `--quiet` flags.
- Fixture snapshot tests, and `pnpm typecheck:fixtures`, which compiles converted fixtures against the real `@orpc/contract` v1 and v2 packages.

[0.1.0]: https://github.com/philiplane/ts-rest-to-orpc/releases/tag/v0.1.0
