# Multi-Engine SQL Client

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/sql-client?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/sql-client)

A lightweight **multi-engine** SQL client for querying and test automation — one API across **PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, and Oracle**, with a fluent query builder, typed results, and always-parametrised queries.

This package is the **data layer**: a programmatic SQL facade for humans + LLM agents to write against. It is the sibling of [`@civitas-cerebrum/wasapi`](https://www.npmjs.com/package/@civitas-cerebrum/wasapi) (HTTP); together they back the Steps API in [`@civitas-cerebrum/element-interactions`](https://www.npmjs.com/package/@civitas-cerebrum/element-interactions). If you are writing E2E test specs through that framework, use its `steps.sql*` wrappers — this package is what powers them, and what you reach for in fixtures, seed scripts, harness internals, and standalone tools.

---

## 🏗️ One API, Five Engines

Every database driver has its own connection ritual, placeholder style, and result shape. Multi-engine code normally means five code paths.

**Before (raw drivers):**

```ts
// pg: Pool, $1 placeholders
const pool = new Pool({ connectionString });
const res = await pool.query('SELECT * FROM books WHERE genre = $1', ['Fiction']);

// mysql2: createPool, ? placeholders, [rows, fields] tuples
const [rows] = await mysqlPool.query('SELECT * FROM books WHERE genre = ?', ['Fiction']);

// mssql: request objects with named .input() bindings
const r = await pool.request().input('p1', 'Fiction')
  .query('SELECT * FROM books WHERE genre = @p1');

// oracledb: outFormat option, UPPERCASE column keys, manual connection release
const conn = await pool.getConnection();
const result = await conn.execute('SELECT * FROM books WHERE genre = :1', ['Fiction'],
  { outFormat: oracledb.OUT_FORMAT_OBJECT });
await conn.close();
```

**After (@civitas-cerebrum/sql-client):**

```ts
// Same client, same call, any engine — detected from the connection string.
const db = new SqlClient({ connectionString: process.env.DB_URL! });
const res = await db.query('SELECT * FROM books WHERE genre = $1', ['Fiction']);

// Or fully portable: the builder renders engine-correct placeholders,
// quoting, and pagination from one chain.
const top = await QueryBuilder.select('books')
  .where('genre = ?', 'Fiction')
  .orderBy('price', 'desc')
  .limit(5)
  .run(db);
```

---

## 📦 Installation

Install the package **plus the driver for your engine** (all drivers are optional peer deps — importing the package never loads one):

```sh
# PostgreSQL
npm install @civitas-cerebrum/sql-client pg

# MySQL / MariaDB
npm install @civitas-cerebrum/sql-client mysql2

# SQLite (zero infrastructure)
npm install @civitas-cerebrum/sql-client better-sqlite3

# SQL Server
npm install @civitas-cerebrum/sql-client mssql

# Oracle (Thin mode — no Instant Client needed)
npm install @civitas-cerebrum/sql-client oracledb
```

**Requirements:** Node.js ≥ 20.

| Engine              | Connection-string scheme(s)                        | Driver            | Placeholders | `returning()` |
|---------------------|----------------------------------------------------|-------------------|--------------|---------------|
| **PostgreSQL**      | `postgres://` · `postgresql://`                    | `pg`              | `$1`         | ✅ `RETURNING` |
| **MySQL / MariaDB** | `mysql://` · `mariadb://`                          | `mysql2`          | `?`          | ❌            |
| **SQLite**          | `sqlite:` · `sqlite::memory:` · `file:` · `:memory:` · `*.db` · `*.sqlite` | `better-sqlite3` | `?` | ✅ `RETURNING` |
| **SQL Server**      | `mssql://` · `sqlserver://`                        | `mssql`           | `@p1`        | ✅ `OUTPUT`   |
| **Oracle**          | `oracle://` · `oracledb://`                        | `oracledb`        | `:1`         | ❌            |

---

## 🚀 Quick Start

Zero infrastructure — an in-memory SQLite database, no Docker, no server. Copy-paste and run:

```ts
import { SqlClient, QueryBuilder } from '@civitas-cerebrum/sql-client';

const db = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });

// Create a table (runScript splits a multi-statement script per engine)
await db.runScript(`
  CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, price REAL, in_stock INTEGER);
