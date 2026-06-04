import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqlClient } from '../../src/client/SqlClient';
import { QueryBuilder } from '../../src/builder/QueryBuilder';

const ORACLE_TEST_URL = process.env.ORACLE_TEST_URL ?? 'oracle://bookhive:bookhive@localhost:1521/FREEPDB1';

/**
 * Split an Oracle SQL file into individual statements.
 * The oracle schema uses '/' as a statement terminator (on its own line),
 * to allow PL/SQL blocks (BEGIN...END) as well as plain DDL/DML.
 */
function splitOracleSql(sql: string): string[] {
    return sql
        .split(/\n\/\s*\n?/)
        .map((s) => s.trim())
        .filter(Boolean);
}

async function main() {
    const client = new SqlClient({ engine: 'oracle', connectionString: ORACLE_TEST_URL });

    // Apply schema (PL/SQL drop blocks + DDL) and seed
    const schemaPath = join(__dirname, '../sql/oracle.schema.sql');
    const seedPath = join(__dirname, '../sql/oracle.seed.sql');

    for (const filePath of [schemaPath, seedPath]) {
        const sql = readFileSync(filePath, 'utf8');
        const stmts = splitOracleSql(sql);
        for (const stmt of stmts) {
            await client.execute(stmt);
        }
    }

    // 1. Fiction books = 5, ordered by title → '1984' is first
    // Oracle returns column names UPPERCASE with bare identifiers + OUT_FORMAT_OBJECT
    const fiction = await client.query<{ TITLE: string }>(
        'SELECT title FROM books WHERE genre = :1 ORDER BY title',
        ['Fiction']
    );
    assert.equal(fiction.rowCount, 5, `Expected 5 Fiction books, got ${fiction.rowCount}`);
    assert.equal(fiction.rows[0].TITLE, '1984', `Expected first title='1984', got '${fiction.rows[0].TITLE}'`);

    // 2. Aggregate: Fiction is top genre by units sold
    // Alias 'u' → uppercase 'U'
    const units = await client.query<{ GENRE: string; U: number }>(
        'SELECT b.genre, SUM(oi.quantity) AS u FROM order_items oi JOIN books b ON b.book_id = oi.book_id GROUP BY b.genre ORDER BY u DESC, b.genre'
    );
    assert.equal(units.rows[0].GENRE, 'Fiction', `Expected top genre='Fiction', got '${units.rows[0].GENRE}'`);

    // 3. Paginated builder query — Oracle uses OFFSET..FETCH and bare identifiers
    const built = await QueryBuilder.select('books').orderBy('book_id').limit(2).offset(1).run(client);
    assert.equal(built.rowCount, 2, `Expected 2 rows from paginated query, got ${built.rowCount}`);
    // Verify the SQL text uses OFFSET..FETCH
    const { text } = QueryBuilder.select('books').orderBy('book_id').limit(2).offset(1).toSql(client.dialect);
    assert.ok(
        text.includes('OFFSET 1 ROWS FETCH NEXT 2 ROWS ONLY'),
        `Expected OFFSET..FETCH pagination, got: ${text}`
    );

    // 4. Transaction rollback leaves stock intact
    const before = await client.query<{ STOCK: number }>(
        'SELECT stock FROM books WHERE book_id = :1',
        ['book-001']
    );
    await assert.rejects(
        client.transaction(async (tx) => {
            await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = :1', ['book-001']);
            throw new Error('boom');
        })
    );
    const after = await client.query<{ STOCK: number }>(
        'SELECT stock FROM books WHERE book_id = :1',
        ['book-001']
    );
    assert.equal(
        Number(after.rows[0].STOCK),
        Number(before.rows[0].STOCK),
        `Rollback should leave stock unchanged at ${before.rows[0].STOCK}`
    );

    // 5. Committed transaction: deduct stock, then self-clean
    await client.transaction(async (tx) => {
        await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = :1', ['book-001']);
        await tx.execute(
            "INSERT INTO orders (order_id, user_id, total_price, status, purchased_at) VALUES ('tx-ok', 'user-003', 12.99, 'COMPLETED', TIMESTAMP '2026-04-02 00:00:00 +00:00')"
        );
    });
    const afterCommit = await client.query<{ STOCK: number }>(
        'SELECT stock FROM books WHERE book_id = :1',
        ['book-001']
    );
    assert.equal(
        Number(afterCommit.rows[0].STOCK),
        14,
        `Expected stock=14 after commit, got ${afterCommit.rows[0].STOCK}`
    );

    // Self-clean
    await client.execute("DELETE FROM orders WHERE order_id = 'tx-ok'");
    await client.execute('UPDATE books SET stock = 15 WHERE book_id = :1', ['book-001']);

    await client.end();
    console.log('integration/oracle.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
