---
name: sql-client
description: >
  Use this skill whenever the user wants to query a SQL database, seed or verify test data in
  Postgres/MySQL/SQLite/SQL Server/Oracle, or wire database checks into tests in a TypeScript
  project that has @civitas-cerebrum/sql-client installed. Triggers on: "sql-client",
  "@civitas-cerebrum/sql-client", "SqlClient", "QueryBuilder", "ResultSet", `rows(...)` over a
  query result, "QueryFailedException", "UnsupportedEngineException", "sql tagged template",
  "whereIn", "runScript", "splitSqlScript", or any request to write/fix/explain code built on this
  package. Also triggers on general intents — "query the database", "check the row exists",
  "seed test data", "run SQL in a test", "connect to postgres/mysql/sqlite/mssql/oracle",
  "verify the database state after this action" — when the
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
| Connect to a database | [§ Connecting](#connecting) — engine detection, per-engine config, `ping` |
| Run raw SQL | [§ Raw queries](#raw-queries) — placeholder style differs per engine; the `sql` tag |
| Load a `.sql` schema/seed file | [§ Multi-statement scripts](#multi-statement-scripts) — `runScript`/`splitSqlScript` |
| Build a query fluently | [§ QueryBuilder](#querybuilder) — `?` markers normalized per engine; `whereIn`, terminals |
| Get generated IDs / rows back from a write | [§ Returning rows from writes](#returning-rows-from-writes) — per-engine support matrix |
| Read values out of result rows | [§ Reading results](#reading-results) — case/type pitfalls live here |
| Filter rows in memory | [§ Matchers](#matchers) |
| Wrap writes atomically | [§ Transactions](#transactions) |
| Handle failures | [§ Exceptions](#exceptions) |
| Use it in a test suite | [§ Testing patterns](#testing-patterns) |

---

## Install

All five engine drivers (`pg`, `mysql2`, `better-sqlite3`, `mssql`, `oracledb`) ship with the package as **optional dependencies** — one install, every engine:

```sh
npm install @civitas-cerebrum/sql-client
```

npm installs all five by default; a native driver that can't build on the platform is skipped without failing the install (that engine then errors only when used).

Specific engine(s) only — skip the bundle with `--omit=optional` and name the driver(s):

```sh
npm install @civitas-cerebrum/sql-client pg --omit=optional              # Postgres only
npm install @civitas-cerebrum/sql-client mysql2 better-sqlite3 --omit=optional  # MySQL + SQLite
```

Importing the package never loads a native driver; the driver is `require`d when the first client for that engine is constructed. A missing/unbuildable driver throws `UnsupportedEngineException` with an install hint.

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
| `connectTimeoutMs` | `number?` | Fail fast instead of hanging on an unreachable host (no implicit default) |
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
`await client.ping()` runs a cheap probe (`SELECT 1`, or `SELECT 1 FROM DUAL` on oracle) and throws if unreachable — use it in a test `globalSetup`.

## Raw queries

```ts
const res = await client.query<MyRow>('SELECT * FROM books WHERE genre = $1', ['Fiction']);
// res: { rows: T[], rowCount: number, fields: { name, dataTypeID }[] }
await client.execute('UPDATE books SET stock = 0 WHERE book_id = $1', ['b1']);
const book = (await client.fetch('SELECT * FROM books WHERE book_id = $1', ['b1'])).one();  // query()+rows()
```

**Placeholder style in raw SQL is engine-native — you must match the engine:**

| Engine | Style | Example |
|---|---|---|
| postgres | `$1, $2` | `WHERE id = $1` |
| mysql | `?` | `WHERE id = ?` |
| sqlite | `?` | `WHERE id = ?` |
| mssql | `@p1, @p2` | `WHERE id = @p1` (params bind as p1..pN in array order) |
| oracle | `:1, :2` | `WHERE id = :1` |

For portable raw SQL, use the `sql` tag (or the QueryBuilder). Both normalize placeholders for every engine.

### `sql` tagged template

```ts
import { sql } from '@civitas-cerebrum/sql-client';

await client.query(sql`SELECT * FROM books WHERE genre = ${genre} AND price < ${max}`);
// interpolations → bind params in the engine's placeholder style; SQL injection-safe.
await client.query(sql`SELECT ${sql.id('title')} FROM books ${sql`WHERE in_stock = ${true}`}`);
```

Rules: a plain `${value}` becomes a bind parameter; `sql.id(name)` splices a dialect-quoted identifier (never a param, dotted names quoted per segment); a nested `SqlFragment` composes inline with placeholder numbering threaded through. `SqlClient.query`/`execute` accept a fragment directly. (Transaction handles take strings only for now — render via the builder or raw SQL inside a tx.)

## Multi-statement scripts

Engine drivers run one statement per call. To load a `.sql` schema/seed file:

```ts
await client.runScript(readFileSync('schema.sql', 'utf8'));   // splits per engine, executes in order
import { splitSqlScript } from '@civitas-cerebrum/sql-client';
const statements = splitSqlScript(sqlText, 'oracle');         // standalone splitter
```

`splitSqlScript` is comment- and quote-aware and handles engine extras: Oracle's `/` terminator and `BEGIN..END` bodies, SQL Server's `GO`. Known limits: no `$$` dollar-quoting, no nested block comments.

## QueryBuilder

```ts
import { QueryBuilder } from '@civitas-cerebrum/sql-client';
```

Entry points: `QueryBuilder.select(table)` / `.insert(table)` / `.update(table)` / `.delete(table)`.
Chainable: `columns(...cols)`, `join(table, onClause)`, `where(clause, ...params)`, `whereIn(col, values)`, `whereNull(col)`, `whereNotNull(col)`, `groupBy(...cols)`, `having(clause, ...params)`, `orderBy(col, 'asc'|'desc')`, `limit(n)`, `offset(n)`, `values(row | row[])`, `set(row)`, `returning(...cols)`.
Terminals: `.toSql(dialect)` → `{ text, values }` (**dialect is required** — no default), `.run(client)` → `Promise<SqlResult<T>>`, plus result-shaping terminals that dispatch through a client: `.fetch(client)` → `ResultSet`, `.one(client)` → `Row` (else `ResultError`), `.maybeOne(client)` → `Row | undefined`, `.scalar(client, col?)`, `.count(client)` → `number`, `.exists(client)` → `boolean`.

- `where`/`having` clauses use `?` markers; the builder renders the engine-correct placeholder. Multiple `where*()` calls are ANDed in order.
- `whereIn(col, values)` expands one placeholder per value and **throws on an empty array** (never compiles `IN ()`). `whereNull`/`whereNotNull` render `IS [NOT] NULL` — use them instead of `where('col = ?', null)`, which compiles to `col = NULL` and silently matches nothing.
- OR-grouping: no dedicated method — put it in one fragment, `where('(genre = ? OR genre = ?)', a, b)`.
- `count()`/`exists()` reject if `join`/`groupBy`/`having` are set (ambiguous) — use a raw query there.
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

`ResultSet<T>`: `length`, `rowCount`, `isEmpty()`, `at(i)`, `first()`, `one()` (exactly 1 row or `ResultError`), `maybeOne()` (0..1 or `ResultError`), `scalar(column?)` (first cell of first row), `column(name)`, `find(partial | predicate)` → `Row | undefined`, `where(partial | predicate)` → **chainable `ResultSet`** (so `rows(res).where({genre:'Fiction'}).one()` / `.column('title')` / `.isEmpty()` compose), `map(fn)`, `all()` (→ `Row[]`), `raw()`.

`Row<T>`: `get(col)`, `string(col)`, `number(col)`, `boolean(col)` (normalizes `1/0`, `'t'/'f'`, `'true'/'false'`), `has(col)`, `raw()`. All case-insensitive. With a row type `T` (e.g. `client.query<Book>(...)`), column names autocomplete while arbitrary strings remain legal for Oracle UPPERCASE access.

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
`eq`/`ne`/`oneOf` and literal partials compare **numerically** when both sides are numeric, so `find({ price: 6.5 })` matches a `"6.50"` cell from postgres/mysql.

## Transactions

```ts
await client.transaction(async (tx) => {
  await QueryBuilder.update('books').set({ stock: 0 }).where('book_id = ?', 'b1').run(tx);  // builder works inside tx
  await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['b2']);
});                                       // COMMIT on return, ROLLBACK on throw
```

The `tx` handle has `query`/`execute` **plus** `dialect`/`engine`, so `QueryBuilder.run(tx)` works inside a transaction. Don't call the outer client inside the callback (use `tx`). `sql`-fragment overloads are client-only for now — inside a tx use the builder or raw SQL via `tx.query`.

## Exceptions

All extend `SqlException` (which extends `Error`):

| Class | When | Extras |
|---|---|---|
| `QueryFailedException` | A query/execute failed | message embeds the SQL + params (+ a hint when the placeholder style doesn't match the engine); `.sql`, `.params`, `.cause` (driver error) |
| `UnsupportedEngineException` | Unknown engine, missing native driver, or unsupported `returning()` | — |
| `ResultError` | `one()`/`maybeOne()` cardinality violated, or a failed cell coercion | — |

An installed driver that fails to *load* (e.g. native ABI mismatch) surfaces the original error, not a misleading "install the driver" message.

## Testing patterns

- **Zero-infra unit/integration tests**: `new SqlClient({ engine: 'sqlite', connectionString: ':memory:' })` — `runScript()` to load schema/seed, then assert. No Docker, no async driver quirks. `Date`/`boolean` params are normalized automatically on sqlite (no manual shimming).
- **Verify app behavior**: after a UI/API action, `await QueryBuilder.select('orders').where('user_id = ?', id).one(client)` (or `client.fetch(sql, params)`) to assert state; `maybeOne()`/`exists()`/`count()` for absence/presence.
- **Seed + cleanup**: insert temp rows with unique IDs inside `try`, delete in `finally` — keeps tests rerunnable. On mssql remember UNIQUE columns treat two NULLs as duplicates (use distinct sentinels).
- **Fail fast**: `await client.ping()` in `globalSetup` (and/or `connectTimeoutMs`) so an unreachable DB errors clearly instead of hanging the first query.
- **Engine-portable assertions**: go through `rows()`/`Row` accessors (case + coercion) and the QueryBuilder or `sql` tag (placeholders + pagination) instead of raw SQL strings, unless the test is engine-specific.
- **Debug logging**: `DEBUG=sql:*` prints every statement with params, including inside transactions plus begin/commit/rollback (`sql:postgres`, `sql:mysql`, `sql:sqlite`, `sql:mssql`, `sql:oracle`).

## Extending

`registerEngineFactory(engine, factory)` swaps in a custom `{ createDriver(config), createDialect() }` pair; `detectEngine(connectionString)` is exported too. Custom dialects implement `placeholder`, `quoteIdentifier`, `compilePagination`, `compileReturning`. `createLogger(ns)`/`log` (type `SqlLogger`) write under the `sql:*` debug namespace.

The package ships this skill via a postinstall copy into `.claude/skills/`; set `SQL_CLIENT_SKIP_SKILLS=1` before `npm install` to skip it (CI/containers).
