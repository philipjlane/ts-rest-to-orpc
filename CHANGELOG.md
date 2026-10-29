# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-29

### Added

- Initial release of the `ts-rest-to-orpc` codemod, available as a CLI (`npx ts-rest-to-orpc "src/**/*.ts"`) and as a programmatic API (`transform(code, options, filePath)` returning `{ code, changed, diagnostics }`).
- Conversion of ts-rest contracts to oRPC contracts: `c.router()` (including nested routers), `c.query()` and `c.mutation()`, `method` and `path` (`:id` to `{id}`), `pathParams` (with synthesised string params when absent), `query`, `body`, `headers` (including the legacy plain-object form), `summary`, `description`, `deprecated` and `metadata`.
- Response conversion: a single 2xx response becomes `.output()` with `successStatus`; several become a detailed output union; 4xx and 5xx responses become `.errors()` using oRPC's status-to-code table, with `HTTP_<status>` for unknown statuses.
- Support for `c.type<T>()`, `c.noBody()` and `c.otherResponse`. Routes whose request parts are all plain types get a `type<...>()` input (merges become `type<A & B>()`), and several plain-type success statuses become a single `type<...>()` output. Only mixed routes wrap a plain type in `z.custom<T>()`, reported as `plain-type-wrapped`. Inside generic functions and classes, `type<T>((v) => v)` is emitted.
- Treatment of `204: null`, `204: c.type<null>()` and `204: c.type<undefined>()` as no body.
- Conversion of routes declared in `const` objects at any depth, including inside factory functions.
- Router options: `pathPrefix` (non-literal prefixes are cast to `/${string}` and reported as `prefix-cast`), `baseHeaders`, `commonResponses` and `metadata`.
- Import rewriting, removal of `satisfies AppRoute` / `satisfies AppRouter` / `as const`, and renaming of the `AppRouter` and `AppRoute` types (imported with `import type` from `@orpc/contract`, only when still referenced).
- `--target v1|v2` to generate either `oc.route({...})` (oRPC v1) or `.meta(openapi({...}))` from `@orpc/openapi` (oRPC v2 beta).
- `--input-structure auto|detailed|compact`, with `auto` as the default.
- `--schema auto|zod|valibot` for generated wrappers, with detection from the file's imports.
- Diagnostics at `info`, `warn` and `error` levels, with `// TODO(ts-rest-to-orpc): ...` comments for route-level problems (disable with `--no-comments`).
- `--dry-run`, `--print`, `--quiet` and `--verbose` flags. By default only warnings and errors are listed per file; `--verbose` adds info notes.
- `schema-lib-unknown` is reported once per file, and a zod import is added when the codemod had to generate a wrapper without a detected schema library.
- Validation against a 60-file production contract set (type-only and zod-based), with the output compiled against oRPC 1.16 and 2.0.0-beta.47.
- Fixture snapshot tests, and `pnpm typecheck:fixtures`, which compiles converted fixtures against the real `@orpc/contract` v1 and v2 packages.

[0.1.0]: https://github.com/philiplane/ts-rest-to-orpc/releases/tag/v0.1.0
