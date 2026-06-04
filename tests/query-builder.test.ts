import assert from 'node:assert/strict';
import { QueryBuilder } from '../src/builder/QueryBuilder';

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