`);

// Insert (multi-row in one statement)
await QueryBuilder.insert('books')
  .values([
    { title: 'Dune', price: 12.99, in_stock: true },
    { title: '1984', price: 9.5,  in_stock: false },
  ])
  .run(db);

// Read straight into a typed, coercing ResultSet
const cheap = await QueryBuilder.select('books').where('price < ?', 10).fetch(db);
console.log(cheap.column('title'));            // ['1984']

const dune = await db.fetch('SELECT * FROM books WHERE title = ?', ['Dune']);
console.log(dune.one().number('price'));       // 12.99
console.log(dune.one().boolean('in_stock'));   // true  (1 → true)

await db.end();
```

---

## ✨ Features

* **Engine auto-detection** — The engine is inferred from the connection-string scheme; pass `{ engine }` explicitly only when there's no scheme to read.
* **Lazy driver loading** — Native drivers are `require`d on first client construction, never at import. A missing driver throws `UnsupportedEngineException` with an install hint.
* **Always parametrised** — Raw calls take a params array; the builder takes `?` markers and renders the engine-correct placeholder style. No string interpolation anywhere.
* **`sql` tagged template** — `` sql`... ${value}` `` interpolates safely as bind parameters and compiles to the right placeholder style per engine; `sql.id()` for identifiers, fragments nest.
* **Fluent query builder** — `select`/`insert`/`update`/`delete` chains with engine-correct identifier quoting and pagination (`LIMIT/OFFSET` vs `OFFSET..FETCH`), plus `whereIn`/`whereNull`/`whereNotNull` and `count()`/`exists()` terminals.
* **One-call reads** — `fetch`/`one`/`maybeOne`/`scalar` land straight on a `ResultSet`/`Row` from either the client or a builder chain — no manual `rows()` wrap.
* **Multi-row INSERT** — `values()` accepts an array (or repeated calls) and compiles a single multi-row statement.
* **Row-returning writes** — `returning(...cols)` compiles `RETURNING` (postgres/sqlite) or `OUTPUT INSERTED./DELETED.` (mssql); engines without an equivalent reject at compile time with a clear error.
* **Typed, normalized results** — Every engine's result is reshaped into `{ rows, rowCount, fields }`, generic over the row type; `Row<T>` gives column-name autocomplete while still allowing case-insensitive lookups.
* **Case-insensitive, type-coercing accessors** — `rows(res).one().number('price')` works whether the engine returned `PRICE` (Oracle) or `"12.99"` as a string (postgres/mysql NUMERIC). Matchers compare numerically too, so `find({ price: 6.5 })` matches a `"6.50"` cell.
* **In-memory row matchers** — `where`/`find` accept literals, matchers (`lt`, `oneOf`, `contains`, …), or a full-row predicate; `where()` returns a chainable `ResultSet`.
* **Transactions** — `transaction(fn)` with automatic `COMMIT` on return and `ROLLBACK` on throw, on all five engines; the builder runs inside them (`qb.run(tx)`).
* **Script runner** — `runScript()` / `splitSqlScript()` split a multi-statement `.sql` file with engine-aware rules (Oracle `/`, SQL Server `GO`, comment/quote aware).
* **Fail-fast connectivity** — `ping()` for readiness checks and a `connectTimeoutMs` option so a wrong host dies fast instead of hanging.
* **Typed failures** — `QueryFailedException` shows the SQL + params in the message and carries `.sql`, `.params`, and the driver `.cause`; placeholder-style mistakes get a cross-engine hint.
* **Pluggable engines** — `registerEngineFactory()` swaps in a custom driver + dialect pair.
* **Debug logging** — `DEBUG=sql:*` prints every statement (including inside transactions) with params, namespaced per engine (`sql:postgres`, `sql:mysql`, …).

