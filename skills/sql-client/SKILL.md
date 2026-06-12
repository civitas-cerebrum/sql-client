---
name: sql-client
description: >
  Use this skill whenever the user wants to query a SQL database, seed or verify test data in
  Postgres/MySQL/SQLite/SQL Server/Oracle, or wire database checks into tests in a TypeScript
  project that has @civitas-cerebrum/sql-client installed. Triggers on: "sql-client",
  "@civitas-cerebrum/sql-client", "SqlClient", "QueryBuilder", "ResultSet", `rows(...)` over a
  query result, "QueryFailedException", "UnsupportedEngineException", or any request to
  write/fix/explain code built on this package. Also triggers on general intents — "query the
  database", "check the row exists", "seed test data", "run SQL in a test", "connect to
  postgres/mysql/sqlite/mssql/oracle", "verify the database state after this action" — when the
  project's package.json already depends on `@civitas-cerebrum/sql-client`. Always consult this
  skill before generating client config, builder chains, or result-accessor calls — do not invent
  method signatures from memory; the conventions are specific (placeholder style differs per
  engine in raw SQL, RETURNING is per-engine, Oracle returns UPPERCASE keys, numeric columns may
  arrive as strings) and easy to get wrong without this reference. Precedence: inside a test spec
  of a project using a @civitas-cerebrum test framework (element-interactions/achilles or
  singularity-engine), database work goes through the framework's `steps.sql*` surface — route to
  the `database-testing` skill there; this skill governs direct package usage (fixtures, harness
  internals, scripts, applications, or projects without those frameworks).
---

# @civitas-cerebrum/sql-client — Agent Skill

A lightweight **multi-engine** SQL client (PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, Oracle) with a fluent query builder, typed results, and always-parametrised queries. Sibling to `@civitas-cerebrum/wasapi` (HTTP). One API, five engines: the dialect layer renders engine-correct placeholders, quoting, pagination, and row-returning writes.

This skill is the consumer-facing usage guide. If a signature or option shape isn't specified here, **stop and read the package's `dist/` types** rather than guessing.

> **Routing:** in projects built on a @civitas-cerebrum test framework (element-interactions/achilles, singularity-engine), test specs must use the framework's `steps.sqlQuery/sqlExecute/sqlTransaction/sqlSelect…/verifySql*` wrappers — defer to the **database-testing** skill for those. Use this skill when driving the package directly: framework internals, fixtures, seed/cleanup scripts, standalone tools, or projects that depend on sql-client without those frameworks.

## When to read which section

