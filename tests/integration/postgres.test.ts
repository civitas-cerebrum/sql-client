import assert from 'node:assert/strict';
import { SqlClient } from '../../src/client/SqlClient';
import { QueryBuilder } from '../../src/builder/QueryBuilder';
import { QueryFailedException } from '../../src/exceptions/SqlException';

const CONN = process.env.SQL_TEST_URL ?? 'postgres://bookhive:bookhive@localhost:5432/bookhive';

async function main() {
    const client = new SqlClient({ connectionString: CONN });

    // query() returns typed rows + rowCount
    const fiction = await client.query<{ title: string }>(
        'SELECT title FROM books WHERE genre = $1 ORDER BY title', ['Fiction']);
    assert.equal(fiction.rowCount, 5);
    assert.equal(fiction.rows[0].title, '1984');

    // execute() reports affected rows, no leak into books
    const ins = await client.execute(
        'INSERT INTO cart_items (cart_item_id, user_id, book_id, quantity, added_at) VALUES ($1,$2,$3,$4,$5)',
        ['cart-temp', 'user-003', 'book-002', 1, '2026-04-01T00:00:00Z']);
    assert.equal(ins.rowCount, 1);
    await client.execute('DELETE FROM cart_items WHERE cart_item_id = $1', ['cart-temp']);

    // builder .run(client) dispatches a SELECT
    const built = await QueryBuilder.select('books').columns('book_id').where('genre = ?', 'Fantasy').run(client);
    assert.equal(built.rowCount, 1);

    // transaction commits both writes
    await client.transaction(async (tx) => {
        await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-001']);
        await tx.execute("INSERT INTO orders (order_id,user_id,total_price,status,purchased_at) VALUES ('tx-ok','user-003',12.99,'COMPLETED','2026-04-02T00:00:00Z')");
    });
    const afterCommit = await client.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-001']);
    assert.equal(Number(afterCommit.rows[0].stock), 14); // 15 - 1

    // transaction rolls back on throw — stock restored, no order
    await assert.rejects(client.transaction(async (tx) => {
        await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-001']);
        throw new Error('boom');
    }));
    const afterRollback = await client.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-001']);
    assert.equal(Number(afterRollback.rows[0].stock), 14); // unchanged by the failed tx

    // invalid SQL → QueryFailedException carrying sql + params
    await assert.rejects(
        client.query('SELECT * FROM not_a_table WHERE x = $1', ['y']),
        (err: unknown) => err instanceof QueryFailedException && (err as QueryFailedException).params[0] === 'y',
    );

    // cleanup mutations so the suite is rerunnable
    await client.execute("DELETE FROM orders WHERE order_id = 'tx-ok'");
    await client.execute('UPDATE books SET stock = 15 WHERE book_id = $1', ['book-001']);

    await client.end();
    console.log('integration/postgres.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