---

## 💻 Usage: `SqlClient`

```ts
import { SqlClient } from '@civitas-cerebrum/sql-client';

// --- PostgreSQL (engine auto-detected from the URL scheme) ---
const pg = new SqlClient({ connectionString: 'postgres://user:pass@localhost:5432/mydb' });

// --- MySQL ---
const mysql = new SqlClient({ connectionString: 'mysql://user:pass@localhost:3306/mydb' });

// --- SQLite (in-memory, zero infra) ---
const sqlite = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });

// --- SQL Server (engine-native connection object) ---
const mssql = new SqlClient({
  engine: 'mssql',
  connection: { server: 'localhost', port: 1433, user: 'sa', password: 'Secret!1',
                database: 'mydb', options: { trustServerCertificate: true } },
});

// --- Oracle ---
const oracle = new SqlClient({ connectionString: 'oracle://user:pass@localhost:1521/FREEPDB1' });
```

A connection can fail fast instead of hanging on a wrong host — pass `connectTimeoutMs` in the
config, and use `ping()` (e.g. in a test `globalSetup`) to verify reachability up front:

```ts
const db = new SqlClient({ connectionString: process.env.DB_URL!, connectTimeoutMs: 5000 });
await db.ping();   // throws if the engine is unreachable
```

### Raw queries

Placeholders in raw SQL are **engine-native** (`$1` / `?` / `@p1` / `:1` — see the table above):

```ts
const { rows } = await pg.query('SELECT * FROM books WHERE genre = $1', ['Fiction']);
await pg.execute('UPDATE books SET stock = 0 WHERE book_id = $1', ['b1']);

// fetch() wraps the result in a ResultSet in one step
const book = (await pg.fetch('SELECT * FROM books WHERE book_id = $1', ['b1'])).one();
```

### `sql` tagged template

Prefer the `sql` tag for portable raw SQL: interpolations become bind parameters in the
engine-correct placeholder style, so the same query runs everywhere. Use `sql.id()` for
identifiers (quoted per dialect, never parameterised), and nest fragments to compose:

```ts
import { sql } from '@civitas-cerebrum/sql-client';

const genre = 'Fiction', max = 15;
await db.query(sql`SELECT * FROM books WHERE genre = ${genre} AND price < ${max}`);
// postgres → "... WHERE genre = $1 AND price < $2"; mysql → "... = ? AND < ?"; etc.

const onlyCheap = sql`AND price < ${10}`;
await db.query(sql`SELECT ${sql.id('title')} FROM books WHERE in_stock = ${true} ${onlyCheap}`);
```

### Transactions

`transaction(fn)` commits on return and rolls back on throw. The handle carries the dialect, so
`QueryBuilder.run(tx)` works inside it (the `sql` tag is client-only — inside a tx use the builder
or raw SQL via `tx.query`):

```ts
await pg.transaction(async (tx) => {
  await QueryBuilder.update('books').set({ stock: 0 }).where('book_id = ?', 'b1').run(tx);
  await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-002']);
  // throw → automatic ROLLBACK; return → automatic COMMIT
});
```

Always close the client when done:

```ts
await pg.end();
```

---

## 🧱 Query Builder

Portable SQL from one chain — `?` markers, quoting, and pagination all compile per engine:

```ts
import { QueryBuilder } from '@civitas-cerebrum/sql-client';

const top = await QueryBuilder.select('books')
  .columns('title', 'price')
  .where('price < ?', 15)
  .orderBy('price', 'desc')
  .limit(5)
  .run(pg);

// Multi-row INSERT — values() takes an array (or repeated calls)
await QueryBuilder.insert('books')
  .values([
    { book_id: 'b1', title: 'Dune' },
    { book_id: 'b2', title: '1984' },
  ])
  .run(pg);

// Writes can hand rows back: RETURNING (postgres/sqlite) or OUTPUT (mssql).
// mysql/oracle have no equivalent — returning() throws UnsupportedEngineException there.
const ins = await QueryBuilder.insert('books')
  .values({ title: 'Dune' })
  .returning('book_id', 'title')   // no args → all columns
  .run(pg);

// whereIn expands one placeholder per value (throws on an empty array, so you never compile
// `IN ()`); whereNull/whereNotNull avoid the `= NULL` footgun that silently matches nothing.
const some = await QueryBuilder.select('books')
  .whereIn('book_id', ['b1', 'b2', 'b3'])
  .whereNotNull('isbn')
  .fetch(pg);

// Inspect without executing — toSql() requires an explicit dialect
const { text, values } = QueryBuilder.select('books').where('price < ?', 15).toSql(pg.dialect);
```

