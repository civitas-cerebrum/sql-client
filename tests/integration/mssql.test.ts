import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqlClient } from '../../src/client/SqlClient';
import { QueryBuilder } from '../../src/builder/QueryBuilder';

const BASE_CONFIG = {
    engine: 'mssql' as const,
    connection: {
        server: process.env.MSSQL_HOST ?? 'localhost',
        port: Number(process.env.MSSQL_PORT ?? 1433),
        user: process.env.MSSQL_USER ?? 'sa',
        password: process.env.MSSQL_PASSWORD ?? 'Bookhive!Passw0rd',
        database: 'master',
        options: { trustServerCertificate: true, encrypt: true },
    } as Record<string, unknown>,
};

async function main() {
    // 1. Connect to master and create the bookhive DB if absent
    const masterClient = new SqlClient(BASE_CONFIG);
    await masterClient.execute("IF DB_ID('bookhive') IS NULL CREATE DATABASE bookhive");
    await masterClient.end();

    // 2. Connect to bookhive and apply schema + seed (DROP-first for rerunnability)
    const bookhiveConnection = {
        ...BASE_CONFIG.connection,
        database: 'bookhive',
    };
    const client = new SqlClient({ engine: 'mssql', connection: bookhiveConnection });

    // Apply schema (each DROP/CREATE is a separate statement; split on ';')
    const schemaPath = join(__dirname, '../sql/mssql.schema.sql');
    const seedPath = join(__dirname, '../sql/mssql.seed.sql');

    for (const filePath of [schemaPath, seedPath]) {
        const sql = readFileSync(filePath, 'utf8');
        const stmts = sql
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const stmt of stmts) {
            await client.execute(stmt);
        }
    }

    // 3. Assert seed facts — Fiction = 5 books
    const fiction = await client.query<{ title: string }>(
        'SELECT title FROM books WHERE genre = @p1 ORDER BY title',
        ['Fiction']
    );
    assert.equal(fiction.rowCount, 5, `Expected 5 Fiction books, got ${fiction.rowCount}`);
    assert.equal(fiction.rows[0].title, '1984');

    // 4. Aggregate: Fiction should be top genre by units sold
    const units = await client.query<{ genre: string; u: number }>(
        'SELECT b.genre, SUM(oi.quantity) AS u FROM order_items oi JOIN books b ON b.book_id = oi.book_id GROUP BY b.genre ORDER BY u DESC, b.genre'
    );
    assert.equal(units.rows[0].genre, 'Fiction');

    // 5. Builder paginated query (MSSQL requires ORDER BY with OFFSET..FETCH)
    const built = await QueryBuilder.select('books').orderBy('book_id').limit(2).offset(1).run(client);
    assert.equal(built.rowCount, 2, `Expected 2 rows from paginated query, got ${built.rowCount}`);
    // Verify it used OFFSET..FETCH (MSSQL dialect) by checking the SQL string
    const { text } = QueryBuilder.select('books').orderBy('book_id').limit(2).offset(1).toSql(client.dialect);
    assert.ok(text.includes('OFFSET 1 ROWS FETCH NEXT 2 ROWS ONLY'), `Expected OFFSET..FETCH pagination, got: ${text}`);

    // 6. Transaction commits: deduct stock, then clean up
    await client.transaction(async (tx) => {
        await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = @p1', ['book-001']);
        await tx.execute(
            "INSERT INTO orders (order_id, user_id, total_price, [status], purchased_at) VALUES ('tx-ok', 'user-003', 12.99, 'COMPLETED', '2026-04-02T00:00:00Z')"
        );
    });
    const afterCommit = await client.query<{ stock: number }>(
        'SELECT stock FROM books WHERE book_id = @p1',
        ['book-001']
    );
    assert.equal(Number(afterCommit.rows[0].stock), 14, `Expected stock=14 after commit, got ${afterCommit.rows[0].stock}`);

    // 7. Transaction rollback leaves stock intact
    const before = await client.query<{ stock: number }>(
        'SELECT stock FROM books WHERE book_id = @p1',
        ['book-001']
    );
    await assert.rejects(
        client.transaction(async (tx) => {
            await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = @p1', ['book-001']);
            throw new Error('boom');
        })
    );
    const after = await client.query<{ stock: number }>(
        'SELECT stock FROM books WHERE book_id = @p1',
        ['book-001']
    );
    assert.equal(
        Number(after.rows[0].stock),
        Number(before.rows[0].stock),
        `Rollback should leave stock unchanged at ${before.rows[0].stock}`
    );

    // 8. Self-clean mutations so the suite is rerunnable
    await client.execute("DELETE FROM orders WHERE order_id = 'tx-ok'");
    await client.execute('UPDATE books SET stock = 15 WHERE book_id = @p1', ['book-001']);

    await client.end();
    console.log('integration/mssql.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
