import assert from 'node:assert/strict';
import { SqlClient } from '../../src/client/SqlClient';
import { QueryBuilder } from '../../src/builder/QueryBuilder';

const CONN = process.env.MYSQL_TEST_URL ?? 'mysql://bookhive:bookhive@localhost:3306/bookhive';

async function main() {
    const client = new SqlClient({ connectionString: CONN });

    // query() returns typed rows + rowCount; MySQL uses ? placeholders
    const fiction = await client.query<{ title: string }>(
        'SELECT title FROM books WHERE genre = ? ORDER BY title', ['Fiction']);
    assert.equal(fiction.rowCount, 5);
    assert.equal(fiction.rows[0].title, '1984');

    // aggregate: Fiction units should be top genre
    const units = await client.query<{ genre: string; u: number }>(
        'SELECT b.genre, SUM(oi.quantity) AS u FROM order_items oi JOIN books b ON b.book_id = oi.book_id GROUP BY b.genre ORDER BY u DESC, b.genre');
    assert.equal(units.rows[0].genre, 'Fiction');

    // builder paginated query (MySQL uses LIMIT/OFFSET)
    const built = await QueryBuilder.select('books').orderBy('title').limit(3).offset(0).run(client);
    assert.equal(built.rowCount, 3);
    assert.equal((built.rows[0] as { title: string }).title, '1984');

    // transaction commits: deduct stock, clean up
    await client.transaction(async (tx) => {
        await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = ?', ['book-001']);
        await tx.execute("INSERT INTO orders (order_id, user_id, total_price, status, purchased_at) VALUES ('tx-ok', 'user-003', 12.99, 'COMPLETED', '2026-04-02 00:00:00')");
    });
    const afterCommit = await client.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = ?', ['book-001']);
    assert.equal(Number(afterCommit.rows[0].stock), 14); // 15 - 1

    // transaction rollback leaves stock intact
    const before = await client.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = ?', ['book-001']);
    await assert.rejects(client.transaction(async (tx) => {
        await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = ?', ['book-001']);
        throw new Error('boom');
    }));
    const after = await client.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = ?', ['book-001']);
    assert.equal(Number(after.rows[0].stock), Number(before.rows[0].stock));

    // self-clean mutations so the suite is rerunnable
    await client.execute("DELETE FROM orders WHERE order_id = 'tx-ok'");
    await client.execute('UPDATE books SET stock = 15 WHERE book_id = ?', ['book-001']);

    await client.end();
    console.log('integration/mysql.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
