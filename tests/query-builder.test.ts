import assert from 'node:assert/strict';
import { QueryBuilder } from '../src/builder/QueryBuilder';
import { MssqlDialect, MySqlDialect, OracleDialect } from '../src/builder/Dialect';
import { UnsupportedEngineException } from '../src/exceptions/SqlException';

// simple select all
{
    const { text, values } = QueryBuilder.select('books').toSql();
    assert.equal(text, 'SELECT * FROM "books"');
    assert.deepEqual(values, []);
}

// columns + where (params get positional placeholders)
{
    const { text, values } = QueryBuilder.select('books')
        .columns('title', 'price')
        .where('genre = ?', 'Fiction')
        .toSql();
    assert.equal(text, 'SELECT "title", "price" FROM "books" WHERE genre = $1');
    assert.deepEqual(values, ['Fiction']);
}

// multiple where clauses are ANDed, placeholders increment
{
    const { text, values } = QueryBuilder.select('books')
        .where('genre = ?', 'Fiction')
        .where('price < ?', 15)
        .toSql();
    assert.equal(text, 'SELECT * FROM "books" WHERE genre = $1 AND price < $2');
    assert.deepEqual(values, ['Fiction', 15]);
}

// join + groupBy + having + orderBy + limit + offset
{
    const { text, values } = QueryBuilder.select('orders')
        .columns('books.genre', 'SUM(order_items.quantity) AS units')
        .join('order_items', 'order_items.order_id = orders.order_id')
        .join('books', 'books.book_id = order_items.book_id')
        .groupBy('books.genre')
        .having('SUM(order_items.quantity) > ?', 5)
        .orderBy('units', 'desc')
        .limit(3)
        .offset(1)
        .toSql();
    assert.equal(
        text,
        'SELECT "books"."genre", SUM(order_items.quantity) AS units FROM "orders"'
        + ' JOIN "order_items" ON order_items.order_id = orders.order_id'
        + ' JOIN "books" ON books.book_id = order_items.book_id'
        + ' GROUP BY "books"."genre" HAVING SUM(order_items.quantity) > $1'
        + ' ORDER BY "units" desc LIMIT 3 OFFSET 1',
    );
    assert.deepEqual(values, [5]);
}

console.log('query-builder.test.ts SELECT PASSED');

// INSERT
{
    const { text, values } = QueryBuilder.insert('cart_items')
        .values({ user_id: 'user-001', book_id: 'book-001', quantity: 2 })
        .toSql();
    assert.equal(text, 'INSERT INTO "cart_items" ("user_id", "book_id", "quantity") VALUES ($1, $2, $3)');
    assert.deepEqual(values, ['user-001', 'book-001', 2]);
}

// UPDATE with where
{
    const { text, values } = QueryBuilder.update('books')
        .set({ stock: 14, price: 9.49 })
        .where('book_id = ?', 'book-001')
        .toSql();
    assert.equal(text, 'UPDATE "books" SET "stock" = $1, "price" = $2 WHERE book_id = $3');
    assert.deepEqual(values, [14, 9.49, 'book-001']);
}

// DELETE with where
{
    const { text, values } = QueryBuilder.delete('cart_items')
        .where('user_id = ?', 'user-001')
        .toSql();
    assert.equal(text, 'DELETE FROM "cart_items" WHERE user_id = $1');
    assert.deepEqual(values, ['user-001']);
}

console.log('query-builder.test.ts WRITE PASSED');

// Multi-row INSERT: values() accepts an array (or repeated calls), one tuple per row
{
    const { text, values } = QueryBuilder.insert('books')
        .values([
            { book_id: 'b1', title: 'Dune' },
            { book_id: 'b2', title: '1984' },
        ])
        .toSql();
    assert.equal(text, 'INSERT INTO "books" ("book_id", "title") VALUES ($1, $2), ($3, $4)');
    assert.deepEqual(values, ['b1', 'Dune', 'b2', '1984']);
}

// repeated values() calls accumulate rows
{
    const { text, values } = QueryBuilder.insert('books')
        .values({ book_id: 'b1', title: 'Dune' })
        .values({ book_id: 'b2', title: '1984' })
        .toSql();
    assert.equal(text, 'INSERT INTO "books" ("book_id", "title") VALUES ($1, $2), ($3, $4)');
    assert.deepEqual(values, ['b1', 'Dune', 'b2', '1984']);
}

// rows with mismatched columns are rejected
{
    assert.throws(
        () => QueryBuilder.insert('books').values([{ a: 1 }, { b: 2 }]).toSql(),
        /same columns/,
    );
}

// INSERT ... RETURNING (suffix dialects: postgres/sqlite)
{
    const { text, values } = QueryBuilder.insert('books')
        .values({ title: 'Dune' })
        .returning('book_id', 'title')
        .toSql();
    assert.equal(text, 'INSERT INTO "books" ("title") VALUES ($1) RETURNING "book_id", "title"');
    assert.deepEqual(values, ['Dune']);
}

// returning() with no args → all columns
{
    const { text } = QueryBuilder.insert('books').values({ title: 'Dune' }).returning().toSql();
    assert.equal(text, 'INSERT INTO "books" ("title") VALUES ($1) RETURNING *');
}

// INSERT ... OUTPUT (inline dialect: mssql — clause sits before VALUES)
{
    const { text } = QueryBuilder.insert('books')
        .values({ title: 'Dune' })
        .returning('book_id')
        .toSql(new MssqlDialect());
    assert.equal(text, 'INSERT INTO [books] ([title]) OUTPUT INSERTED.[book_id] VALUES (@p1)');
}

// UPDATE ... RETURNING / OUTPUT (inline clause sits before WHERE)
{
    const { text, values } = QueryBuilder.update('books')
        .set({ stock: 5 })
        .where('book_id = ?', 'b1')
        .returning('stock')
        .toSql();
    assert.equal(text, 'UPDATE "books" SET "stock" = $1 WHERE book_id = $2 RETURNING "stock"');
    assert.deepEqual(values, [5, 'b1']);
}
{
    const { text } = QueryBuilder.update('books')
        .set({ stock: 5 })
        .where('book_id = ?', 'b1')
        .returning('stock')
        .toSql(new MssqlDialect());
    assert.equal(text, 'UPDATE [books] SET [stock] = @p1 OUTPUT INSERTED.[stock] WHERE book_id = @p2');
}

// DELETE ... RETURNING / OUTPUT (mssql reads from DELETED)
{
    const { text } = QueryBuilder.delete('books')
        .where('book_id = ?', 'b1')
        .returning()
        .toSql();
    assert.equal(text, 'DELETE FROM "books" WHERE book_id = $1 RETURNING *');
}
{
    const { text } = QueryBuilder.delete('books')
        .where('book_id = ?', 'b1')
        .returning()
        .toSql(new MssqlDialect());
    assert.equal(text, 'DELETE FROM [books] OUTPUT DELETED.* WHERE book_id = @p1');
}

// engines without row-returning writes reject at compile time
{
    assert.throws(
        () => QueryBuilder.insert('books').values({ a: 1 }).returning().toSql(new MySqlDialect()),
        UnsupportedEngineException,
    );
    assert.throws(
        () => QueryBuilder.insert('books').values({ a: 1 }).returning().toSql(new OracleDialect()),
        UnsupportedEngineException,
    );
}

console.log('query-builder.test.ts RETURNING PASSED');