**Terminals** dispatch the query through a client and shape the result in one call:

```ts
await QueryBuilder.select('books').where('book_id = ?', 'b1').one(pg);        // Row (else ResultError)
await QueryBuilder.select('books').where('genre = ?', 'Fiction').fetch(pg);   // ResultSet
await QueryBuilder.select('books').where('book_id = ?', 'b1').maybeOne(pg);   // Row | undefined
await QueryBuilder.select('books').scalar(pg, 'title');                       // first cell
await QueryBuilder.select('books').where('price < ?', 10).count(pg);          // number
await QueryBuilder.select('books').where('book_id = ?', 'b1').exists(pg);     // boolean
```

Chainable: `columns(...cols)` · `join(table, on)` · `where(clause, ...params)` (multiple calls are ANDed) · `whereIn(col, values)` · `whereNull(col)` · `whereNotNull(col)` · `groupBy(...cols)` · `having(clause, ...params)` · `orderBy(col, dir)` · `limit(n)` · `offset(n)` · `values(row | row[])` · `set(row)` · `returning(...cols)`.
Terminals: `run(client)` · `fetch(client)` · `one(client)` · `maybeOne(client)` · `scalar(client, col?)` · `count(client)` · `exists(client)` · `toSql(dialect)`.

> **Note:** SQL Server and Oracle require `orderBy()` when paginating (`OFFSET..FETCH` needs it).
> Need OR-grouping? Put it in one fragment: `where('(genre = ? OR genre = ?)', a, b)`.

---

## 📖 Reading Results

Pull values out of rows by name — **case-insensitive** (Oracle returns UPPERCASE keys) and **type-coercing** (postgres/mysql return NUMERIC/DECIMAL as strings):

```ts
import { rows, getNumber } from '@civitas-cerebrum/sql-client';

const res = await db.query('SELECT * FROM books WHERE book_id = $1', ['book-001']);

// Fluent wrapper
const book = rows(res).one();                 // exactly one row, else throws ResultError
book.string('title');                         // 'To Kill a Mockingbird'
book.number('price');                         // 12.99
book.boolean('in_stock');                     // normalizes 1/0, 't'/'f', 'true'/'false'

rows(await db.query('SELECT count(*) FROM books')).scalar();   // first cell of first row
rows(res).column('title');                    // every title
rows(res).find({ genre: 'Fiction' });         // first matching row, or undefined
rows(res).maybeOne();                         // 0..1 rows, else throws ResultError

// Or standalone functions on a raw row
getNumber(res.rows[0], 'price');              // 12.99
```

Semantics: absent column → `undefined`; SQL NULL → `null`; otherwise coerced.

### Filtering rows

`where`/`find` accept a partial (column → literal **or** matcher) or a full-row predicate:

```ts
import { rows, lt, oneOf, contains } from '@civitas-cerebrum/sql-client';

const res = await db.query('SELECT * FROM books');
rows(res).where({ genre: 'Fiction', price: lt(10) });        // matchers
rows(res).find({ title: contains('1984') });
rows(res).where(row => row.number('price')! < 10);           // predicate

// where() returns a ResultSet, so filtering keeps chaining:
rows(res).where({ genre: 'Fiction' }).column('title');
rows(res).where({ book_id: 'b1' }).one();
if (rows(res).where({ status: 'SOLD' }).isEmpty()) { /* none sold */ }
rows(res).where({ genre: 'Fiction' }).all().forEach(r => { /* Row[] */ });

// standalone, on raw rows
import { filterRows } from '@civitas-cerebrum/sql-client';
filterRows(res.rows, { status: oneOf(['ACTIVE', 'SOLD']) });
```

