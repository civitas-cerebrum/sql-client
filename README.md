# @civitas-cerebrum/sql-client

A lightweight **multi-engine** SQL client (PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, Oracle)
with a fluent query builder, typed results, and always-parametrised queries. Sibling to
`@civitas-cerebrum/wasapi` (HTTP); together they back the Steps API in
`@civitas-cerebrum/element-interactions`.

## Supported Engines

| Engine              | Connection-string scheme(s)                        | Optional peer dep   |
|---------------------|----------------------------------------------------|---------------------|
| **PostgreSQL**      | `postgres://` · `postgresql://`                    | `pg`                |
| **MySQL / MariaDB** | `mysql://` · `mariadb://`                          | `mysql2`            |
| **SQLite**          | `sqlite:` · `sqlite::memory:` · `file:` · `:memory:` · `*.db` · `*.sqlite` | `better-sqlite3` |
| **SQL Server**      | `mssql://` · `sqlserver://`                        | `mssql`             |
| **Oracle**          | `oracle://` · `oracledb://`                        | `oracledb`          |

## Install

Install the package **plus the driver for your engine** (all drivers are optional peer deps):

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

## Usage

```ts
import { SqlClient, QueryBuilder } from '@civitas-cerebrum/sql-client';

// --- PostgreSQL (engine auto-detected from the URL scheme) ---
const pg = new SqlClient({ connectionString: 'postgres://user:pass@localhost:5432/mydb' });

// --- MySQL ---
const mysql = new SqlClient({ connectionString: 'mysql://user:pass@localhost:3306/mydb' });

// --- SQLite (in-memory, zero infra) ---
const sqlite = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });

// --- SQL Server ---
const mssql = new SqlClient({
  engine: 'mssql',
  connection: { server: 'localhost', port: 1433, user: 'sa', password: 'Secret!1',
                database: 'mydb', options: { trustServerCertificate: true } },
});

// --- Oracle ---
const oracle = new SqlClient({ connectionString: 'oracle://user:pass@localhost:1521/FREEPDB1' });

// Raw parametrised query (placeholder style is engine-correct automatically)
const { rows } = await pg.query('SELECT * FROM books WHERE genre = $1', ['Fiction']);

// Fluent builder (compiles to correct pagination per engine)
const top = await QueryBuilder.select('books')
  .columns('title', 'price')
  .where('price < ?', 15)
  .orderBy('price', 'desc')
  .limit(5)
  .run(pg);

// Transaction (auto-ROLLBACK on throw)
await pg.transaction(async (tx) => {
  await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-001']);
});

await pg.end();
```

## Test workflow

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

Debug logging: `DEBUG=sql:* npm test`.
