/**
 * Portable bookhive integration test harness.
 *
 * Exports `runUseCases(client)` which exercises every public API of SqlClient
 * against the live bookhive schema. Designed to run identically on all five
 * engines (postgres, mysql, sqlite, mssql, oracle). Mutations are cleaned up
 * so the function can be called twice in sequence (rerunnability guarantee).
 *
 * Design notes
 * ------------
 * - All parametrised SQL uses `client.dialect.placeholder(n)` so the correct
 *   marker ($1 / ? / @p1 / :1) is emitted per engine.
 * - Column access goes through `col(row, name)` which is case-insensitive;
 *   Oracle returns UPPERCASE keys.
 * - Numeric aggregates go through `num(v)` because pg/mysql return NUMERIC as
 *   strings.
 * - QueryBuilder is used for pagination (compilePagination differs per dialect:
 *   LIMIT/OFFSET vs OFFSET..FETCH).
 * - Raw SQL uses unquoted lowercase identifiers (Oracle folds unquoted to
 *   UPPERCASE; schema was created the same way, so both sides agree).
 * - The MSSQL reserved-word column `[status]` only appears in raw INSERT
 *   strings; a one-line switch provides the bracketed spelling for that engine.
 *   `status` unbracketed works fine in SELECT/WHERE; the bracket is only
 *   required in INSERT column lists for mssql.
 * - Oracle `TIMESTAMP WITH TIME ZONE` columns bound as JS `Date` objects work
 *   correctly through the oracledb driver; string literals do not reliably
 *   parse.  All parametrised date/timestamp values are therefore `new Date(...)`.
 */

import assert from 'node:assert/strict';
import { SqlClient } from '../../src/client/SqlClient';
import { QueryBuilder } from '../../src/builder/QueryBuilder';
import { QueryFailedException } from '../../src/exceptions/SqlException';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Case-insensitive column accessor (Oracle returns UPPERCASE keys). */
export function col(row: Record<string, unknown>, name: string): unknown {
    return row[name] ?? row[name.toUpperCase()];
}

/** Coerce pg/mysql NUMERIC/DECIMAL strings to number. */
export function num(v: unknown): number {
    return Number(v);
}

// ---------------------------------------------------------------------------
// Engine-specific rendering helpers (used only where unavoidable)
// ---------------------------------------------------------------------------

/**
 * The `status` column in the `orders` table is a reserved word in T-SQL and
 * must be bracketed in INSERT column lists for MSSQL. SELECT/WHERE work fine
 * without brackets on all engines.
 *
 * Per-engine override: mssql only.
 */
function statusCol(engine: string): string {
    return engine === 'mssql' ? '[status]' : 'status';
}

/**
 * Bind a single placeholder at position `i` (1-based).
 * Thin wrapper around `client.dialect.placeholder(i)`.
 */
function ph(client: SqlClient, i: number): string {
    return client.dialect.placeholder(i);
}

/**
 * Return a date value suitable for binding as a timestamp parameter.
 *
 * Per-engine override: SQLite (better-sqlite3) rejects Date objects; it only
 * accepts numbers, strings, bigints, buffers, and null. All other engines
 * accept a JS Date object and map it to the correct timestamp type. For
 * Oracle the oracledb driver handles Date→TIMESTAMP WITH TIME ZONE correctly.
 */
function bindDate(client: SqlClient, iso: string): unknown {
    return client.engine === 'sqlite' ? iso : new Date(iso);
}

// ---------------------------------------------------------------------------
// Main harness
// ---------------------------------------------------------------------------

