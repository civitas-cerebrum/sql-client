import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SqlClient } from '../../src/client/SqlClient';

async function main() {
    const db = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });
    // load schema + seed (split on ';' — statements are simple, no embedded semicolons except in the
    // Hobbit description's apostrophe which is fine; if needed, exec the whole file via a raw call).
    for (const file of ['tests/sql/sqlite.schema.sql', 'tests/sql/sqlite.seed.sql']) {
        const sql = readFileSync(file, 'utf8');
        for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
            await db.execute(stmt);
        }
    }
    const fiction = await db.query<{ title: string }>('SELECT title FROM books WHERE genre = ? ORDER BY title', ['Fiction']);
    assert.equal(fiction.rowCount, 5);
    assert.equal(fiction.rows[0].title, '1984');

    // aggregate
    const units = await db.query<{ genre: string; u: number }>(
        'SELECT b.genre, SUM(oi.quantity) AS u FROM order_items oi JOIN books b ON b.book_id = oi.book_id GROUP BY b.genre ORDER BY u DESC, b.genre');
    assert.equal(units.rows[0].genre, 'Fiction');

    // transaction rollback leaves stock intact
    const before = await db.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = ?', ['book-001']);
    await assert.rejects(db.transaction(async (tx) => { await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = ?', ['book-001']); throw new Error('boom'); }));
    const after = await db.query<{ stock: number }>('SELECT stock FROM books WHERE book_id = ?', ['book-001']);
    assert.equal(Number(after.rows[0].stock), Number(before.rows[0].stock));

    await db.end();
    console.log('integration/sqlite.test.ts PASSED');
}
main().catch((e) => { console.error(e); process.exit(1); });