Matchers: `eq ne lt lte gt gte between oneOf like contains startsWith endsWith matches isNull notNull not`.
A null/undefined cell only matches `isNull()`; comparison/string matchers return `false` for it. Equality
matchers (`eq`/`ne`/`oneOf`) and literal partials compare numerically when both sides are numeric, so a
`6.5` query matches a `"6.50"` cell returned by postgres/mysql.

---

## 🛠️ API Reference

### 🔌 `SqlClient`

| Member | Description |
|---|---|
| `new SqlClient(config)` | `config`: `{ connectionString?, engine?, connection?, max?, connectTimeoutMs?, dialect? }` |
| `query<T>(sql, params?)` / `query<T>(fragment)` | Parametrised query (string or `sql` fragment) → `Promise<SqlResult<T>>` |
| `execute(sql, params?)` / `execute(fragment)` | Write statement → `Promise<SqlResult>` (rowCount of affected rows) |
| `fetch<T>(sql, params?)` | `query()` then `rows()` → `Promise<ResultSet<T>>` |
| `transaction(fn)` | Atomic block; `fn(tx)` gets `tx.query`/`tx.execute` **plus** `tx.dialect`/`tx.engine`, so `QueryBuilder.run(tx)` works |
| `runScript(sqlText)` | Split a multi-statement script (engine-aware) and execute each in order |
| `ping()` | Cheap connectivity probe; throws if the engine is unreachable |
| `end()` | Close the pool/connection |
| `engine` / `dialect` | The resolved engine name and dialect instance |

### 📊 `SqlResult<T>`

`{ rows: T[], rowCount: number, fields: { name, dataTypeID }[] }` — the normalized shape every engine produces.

### 📖 `ResultSet` / `Row`

| Member | Description |
|---|---|
| `rows<T>(result \| rawRows)` | Wrap a result (or raw array) in a `ResultSet<T>` |
| `.one()` / `.maybeOne()` | Exactly-one / at-most-one row, else `ResultError` |
| `.first()` / `.at(i)` | `Row` or `undefined` |
| `.scalar(column?)` | First cell of the first row |
| `.column(name)` | One column across all rows |
| `.find(where)` | First matching `Row` (partial of literals/matchers, or `(row) => boolean`) |
| `.where(where)` | Filter → chainable `ResultSet` (same partial/predicate forms) |
| `.map(fn)` / `.all()` / `.raw()` | Map over rows / wrap all as `Row[]` / unwrap to raw rows |
| `Row<T>.get/string/number/boolean(col)` | Case-insensitive, type-coercing cell access; `T` gives column-name autocomplete |
| `Row.has(col)` / `Row.raw()` | Presence check / underlying object |

### 🏷️ `sql` tag & scripts

| Export | Description |
|---|---|
| `` sql`...${v}` `` | Build a `SqlFragment`; interpolations → bind params, nested fragments compose |
| `sql.id(name)` | Interpolate an identifier (dialect-quoted, not parameterised) |
| `splitSqlScript(sqlText, engine?)` | Split a multi-statement script into individual statements (engine-aware) |

### ⚠️ Exceptions

| Class | Thrown when | Extras |
|---|---|---|
| `SqlException` | Base class for everything below | — |
| `QueryFailedException` | A query/execute fails | message includes SQL + params (+ placeholder hint); `.sql`, `.params`, `.cause` |
| `UnsupportedEngineException` | Unknown engine, missing driver, or unsupported `returning()` | — |
| `ResultError` | `one()`/`maybeOne()` cardinality or a failed coercion | — |

### 🧩 Extending