| You're about to… | Read |
|---|---|
| Connect to a database | [§ Connecting](#connecting) — engine detection and per-engine config |
| Run raw SQL | [§ Raw queries](#raw-queries) — placeholder style differs per engine |
| Build a query fluently | [§ QueryBuilder](#querybuilder) — `?` markers are normalized per engine |
| Get generated IDs / rows back from a write | [§ Returning rows from writes](#returning-rows-from-writes) — per-engine support matrix |
| Read values out of result rows | [§ Reading results](#reading-results) — case/type pitfalls live here |
| Filter rows in memory | [§ Matchers](#matchers) |
| Wrap writes atomically | [§ Transactions](#transactions) |
| Handle failures | [§ Exceptions](#exceptions) |
| Use it in a test suite | [§ Testing patterns](#testing-patterns) |

---

## Install

The native driver is an **optional peer dep** — install the one(s) for your engine(s):

```sh
npm install @civitas-cerebrum/sql-client pg              # PostgreSQL
npm install @civitas-cerebrum/sql-client mysql2          # MySQL / MariaDB
npm install @civitas-cerebrum/sql-client better-sqlite3  # SQLite (zero infrastructure)
npm install @civitas-cerebrum/sql-client mssql           # SQL Server
npm install @civitas-cerebrum/sql-client oracledb        # Oracle (Thin mode)
```

Importing the package never loads a native driver; the driver is `require`d when the first client for that engine is constructed. A missing driver throws `UnsupportedEngineException` with an install hint.

## Connecting

```ts
import { SqlClient } from '@civitas-cerebrum/sql-client';
```

`new SqlClient(config)` — config fields:

| Field | Type | Notes |
|---|---|---|
| `connectionString` | `string?` | Engine auto-detected from the scheme (below) |
| `engine` | `'postgres' \| 'mysql' \| 'sqlite' \| 'mssql' \| 'oracle'?` | Required only when no scheme gives it away |
| `connection` | `object?` | Engine-native options (mssql/oracle config objects, pg PoolConfig extras) |
| `max` | `number?` | Pool size where the engine pools (default 10) |
| `dialect` | `Dialect?` | Override — rarely needed |

Scheme detection: `postgres://`·`postgresql://` → postgres; `mysql://`·`mariadb://` → mysql; `sqlite:`·`file:`·`:memory:`·`*.db`·`*.sqlite` → sqlite; `mssql://`·`sqlserver://` → mssql; `oracle://`·`oracledb://` → oracle. Anything else: pass `{ engine }` explicitly or `UnsupportedEngineException` is thrown.

```ts
const pg     = new SqlClient({ connectionString: 'postgres://user:pass@localhost:5432/mydb' });
const sqlite = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });
const mssql  = new SqlClient({
  engine: 'mssql',
  connection: { server: 'localhost', port: 1433, user: 'sa', password: 'Secret!1',
                database: 'mydb', options: { trustServerCertificate: true } },
});
```

Always `await client.end()` when done (closes the pool; lets test processes exit).

## Raw queries

```ts
const res = await client.query<MyRow>('SELECT * FROM books WHERE genre = $1', ['Fiction']);
// res: { rows: T[], rowCount: number, fields: { name, dataTypeID }[] }
await client.execute('UPDATE books SET stock = 0 WHERE book_id = $1', ['b1']);
```

**Placeholder style in raw SQL is engine-native — you must match the engine:**

| Engine | Style | Example |
|---|---|---|
| postgres | `$1, $2` | `WHERE id = $1` |
| mysql | `?` | `WHERE id = ?` |
| sqlite | `?` | `WHERE id = ?` |
| mssql | `@p1, @p2` | `WHERE id = @p1` (params bind as p1..pN in array order) |
| oracle | `:1, :2` | `WHERE id = :1` |

Portable code should use the QueryBuilder, which normalizes `?` markers for every engine.

## QueryBuilder

```ts
import { QueryBuilder } from '@civitas-cerebrum/sql-client';
```

Entry points: `QueryBuilder.select(table)` / `.insert(table)` / `.update(table)` / `.delete(table)`.
Chainable: `columns(...cols)`, `join(table, onClause)`, `where(clause, ...params)`, `groupBy(...cols)`, `having(clause, ...params)`, `orderBy(col, 'asc'|'desc')`, `limit(n)`, `offset(n)`, `values(row | row[])`, `set(row)`, `returning(...cols)`.
Terminal: `.toSql(dialect?)` → `{ text, values }` (defaults to PostgresDialect), or `.run(client)` → `Promise<SqlResult<T>>`.

- `where`/`having` clauses use `?` markers; the builder renders the engine-correct placeholder. Multiple `where()` calls are ANDed.
- Plain column names are quoted per dialect; expressions/aliases (anything with parens, spaces, or `AS`) pass through raw. Dotted names quote per segment.
- Pagination compiles per engine (`LIMIT/OFFSET` vs `OFFSET..FETCH`). **mssql/oracle require `orderBy()` when paginating.**
- Multi-row insert: `values()` accepts an array or repeated calls; all rows must have the same columns.

```ts
const top = await QueryBuilder.select('books')
  .columns('title', 'price')
  .where('price < ?', 15)
  .orderBy('price', 'desc')
  .limit(5)
  .run(client);

await QueryBuilder.insert('books')
  .values([{ book_id: 'b1', title: 'Dune' }, { book_id: 'b2', title: '1984' }])
  .run(client);
```

`.run(client)` dispatches SELECT (and any write with `returning()`) through `client.query`, other writes through `client.execute`.

## Returning rows from writes

`returning(...cols)` makes INSERT/UPDATE/DELETE hand rows back (no args → all columns):

```ts
const ins = await QueryBuilder.insert('books')
  .values({ title: 'Dune' })
  .returning('book_id', 'title')
  .run(client);
const id = rows(ins).one().string('book_id');
```

| Engine | Mechanism | Supported |
|---|---|---|
| postgres | `RETURNING …` | ✅ |
| sqlite | `RETURNING …` | ✅ |
| mssql | `OUTPUT INSERTED.…` / `OUTPUT DELETED.…` | ✅ |
| mysql | — | ❌ throws `UnsupportedEngineException` at `toSql()` time |
| oracle | — (RETURNING INTO needs out-binds) | ❌ throws `UnsupportedEngineException` at `toSql()` time |

Portable pattern for mysql/oracle: insert with an explicit ID, then SELECT it back.

## Reading results

Never index into raw rows in portable code — Oracle returns UPPERCASE keys and pg/mysql return NUMERIC/DECIMAL as strings. The accessors normalize both.

```ts
import { rows } from '@civitas-cerebrum/sql-client';

const rs = rows(await client.query('SELECT * FROM books'));   // also accepts a raw rows array
```

`ResultSet`: `length`, `rowCount`, `isEmpty()`, `at(i)`, `first()`, `one()` (exactly 1 row or `ResultError`), `maybeOne()` (0..1 or `ResultError`), `scalar(column?)` (first cell of first row), `column(name)`, `find(partial | predicate)`, `where(partial | predicate)`, `map(fn)`, `all()`, `raw()`.

`Row`: `get(col)`, `string(col)`, `number(col)`, `boolean(col)` (normalizes `1/0`, `'t'/'f'`, `'true'/'false'`), `has(col)`, `raw()`. All case-insensitive.

Semantics: absent column → `undefined`; SQL NULL → `null`; otherwise coerced to the requested type.

Standalone equivalents for raw rows: `getValue`, `getString`, `getNumber`, `getBoolean`, `getColumn`, `findRow`, `filterRows`, `getScalar`.

## Matchers

`where`/`find` partials accept literals or matchers; or pass a full-row predicate:

```ts
import { rows, lt, oneOf, contains } from '@civitas-cerebrum/sql-client';

rs.where({ genre: 'Fiction', price: lt(10) });
rs.find({ title: contains('1984') });
rs.where((row) => row.number('price')! < 10);
```

Available: `eq ne lt lte gt gte between oneOf like contains startsWith endsWith matches isNull notNull not`.
A null/undefined cell only matches `isNull()`; comparison/string matchers return `false` for it.

## Transactions

```ts
await client.transaction(async (tx) => {
  await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['b1']);
  await tx.query('SELECT ...');          // same placeholder rules as the client
});                                       // COMMIT on return, ROLLBACK on throw
```

The callback's `tx` has `query`/`execute` only — don't call the outer client inside a transaction.

## Exceptions

All extend `SqlException` (which extends `Error`):

| Class | When | Extras |
|---|---|---|
| `QueryFailedException` | A query/execute failed | `.sql`, `.params`, `.cause` (driver error) |
| `UnsupportedEngineException` | Unknown engine, missing native driver, or unsupported `returning()` | — |
| `ResultError` | `one()`/`maybeOne()` cardinality violated | — |

## Testing patterns

- **Zero-infra unit/integration tests**: `new SqlClient({ engine: 'sqlite', connectionString: ':memory:' })` — create schema, seed, assert. No Docker, no async driver quirks.
- **Verify app behavior**: after a UI/API action, `rows(await client.query(...)).one()` to assert the database state; `maybeOne()` to assert absence (`isEmpty()` on a filtered set also works).
- **Seed + cleanup**: insert temp rows with unique IDs inside `try`, delete in `finally` — keeps tests rerunnable. On mssql remember UNIQUE columns treat two NULLs as duplicates.
- **Engine-portable assertions**: always go through `rows()`/`Row` accessors (case + coercion) and the QueryBuilder (placeholders + pagination) instead of raw SQL strings, unless the test is engine-specific.
- **Debug logging**: `DEBUG=sql:*` prints every SQL statement with params (`sql:pg`, `sql:mysql`, `sql:sqlite`, `sql:mssql`, `sql:oracle`).

## Extending

`registerEngineFactory(engine, factory)` swaps in a custom `{ createDriver(config), createDialect() }` pair; `detectEngine(connectionString)` is exported too. Custom dialects implement `placeholder`, `quoteIdentifier`, `compilePagination`, `compileReturning`.
