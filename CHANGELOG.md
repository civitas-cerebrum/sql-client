# Changelog

All notable changes to `@civitas-cerebrum/sql-client` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-06-16

### Added

- **`sql` tagged template** — `` sql`... ${value}` `` compiles to engine-correct placeholders;
  `sql.id()` interpolates dialect-quoted identifiers; fragments nest. `SqlClient.query`/`execute`
  accept a fragment directly.
- **Builder where variants** — `whereIn(col, values)` (one placeholder per value; throws on an empty
  array), `whereNull(col)`, `whereNotNull(col)`.
- **Builder terminals** — `fetch`, `one`, `maybeOne`, `scalar`, `count`, and `exists` dispatch through
  a client and shape the result in one call.
- **Client conveniences** — `SqlClient.fetch()` (query → `ResultSet`), `ping()` (connectivity probe),
  `runScript()` (split + execute a multi-statement script), and a `connectTimeoutMs` config option.
- **`splitSqlScript(sqlText, engine?)`** — comment/quote-aware statement splitter with engine extras
  (Oracle `/` terminator and `BEGIN..END` awareness, SQL Server `GO`).
- **Typed rows** — `Row<T>` and `ResultSet<T>` now give column-name autocomplete while still allowing
  case-insensitive/arbitrary-string lookups; `ColumnOf<T>` and `SqlLogger` are exported.
- Richer `QueryFailedException` messages embedding the (truncated) SQL and params, plus a cross-engine
  hint when the placeholder style doesn't match the engine.
- Debug logging now covers statements executed inside transactions, plus `begin`/`commit`/`rollback`
  lifecycle and failure lines.

### Changed

- **BREAKING: `ResultSet.where()` now returns a chainable `ResultSet`** instead of `Row[]`. Code that
  indexed the array (`.where(...)[0]`) should use `.where(...).first()` / `.one()`; `.length` and
  iteration still work.
- **BREAKING: `QueryBuilder.toSql(dialect)` now requires an explicit dialect** (it previously defaulted
  to Postgres, which silently produced wrong SQL for other engines).
- **BREAKING: minimum Node bumped to `>=20`** (Node 18 is EOL and the SQLite driver no longer installs
  on it); CI now tests Node 20, 22, and 24.
- Transaction handles passed to `transaction(fn)` now carry `dialect` and `engine`, so
  `QueryBuilder.run(tx)` works inside a transaction.
- Equality matchers (`eq`/`ne`/`oneOf`) and literal partials compare numerically when both sides are
  numeric, so a `6.5` query matches a `"6.50"` cell from postgres/mysql.
- Postgres debug namespace renamed `sql:pg` → `sql:postgres` for consistency with the other engines.
- `npm audit` PR gate scoped to runtime dependencies (`--omit=dev`); a weekly scheduled job runs the
  full audit. Added Dependabot, a publish tag/version guard, and `prepublishOnly` now runs the tests.

### Fixed

- **SQLite parameter binding** — `Date`, `boolean`, and `undefined` params are normalised
  (`Date → ISO`, `boolean → 1/0`, `undefined → null`) instead of throwing a cryptic driver error.
- **Generic constraints** — `rows()`/`ResultSet`/`Row`/`getScalar` accept plain interface row types
  (previously rejected for lacking an index signature).
- **Type leak** — the public `.d.ts` no longer imports from `debug` (which would fail for consumers
  compiling with `skipLibCheck: false`); logger types are exposed as `SqlLogger`.
- **Credential redaction** — `detectEngine`'s error no longer echoes the password from a connection
  string.
- **Lazy-require masking** — a driver that is installed but fails to load (e.g. native ABI mismatch)
  now surfaces the real error instead of a misleading "install the driver" message.
- A failed coercion in a result accessor now throws `ResultError` (part of the `SqlException` family)
  rather than a bare `RangeError`.

## [0.1.0] — 2026-06-12

Initial release: a lightweight multi-engine SQL client (PostgreSQL, MySQL/MariaDB, SQLite, SQL Server,
Oracle) with engine auto-detection, lazy optional-peer-dependency drivers, a fluent query builder
(multi-row insert, per-engine `RETURNING`/`OUTPUT`), normalized typed results with case-insensitive
coercing accessors, in-memory row matchers, transactions, typed exceptions, `DEBUG=sql:*` logging, and
a bundled Claude Code skill.

[0.1.1]: https://github.com/civitas-cerebrum/sql-client/releases/tag/0.1.1
[0.1.0]: https://github.com/civitas-cerebrum/sql-client/releases/tag/0.1.0