export async function runUseCases(client: SqlClient): Promise<void> {
    const e = client.engine;

    // -----------------------------------------------------------------------
    // Use case 1 — query() SELECT with a single parameter
    // Verify: fetching book-003 by id returns title '1984'.
    // -----------------------------------------------------------------------
    {
        const sql = `SELECT title FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-003']);
        assert.equal(result.rowCount, 1, `UC1: expected rowCount=1, got ${result.rowCount}`);
        assert.equal(
            String(col(result.rows[0], 'title')),
            '1984',
            `UC1: expected title='1984', got '${col(result.rows[0], 'title')}'`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 2 — query() SELECT filter by genre
    // Verify: genre='Fiction' → 5 books; '1984' is present.
    // -----------------------------------------------------------------------
    {
        const sql = `SELECT title FROM books WHERE genre = ${ph(client, 1)} ORDER BY title`;
        const result = await client.query<Record<string, unknown>>(sql, ['Fiction']);
        assert.equal(result.rowCount, 5, `UC2: expected 5 Fiction books, got ${result.rowCount}`);
        const titles = result.rows.map((r) => String(col(r, 'title')));
        assert.ok(titles.includes('1984'), `UC2: '1984' not found in Fiction titles: ${titles.join(', ')}`);
    }

    // -----------------------------------------------------------------------
    // Use case 3 — QueryBuilder SELECT with columns, WHERE, ORDER BY, LIMIT
    // Verify: 2 rows returned; pagination uses dialect-correct SQL; first
    // title is '1984' (alphabetically first Fiction book).
    // -----------------------------------------------------------------------
    {
        const qb3 = QueryBuilder
            .select('books')
            .columns('title', 'price')
            .where('genre = ?', 'Fiction')
            .orderBy('title')
            .limit(2);
        // Confirm dialect-correct pagination in the compiled SQL text
        const { text } = qb3.toSql(client.dialect);
        if (e === 'mssql' || e === 'oracle') {
            assert.ok(text.includes('FETCH NEXT'), `UC3: expected OFFSET..FETCH in SQL, got: ${text}`);
        } else {
            assert.ok(text.includes('LIMIT'), `UC3: expected LIMIT in SQL, got: ${text}`);
        }
        const result = await qb3.run(client);
        assert.equal(result.rowCount, 2, `UC3: expected 2 rows, got ${result.rowCount}`);
        assert.equal(
            String(col(result.rows[0] as Record<string, unknown>, 'title')),
            '1984',
            `UC3: expected first title='1984', got '${col(result.rows[0] as Record<string, unknown>, 'title')}'`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 4 — QueryBuilder FK JOIN (orders ⋈ order_items ⋈ books)
    // Verify: order-001 has 2 line items; both book ids are present.
    // -----------------------------------------------------------------------
    {
        const result = await QueryBuilder
            .select('orders')
            .columns('orders.order_id AS order_id', 'order_items.book_id AS book_id', 'order_items.quantity AS quantity')
            .join('order_items', 'order_items.order_id = orders.order_id')
            .join('books', 'books.book_id = order_items.book_id')
            .where('orders.order_id = ?', 'order-001')
            .orderBy('order_items.book_id')
            .run(client);
        assert.equal(result.rowCount, 2, `UC4: expected 2 order items for order-001, got ${result.rowCount}`);
        const bookIds = result.rows.map((r) => String(col(r as Record<string, unknown>, 'book_id')));
        assert.ok(bookIds.includes('book-001'), `UC4: book-001 missing from order-001 items`);
        assert.ok(bookIds.includes('book-003'), `UC4: book-003 missing from order-001 items`);
    }

    // -----------------------------------------------------------------------
    // Use case 5 — Aggregate GROUP BY + HAVING (SUM units per genre)
    // Verify: Fiction=3, Fantasy=2, Non-Fiction=1.
    // ORDER BY expression (not alias) to avoid engine-specific alias-ordering
    // limitations.
    // -----------------------------------------------------------------------
    {
        const sql = [
            'SELECT b.genre, SUM(oi.quantity) AS units',
            'FROM order_items oi',
            'JOIN books b ON b.book_id = oi.book_id',
            'GROUP BY b.genre',
            'HAVING SUM(oi.quantity) >= 1',
            'ORDER BY SUM(oi.quantity) DESC, b.genre ASC',
        ].join(' ');
        const result = await client.query<Record<string, unknown>>(sql);
        assert.equal(result.rows.length, 3, `UC5: expected 3 genre rows, got ${result.rows.length}`);

        const byGenre: Record<string, number> = {};
        for (const row of result.rows) {
            byGenre[String(col(row, 'genre'))] = num(col(row, 'units'));
        }
        assert.equal(byGenre['Fiction'], 3, `UC5: Fiction units expected 3, got ${byGenre['Fiction']}`);
        assert.equal(byGenre['Fantasy'], 2, `UC5: Fantasy units expected 2, got ${byGenre['Fantasy']}`);
        assert.equal(byGenre['Non-Fiction'], 1, `UC5: Non-Fiction units expected 1, got ${byGenre['Non-Fiction']}`);
    }

    // -----------------------------------------------------------------------
    // Use case 5b — QueryBuilder GROUP BY + HAVING, live end-to-end
    // Seed: book-001=1, book-003=2, book-006=1, book-008=2.
    // HAVING SUM(quantity) >= 2 → book-003 and book-008 (ordered by book_id ASC).
    // -----------------------------------------------------------------------
    {
        const agg = await QueryBuilder
            .select('order_items')
            .columns('book_id', 'SUM(quantity) AS units')
            .groupBy('book_id')
            .having('SUM(quantity) >= ?', 2)
            .orderBy('book_id')
            .run(client);
        assert.equal(agg.rowCount, 2, `UC5b: expected 2 rows with SUM(quantity)>=2, got ${agg.rowCount}`);
        assert.equal(
            String(col(agg.rows[0] as Record<string, unknown>, 'book_id')),
            'book-003',
            `UC5b: expected first book_id='book-003', got '${col(agg.rows[0] as Record<string, unknown>, 'book_id')}'`,
        );
        assert.equal(
            num(col(agg.rows[0] as Record<string, unknown>, 'units')),
            2,
            `UC5b: expected first units=2, got ${num(col(agg.rows[0] as Record<string, unknown>, 'units'))}`,
        );
        assert.equal(
            String(col(agg.rows[1] as Record<string, unknown>, 'book_id')),
            'book-008',
            `UC5b: expected second book_id='book-008', got '${col(agg.rows[1] as Record<string, unknown>, 'book_id')}'`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 6 — Subquery: usernames with ≥1 order
    // Verify: only alice and bob; carol has no orders.
    // -----------------------------------------------------------------------
    {
        const sql = [
            'SELECT username FROM users',
            'WHERE user_id IN (SELECT DISTINCT user_id FROM orders)',
            'ORDER BY username',
        ].join(' ');
        const result = await client.query<Record<string, unknown>>(sql);
        const usernames = result.rows.map((r) => String(col(r, 'username')));
        assert.deepEqual(usernames, ['alice', 'bob'], `UC6: expected [alice, bob], got ${JSON.stringify(usernames)}`);
    }

    // -----------------------------------------------------------------------
    // Use case 7 — CTE + window function: RANK() OVER (ORDER BY units DESC, book_id ASC)
    // Verify: '1984' (book-003, 2 units) and 'The Hobbit' (book-008, 2 units) tie;
    // book-003 < book-008 lexicographically, so '1984' is rank 1.
    // The rank filter uses a dialect placeholder (demonstrates portability).
    // -----------------------------------------------------------------------
    {
        // Oracle does not support alias-based ordering inside a window ORDER BY
        // for CTEs — use the expression directly (which is portable anyway).
        const rankParam = ph(client, 1);
        const sql = [
            'WITH book_units AS (',
            '  SELECT book_id, SUM(quantity) AS units',
            '  FROM order_items',
            '  GROUP BY book_id',
            '),',
            'ranked AS (',
            '  SELECT book_id, units,',
            '    RANK() OVER (ORDER BY units DESC, book_id ASC) AS rnk',
            '  FROM book_units',
            ')',
            'SELECT b.title, r.rnk',
            'FROM ranked r',
            'JOIN books b ON b.book_id = r.book_id',
            `WHERE r.rnk = ${rankParam}`,
        ].join(' ');
        const result = await client.query<Record<string, unknown>>(sql, [1]);
        assert.ok(result.rows.length >= 1, `UC7: expected at least 1 rank-1 row, got ${result.rows.length}`);
        const titles = result.rows.map((r) => String(col(r, 'title')));
        assert.ok(
            titles.includes('1984'),
            `UC7: expected '1984' in rank-1 results, got ${JSON.stringify(titles)}`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 8 — DISTINCT genres + builder pagination OFFSET/LIMIT
    // Part A: all genres via raw SELECT DISTINCT → ['Fantasy','Fiction','Non-Fiction']
    // Part B: QueryBuilder with OFFSET 1 LIMIT 2 → ['Fiction','Non-Fiction']
    // -----------------------------------------------------------------------
    {
        // Part A — raw distinct
        const sqlA = 'SELECT DISTINCT genre FROM books ORDER BY genre ASC';
        const resultA = await client.query<Record<string, unknown>>(sqlA);
        const allGenres = resultA.rows.map((r) => String(col(r, 'genre')));
        assert.deepEqual(
            allGenres,
            ['Fantasy', 'Fiction', 'Non-Fiction'],
            `UC8A: expected ['Fantasy','Fiction','Non-Fiction'], got ${JSON.stringify(allGenres)}`,
        );

        // Part B — builder pagination (LIMIT/OFFSET or OFFSET..FETCH per dialect)
        // 'DISTINCT genre' is treated as a raw expression by quoteColumn (contains space)
        // producing: SELECT DISTINCT genre FROM books ORDER BY genre LIMIT 2 OFFSET 1
        // or the OFFSET..FETCH equivalent on mssql/oracle.
        const resultB = await QueryBuilder
            .select('books')
            .columns('DISTINCT genre')
            .orderBy('genre')
            .offset(1)
            .limit(2)
            .run(client);
        const pagedGenres = resultB.rows.map((r) => String(col(r as Record<string, unknown>, 'genre')));
        assert.deepEqual(
            pagedGenres,
            ['Fiction', 'Non-Fiction'],
            `UC8B: expected ['Fiction','Non-Fiction'], got ${JSON.stringify(pagedGenres)}`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 9 — Builder CRUD: INSERT → SELECT-back → UPDATE → DELETE
    // Uses cart_items (no reserved-word columns) with temp id 'uc-cart-tmp'.
    // -----------------------------------------------------------------------
    {
        const tempId = 'uc-cart-tmp';

        // INSERT
        const insResult = await QueryBuilder
            .insert('cart_items')
            .values({
                cart_item_id: tempId,
                user_id: 'user-003',
                book_id: 'book-002',
                quantity: 3,
                added_at: bindDate(client, '2026-04-01T00:00:00Z'),
            })
            .run(client);
        assert.equal(insResult.rowCount, 1, `UC9 INSERT: expected rowCount=1, got ${insResult.rowCount}`);

        // SELECT-back confirms row exists
        const selResult = await QueryBuilder
            .select('cart_items')
            .where('cart_item_id = ?', tempId)
            .run(client);
        assert.equal(selResult.rowCount, 1, `UC9 SELECT-back: expected 1 row, got ${selResult.rowCount}`);
        assert.equal(
            num(col(selResult.rows[0] as Record<string, unknown>, 'quantity')),
            3,
            `UC9 SELECT-back: expected quantity=3`,
        );

        // UPDATE
        const updResult = await QueryBuilder
            .update('cart_items')
            .set({ quantity: 7 })
            .where('cart_item_id = ?', tempId)
            .run(client);
        assert.equal(updResult.rowCount, 1, `UC9 UPDATE: expected rowCount=1, got ${updResult.rowCount}`);

        // Verify UPDATE took effect
        const selAfterUpd = await QueryBuilder
            .select('cart_items')
            .where('cart_item_id = ?', tempId)
            .run(client);
        assert.equal(
            num(col(selAfterUpd.rows[0] as Record<string, unknown>, 'quantity')),
            7,
            `UC9 UPDATE verify: expected quantity=7`,
        );

        // DELETE
        const delResult = await QueryBuilder
            .delete('cart_items')
            .where('cart_item_id = ?', tempId)
            .run(client);
        assert.equal(delResult.rowCount, 1, `UC9 DELETE: expected rowCount=1, got ${delResult.rowCount}`);

        // Verify DELETE removed the row
        const selAfterDel = await QueryBuilder
            .select('cart_items')
            .where('cart_item_id = ?', tempId)
            .run(client);
        assert.equal(selAfterDel.rowCount, 0, `UC9 DELETE verify: expected 0 rows, got ${selAfterDel.rowCount}`);
    }

    // -----------------------------------------------------------------------
    // Use case 10 — Raw execute() INSERT + DELETE with dialect placeholders
    // Verify: both return rowCount=1.
    // -----------------------------------------------------------------------
    {
        const tempId = 'uc-exec-tmp';
        const insSQL = [
            'INSERT INTO cart_items',
            '(cart_item_id, user_id, book_id, quantity, added_at)',
            `VALUES (${ph(client, 1)}, ${ph(client, 2)}, ${ph(client, 3)}, ${ph(client, 4)}, ${ph(client, 5)})`,
        ].join(' ');
        const insResult = await client.execute(insSQL, [
            tempId,
            'user-003',
            'book-002',
            2,
            bindDate(client, '2026-04-01T00:00:00Z'),
        ]);
        assert.equal(insResult.rowCount, 1, `UC10 INSERT: expected rowCount=1, got ${insResult.rowCount}`);

        const delSQL = `DELETE FROM cart_items WHERE cart_item_id = ${ph(client, 1)}`;
        const delResult = await client.execute(delSQL, [tempId]);
        assert.equal(delResult.rowCount, 1, `UC10 DELETE: expected rowCount=1, got ${delResult.rowCount}`);
    }

    // -----------------------------------------------------------------------
    // Use case 11 — Transaction COMMIT
    // Decrement book-002 stock by 1 + insert a temp order atomically.
    // Verify stock=11 after commit. Then clean up → stock=12, order gone.
    // -----------------------------------------------------------------------
    {
        const tempOrderId = 'uc-tx-commit';
        const sc = statusCol(e);

        await client.transaction(async (tx) => {
            await tx.execute(
                `UPDATE books SET stock = stock - 1 WHERE book_id = ${ph(client, 1)}`,
                ['book-002'],
            );
            const oInsSQL = [
                'INSERT INTO orders',
                `(order_id, user_id, total_price, ${sc}, purchased_at)`,
                `VALUES (${ph(client, 1)}, ${ph(client, 2)}, ${ph(client, 3)}, ${ph(client, 4)}, ${ph(client, 5)})`,
            ].join(' ');
            await tx.execute(oInsSQL, [
                tempOrderId,
                'user-003',
                10.99,
                'COMPLETED',
                bindDate(client, '2026-04-02T00:00:00Z'),
            ]);
        });

        // Verify committed stock
        const stockSQL = `SELECT stock FROM books WHERE book_id = ${ph(client, 1)}`;
        const stockResult = await client.query<Record<string, unknown>>(stockSQL, ['book-002']);
        assert.equal(
            num(col(stockResult.rows[0], 'stock')),
            11,
            `UC11 COMMIT: expected stock=11, got ${num(col(stockResult.rows[0], 'stock'))}`,
        );

        // Clean up: delete temp order and restore stock
        const delOrdSQL = `DELETE FROM orders WHERE order_id = ${ph(client, 1)}`;
        await client.execute(delOrdSQL, [tempOrderId]);
        const restoreSQL = `UPDATE books SET stock = 12 WHERE book_id = ${ph(client, 1)}`;
        await client.execute(restoreSQL, ['book-002']);

        // Confirm cleanup
        const finalStock = await client.query<Record<string, unknown>>(stockSQL, ['book-002']);
        assert.equal(
            num(col(finalStock.rows[0], 'stock')),
            12,
            `UC11 cleanup: expected stock=12, got ${num(col(finalStock.rows[0], 'stock'))}`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 12 — Transaction ROLLBACK
    // Decrement stock then throw; assert it rejects; verify stock unchanged (12).
    // -----------------------------------------------------------------------
    {
        const stockSQL = `SELECT stock FROM books WHERE book_id = ${ph(client, 1)}`;

        const before = await client.query<Record<string, unknown>>(stockSQL, ['book-002']);
        const stockBefore = num(col(before.rows[0], 'stock'));

        await assert.rejects(
            client.transaction(async (tx) => {
                await tx.execute(
                    `UPDATE books SET stock = stock - 1 WHERE book_id = ${ph(client, 1)}`,
                    ['book-002'],
                );
                throw new Error('boom');
            }),
            /boom/,
        );

        const after = await client.query<Record<string, unknown>>(stockSQL, ['book-002']);
        const stockAfter = num(col(after.rows[0], 'stock'));
        assert.equal(
            stockAfter,
            stockBefore,
            `UC12 ROLLBACK: stock should be ${stockBefore}, got ${stockAfter}`,
        );
    }

    // -----------------------------------------------------------------------
    // Use case 13 — Error: bad SQL → QueryFailedException
    // -----------------------------------------------------------------------
    {
        await assert.rejects(
            client.query(`SELECT * FROM not_a_table WHERE x = ${ph(client, 1)}`, ['y']),
            (err: unknown) => {
                assert.ok(
                    err instanceof QueryFailedException,
                    `UC13: expected QueryFailedException, got ${(err as Error)?.constructor?.name}`,
                );
                assert.equal(
                    (err as QueryFailedException).params[0],
                    'y',
                    `UC13: expected params[0]='y', got ${(err as QueryFailedException).params[0]}`,
                );
                return true;
            },
        );
    }

    // -----------------------------------------------------------------------
    // Use case 14 — dialect exposed and engine correct
    // -----------------------------------------------------------------------
    {
        assert.ok(
            client.engine !== undefined && client.engine !== null,
            `UC14: client.engine should be defined`,
        );
        assert.ok(
            typeof client.dialect.placeholder === 'function',
            `UC14: client.dialect.placeholder should be a function`,
        );
        assert.ok(
            typeof client.dialect.quoteIdentifier === 'function',
            `UC14: client.dialect.quoteIdentifier should be a function`,
        );
        assert.ok(
            typeof client.dialect.compilePagination === 'function',
            `UC14: client.dialect.compilePagination should be a function`,
        );
        // Spot-check placeholder output matches the engine
        const p1 = client.dialect.placeholder(1);
        if (e === 'postgres') assert.equal(p1, '$1', `UC14: postgres placeholder(1) should be '$1'`);
        if (e === 'mysql' || e === 'sqlite') assert.equal(p1, '?', `UC14: ${e} placeholder(1) should be '?'`);
        if (e === 'mssql') assert.equal(p1, '@p1', `UC14: mssql placeholder(1) should be '@p1'`);
        if (e === 'oracle') assert.equal(p1, ':1', `UC14: oracle placeholder(1) should be ':1'`);
    }
}