| Function | Description |
|---|---|
| `registerEngineFactory(engine, factory)` | Plug in a custom `{ createDriver, createDialect }` pair |
| `detectEngine(connectionString)` | The scheme-detection used by `SqlClient` |
| `Dialect` | Implement `placeholder`, `quoteIdentifier`, `compilePagination`, `compileReturning` |
| `createLogger(ns)` / `log` | `debug`-based logger (`SqlLogger`) under the `sql:*` namespace |

---

## 🧪 Test Workflow

```sh
# Light (unit + zero-infra SQLite) — no Docker needed
npm test

# Single engine (bring up just that engine's container)
docker compose --profile postgres up -d --wait && npm run test:postgres
docker compose --profile mysql    up -d --wait && npm run test:mysql
docker compose --profile mssql    up -d --wait && npm run test:mssql
docker compose --profile oracle   up -d --wait && npm run test:oracle

# Full matrix — all five live engines
docker compose --profile all up -d --wait
npm run test:all-engines
docker compose --profile all down -v
```

Host ports collide with something already running? Override them:
`SQL_CLIENT_PG_PORT`, `SQL_CLIENT_MYSQL_PORT`, `SQL_CLIENT_MSSQL_PORT`, `SQL_CLIENT_ORACLE_PORT`
(and point the test at it, e.g. `SQL_TEST_URL=postgres://bookhive:bookhive@localhost:15432/bookhive npm run test:postgres`).

Debug logging: `DEBUG=sql:* npm test` (per-engine namespaces `sql:postgres`, `sql:mysql`, `sql:sqlite`, `sql:mssql`, `sql:oracle`; covers transaction statements and lifecycle).

---

## ⚠️ Engine Pitfalls

Cross-engine differences the package absorbs for you — and the few it can't:

* **Placeholder style differs in raw SQL** — `$1` (postgres) · `?` (mysql/sqlite) · `@p1` (mssql) · `:1` (oracle). Use the builder or the `sql` tag for portable code; both render the right style.
* **Oracle returns UPPERCASE column keys** — `Row` accessors are case-insensitive, so `row.string('title')` works regardless. Only raw `res.rows[i].title` indexing is affected.
* **NUMERIC/DECIMAL arrive as strings** on postgres/mysql — `row.number()` coerces, and matchers compare numerically, so you rarely notice. Raw cell access does not coerce.
* **SQL Server `UNIQUE` treats NULLs as duplicates** — a second row with `NULL` in a `UNIQUE` column violates the constraint on mssql (unlike the other engines). Use distinct sentinel values in test fixtures.
* **SQL Server binds params by position** — `@p1..@pN` map to the params array in order; the builder and `sql` tag handle this automatically.
* **SQLite has no native Date/boolean** — the driver normalises `Date → ISO string`, `boolean → 1/0`, `undefined → null` on the way in, so the same fixture code works as on the other engines.

---

## 🧭 Non-Goals

Deliberately out of scope to stay lean and predictable. For these, reach for a dedicated tool:

* **ORM / relations / entity mapping** — this is a query client, not an ORM.
* **Migrations & schema management** — use your migration tool; `runScript()` only executes SQL you give it.
* **Streaming / cursors** for huge result sets — results are materialised arrays.
* **Named parameters** — positional only (the builder's `?` and the `sql` tag cover the ergonomic gap).
* **OR-grouped builder trees** — express OR inside a single `where()` fragment instead.
* **Upsert helpers** — write engine-specific `ON CONFLICT` / `MERGE` SQL directly for now.

---

## 🤖 Claude Code Skill

The package ships a [Claude Code](https://claude.com/claude-code) skill (`skills/sql-client/SKILL.md`)
that teaches the agent the full API surface. It installs automatically into `.claude/skills/`
(project + user level) on `npm install` — whether the package is installed directly or arrives
transitively through another `@civitas-cerebrum` package. In projects using the Steps-API test
frameworks, the skill defers test-spec database work to their `database-testing` skill.

To skip the copy — e.g. in CI or containers — set `SQL_CLIENT_SKIP_SKILLS=1` before installing.
