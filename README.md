# @civitas-cerebrum/sql-client

A lightweight Postgres client with a fluent query builder, typed results, and always-parametrised
queries. Sibling to `@civitas-cerebrum/wasapi` (HTTP); together they back the Steps API in
`@civitas-cerebrum/element-interactions`.

## Install

    npm install @civitas-cerebrum/sql-client pg

## Usage

```ts
import { SqlClient, QueryBuilder } from '@civitas-cerebrum/sql-client';

const db = new SqlClient({ connectionString: process.env.DB_URL! });

// Raw, parametrised
const { rows } = await db.query('SELECT * FROM books WHERE genre = $1', ['Fiction']);

// Fluent builder (compiles to parametrised SQL)
const top = await QueryBuilder.select('books')
  .columns('title', 'price')
  .where('price < ?', 15)
  .orderBy('price', 'desc')
  .limit(5)
  .run(db);

// Transaction (auto-ROLLBACK on throw)
await db.transaction(async (tx) => {
  await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-001']);
});

await db.end();
```

## Testing

    npm run db:up && npm test && npm run db:down

Debug logging: `DEBUG=sql:* npm test`.
