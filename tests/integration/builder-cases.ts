/**
 * Exhaustive QueryBuilder permutation harness for the bookhive schema.
 *
 * Exports `runBuilderCases(client)` which exercises every QueryBuilder feature
 * via `.run(client)` against the live database. Designed to run identically on
 * all five engines. Mutations use isolated temp ids and are cleaned up before
 * the function returns (rerunnability guarantee).
 *
 * Design notes
 * ------------
 * - `.run(client)` dispatches through the client; SELECT → query, else execute.
 * - `rows(result)` + Row accessor methods for column access (case-insensitive;
 *   Oracle UPPERCASE keys are handled). Numeric coercion via `.number(col)`.
 * - Pagination SQL is checked via `.toSql(client.dialect).text`:
 *     LIMIT/OFFSET on postgres/mysql/sqlite
 *     OFFSET..FETCH / OFFSET..ROWS on mssql/oracle
 * - For offset-only: mssql/oracle produce `OFFSET N ROWS`; the builder still
 *   requires ORDER BY on those engines (included).
 * - For limit-only: mssql/oracle produce `OFFSET 0 ROWS FETCH NEXT N ROWS ONLY`
 *   — the check looks for `FETCH NEXT` rather than `LIMIT`.
 * - Only `books` and `cart_items` are used for CRUD (no reserved-word columns).
 */

import assert from 'node:assert/strict';
import { QueryBuilder } from '../../src/builder/QueryBuilder';
import { SqlClient } from '../../src/client/SqlClient';
import { rows } from '../../src/result/ResultSet';
import { UnsupportedEngineException } from '../../src/exceptions/SqlException';

export async function runBuilderCases(client: SqlClient): Promise<void> {
    const e = client.engine;

    // ==========================================================================
    // BC-1: SELECT * → 8 rows
    // ==========================================================================
    {
        const result = await QueryBuilder.select('books').run(client);
        assert.equal(result.rowCount, 8, `BC-1: expected 8 rows, got ${result.rowCount}`);
    }

    // ==========================================================================
    // BC-2: SELECT specific columns → only those keys present on a row
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .columns('book_id', 'title', 'price')
            .where('book_id = ?', 'book-001')
            .run(client);
        assert.equal(result.rowCount, 1, `BC-2: rowCount should be 1`);
        const bc2 = rows(result).one();
        // The selected column values should be present
        assert.ok(bc2.get('book_id') !== undefined, `BC-2: book_id should be present`);
        assert.ok(bc2.get('title') !== undefined, `BC-2: title should be present`);
        assert.ok(bc2.get('price') !== undefined, `BC-2: price should be present`);
        // A non-selected column should be absent
        assert.strictEqual(bc2.get('stock'), undefined, `BC-2: stock should not be in the result row`);
        assert.strictEqual(bc2.get('author'), undefined, `BC-2: author should not be in the result row`);
    }

    // ==========================================================================
    // BC-3: WHERE single condition
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .columns('title')
            .where('book_id = ?', 'book-003')
            .run(client);
        assert.equal(result.rowCount, 1, `BC-3: rowCount should be 1`);
        assert.equal(
            rows(result).one().string('title'),
            '1984',
            `BC-3: title should be '1984'`,
        );
    }

    // ==========================================================================
    // BC-4: WHERE multiple ANDed: genre='Fiction' AND price < 10 → book-004, book-005
    // book-004 price=9.99, book-005 price=8.99; all other Fiction >= 10.99
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .columns('book_id', 'price')
            .where('genre = ?', 'Fiction')
            .where('price < ?', 10)
            .orderBy('book_id')
            .run(client);
        assert.equal(result.rowCount, 2, `BC-4: expected 2 rows, got ${result.rowCount}`);
        const ids4 = rows(result).column('book_id').map(String);
        assert.ok(ids4.includes('book-004'), `BC-4: book-004 should be in results`);
        assert.ok(ids4.includes('book-005'), `BC-4: book-005 should be in results`);
    }

    // ==========================================================================
    // BC-5: WHERE with a numeric param (stock > 10)
    // book-001=15, book-002=12, book-003=18, book-004=14, book-006=20, book-008=25 → 6 books
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .where('stock > ?', 10)
            .run(client);
        assert.equal(result.rowCount, 6, `BC-5: expected 6 books with stock>10, got ${result.rowCount}`);
    }

    // ==========================================================================
    // BC-6: JOIN (orders ⋈ order_items for order-001 → 2 rows)
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('orders')
            .columns('orders.order_id AS order_id', 'order_items.book_id AS book_id')
            .join('order_items', 'order_items.order_id = orders.order_id')
            .where('orders.order_id = ?', 'order-001')
            .orderBy('order_items.book_id')
            .run(client);
        assert.equal(result.rowCount, 2, `BC-6: expected 2 join rows for order-001, got ${result.rowCount}`);
        const bookIds6 = rows(result).column('book_id').map(String);
        assert.ok(bookIds6.includes('book-001'), `BC-6: book-001 missing`);
        assert.ok(bookIds6.includes('book-003'), `BC-6: book-003 missing`);
    }

    // ==========================================================================
    // BC-7: GROUP BY + HAVING (book_id SUM(quantity) >= 2 → book-003, book-008)
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('order_items')
            .columns('book_id', 'SUM(quantity) AS total_qty')
            .groupBy('book_id')
            .having('SUM(quantity) >= ?', 2)
            .orderBy('book_id')
            .run(client);
        assert.equal(result.rowCount, 2, `BC-7: expected 2 rows, got ${result.rowCount}`);
        const rs7 = rows(result);
        const bookIds7 = rs7.column('book_id').map(String);
        assert.deepEqual(bookIds7, ['book-003', 'book-008'], `BC-7: book_ids mismatch: ${JSON.stringify(bookIds7)}`);
        assert.equal(rs7.at(0)!.number('total_qty'), 2, `BC-7: book-003 qty should be 2`);
        assert.equal(rs7.at(1)!.number('total_qty'), 2, `BC-7: book-008 qty should be 2`);
    }

    // ==========================================================================
    // BC-8: ORDER BY ASC — first Fiction book alphabetically is '1984'
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .columns('title')
            .where('genre = ?', 'Fiction')
            .orderBy('title', 'asc')
            .run(client);
        assert.equal(result.rowCount, 5, `BC-8: expected 5 Fiction rows`);
        assert.equal(
            rows(result).first()!.string('title'),
            '1984',
            `BC-8: first Fiction book alphabetically should be '1984'`,
        );
    }

    // ==========================================================================
    // BC-9: ORDER BY DESC — last alphabetically in Fiction → 'The Great Gatsby'
    // Fiction titles: '1984', 'Pride and Prejudice', 'The Catcher in the Rye',
    //                 'The Great Gatsby', 'To Kill a Mockingbird'
    // DESC → 'To Kill a Mockingbird' first
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .columns('title')
            .where('genre = ?', 'Fiction')
            .orderBy('title', 'desc')
            .run(client);
        assert.equal(result.rowCount, 5, `BC-9: expected 5 Fiction rows`);
        assert.equal(
            rows(result).first()!.string('title'),
            'To Kill a Mockingbird',
            `BC-9: first row DESC should be 'To Kill a Mockingbird'`,
        );
    }

    // ==========================================================================
    // BC-10: ORDER BY two columns (genre ASC, price DESC)
    // Non-Fiction has prices 18.99 and 16.99; Fantasy has 14.99.
    // First row overall = Fantasy 14.99 (F < N), then Non-Fiction 18.99, ...
    // We assert genre-then-price order on the Non-Fiction block:
    //   Non-Fiction rows: Sapiens(18.99) before Educated(16.99).
    // ==========================================================================
    {
        const result = await QueryBuilder
            .select('books')
            .columns('book_id', 'genre', 'price')
            .where('genre != ?', 'Fiction')
            .orderBy('genre', 'asc')
            .orderBy('price', 'desc')
            .run(client);
        // Fantasy (1 book) + Non-Fiction (2 books) = 3 rows
        assert.equal(result.rowCount, 3, `BC-10: expected 3 non-Fiction rows, got ${result.rowCount}`);
        const rs10 = rows(result);
        // genre ASC: Fantasy < Non-Fiction; first row genre=Fantasy
        assert.equal(rs10.at(0)!.string('genre'), 'Fantasy', `BC-10: row[0] genre should be Fantasy`);
        // Non-Fiction rows: price DESC → 18.99 before 16.99
        assert.equal(rs10.at(1)!.number('price'), 18.99, `BC-10: row[1] price should be 18.99 (Sapiens)`);
        assert.equal(rs10.at(2)!.number('price'), 16.99, `BC-10: row[2] price should be 16.99 (Educated)`);
    }

    // ==========================================================================
    // BC-11: LIMIT only
    // ==========================================================================
    {
        const qb = QueryBuilder
            .select('books')
            .columns('book_id')
            .orderBy('book_id')
            .limit(3);

        // Dialect-correct pagination in compiled SQL
        const { text } = qb.toSql(client.dialect);
        if (e === 'mssql' || e === 'oracle') {
            assert.ok(text.includes('FETCH NEXT'), `BC-11: expected FETCH NEXT in SQL, got: ${text}`);
        } else {
            assert.ok(text.includes('LIMIT'), `BC-11: expected LIMIT in SQL, got: ${text}`);
        }

        const result = await qb.run(client);
        assert.equal(result.rowCount, 3, `BC-11: expected 3 rows with LIMIT 3, got ${result.rowCount}`);
    }

    // ==========================================================================
    // BC-12: OFFSET only with ORDER BY
    // Books ordered by book_id: [book-001, book-002, book-003, ...]; offset 5 → 3 rows
    // ==========================================================================
    {
        const qb = QueryBuilder
            .select('books')
            .columns('book_id')
            .orderBy('book_id')
            .offset(5);

        // Dialect-correct offset in compiled SQL
        const { text } = qb.toSql(client.dialect);
        if (e === 'mssql' || e === 'oracle') {
            assert.ok(text.includes('OFFSET'), `BC-12: expected OFFSET in SQL, got: ${text}`);
            assert.ok(text.includes('ROWS'), `BC-12: expected ROWS in SQL, got: ${text}`);
        } else {
            assert.ok(text.includes('OFFSET'), `BC-12: expected OFFSET in SQL, got: ${text}`);
        }

        const result = await qb.run(client);
        assert.equal(result.rowCount, 3, `BC-12: expected 3 rows at offset 5 (8 books total), got ${result.rowCount}`);
    }

    // ==========================================================================
    // BC-13: LIMIT + OFFSET — books ordered by book_id, skip 2, take 3
    // Expected: [book-003, book-004, book-005]
    // ==========================================================================
    {
        const qb = QueryBuilder
            .select('books')
            .columns('book_id')
            .orderBy('book_id')
            .offset(2)
            .limit(3);

        const { text } = qb.toSql(client.dialect);
        if (e === 'mssql' || e === 'oracle') {
            assert.ok(
                text.includes('OFFSET') && text.includes('FETCH NEXT'),
                `BC-13: expected OFFSET..FETCH NEXT in SQL, got: ${text}`,
            );
        } else {
            assert.ok(text.includes('LIMIT'), `BC-13: expected LIMIT in SQL, got: ${text}`);
            assert.ok(text.includes('OFFSET'), `BC-13: expected OFFSET in SQL, got: ${text}`);
        }

        const result = await qb.run(client);
        assert.equal(result.rowCount, 3, `BC-13: expected 3 rows, got ${result.rowCount}`);
        const ids13 = rows(result).column('book_id').map(String);
        assert.deepEqual(ids13, ['book-003', 'book-004', 'book-005'], `BC-13: ids mismatch: ${JSON.stringify(ids13)}`);
    }

    // ==========================================================================
    // BC-14: INSERT → SELECT-back → UPDATE → DELETE (using books table, temp id)
    // ==========================================================================
    {
        const tempId = 'bc-crud-tmp';

        // INSERT via builder
        const insResult = await QueryBuilder
            .insert('books')
            .values({
                book_id: tempId,
                title: 'Builder Test Book',
                author: 'Builder Author',
                genre: 'Fiction',
                description: 'A builder-inserted book.',
                price: 3.99,
                cover_image: null,
                stock: 5,
                isbn: null,
            })
            .run(client);
        assert.equal(insResult.rowCount, 1, `BC-14 INSERT: expected rowCount=1, got ${insResult.rowCount}`);

        try {
            // SELECT-back
            const selResult = await QueryBuilder
                .select('books')
                .columns('title', 'price', 'stock')
                .where('book_id = ?', tempId)
                .run(client);
            assert.equal(selResult.rowCount, 1, `BC-14 SELECT-back: expected 1 row`);
            const bc14sel = rows(selResult).one();
            assert.equal(bc14sel.string('title'), 'Builder Test Book', `BC-14 SELECT-back: title mismatch`);
            assert.equal(bc14sel.number('price'), 3.99, `BC-14 SELECT-back: price should be 3.99`);
            assert.equal(bc14sel.number('stock'), 5, `BC-14 SELECT-back: stock should be 5`);

            // UPDATE
            const updResult = await QueryBuilder
                .update('books')
                .set({ price: 4.99, stock: 10 })
                .where('book_id = ?', tempId)
                .run(client);
            assert.equal(updResult.rowCount, 1, `BC-14 UPDATE: expected rowCount=1, got ${updResult.rowCount}`);

            // Verify UPDATE took effect
            const selAfterUpd = await QueryBuilder
                .select('books')
                .columns('price', 'stock')
                .where('book_id = ?', tempId)
                .run(client);
            const bc14upd = rows(selAfterUpd).one();
            assert.equal(bc14upd.number('price'), 4.99, `BC-14 UPDATE verify: price should be 4.99`);
            assert.equal(bc14upd.number('stock'), 10, `BC-14 UPDATE verify: stock should be 10`);

            // DELETE
            const delResult = await QueryBuilder
                .delete('books')
                .where('book_id = ?', tempId)
                .run(client);
            assert.equal(delResult.rowCount, 1, `BC-14 DELETE: expected rowCount=1, got ${delResult.rowCount}`);

            // Verify DELETE removed the row
            const selAfterDel = await QueryBuilder
                .select('books')
                .where('book_id = ?', tempId)
                .run(client);
            assert.equal(selAfterDel.rowCount, 0, `BC-14 DELETE verify: expected 0 rows`);
        } finally {
            await QueryBuilder.delete('books').where('book_id = ?', tempId).run(client).catch(() => {});
        }
    }

    // ==========================================================================
    // BC-15: .toSql(client.dialect) placeholder/quoting spot-check for the engine
    // ==========================================================================
    {
        const qb = QueryBuilder
            .select('books')
            .columns('book_id', 'title')
            .where('genre = ?', 'Fiction')
            .where('stock > ?', 5)
            .orderBy('title')
            .limit(2);

        const { text, values } = qb.toSql(client.dialect);

        // Values array should have exactly 2 params (genre + stock threshold)
        assert.equal(values.length, 2, `BC-15: expected 2 values in toSql, got ${values.length}`);
        assert.equal(values[0], 'Fiction', `BC-15: values[0] should be 'Fiction'`);
        assert.equal(values[1], 5, `BC-15: values[1] should be 5`);

        // The SQL text should contain the table (quoted per dialect) and the correct placeholder style
        if (e === 'postgres') {
            assert.ok(text.includes('"books"'), `BC-15 pg: table should be quoted as "books"`);
            assert.ok(text.includes('$1') && text.includes('$2'), `BC-15 pg: should use $1/$2 placeholders`);
        } else if (e === 'mysql') {
            assert.ok(text.includes('`books`'), `BC-15 mysql: table should be quoted as \`books\``);
            assert.ok(text.match(/\?.*\?/s), `BC-15 mysql: should use ? placeholders`);
        } else if (e === 'sqlite') {
            assert.ok(text.includes('"books"'), `BC-15 sqlite: table should be quoted as "books"`);
            assert.ok(text.match(/\?.*\?/s), `BC-15 sqlite: should use ? placeholders`);
        } else if (e === 'mssql') {
            assert.ok(text.includes('[books]'), `BC-15 mssql: table should be quoted as [books]`);
            assert.ok(text.includes('@p1') && text.includes('@p2'), `BC-15 mssql: should use @p1/@p2 placeholders`);
        } else if (e === 'oracle') {
            assert.ok(text.includes('books'), `BC-15 oracle: table 'books' should appear in text`);
            assert.ok(text.includes(':1') && text.includes(':2'), `BC-15 oracle: should use :1/:2 placeholders`);
        }
    }

    // ==========================================================================
    // BC-16: multi-row INSERT — one statement, two rows, rowCount=2
    // ==========================================================================
    {
        const ids = ['bc-multi-1', 'bc-multi-2'];
        try {
            const ins = await QueryBuilder
                .insert('books')
                .values(ids.map((id, i) => ({
                    book_id: id,
                    title: `Multi Row ${i + 1}`,
                    author: 'Builder Author',
                    genre: 'Fiction',
                    description: 'Multi-row insert test.',
                    price: 1.99 + i,
                    cover_image: null,
                    stock: i,
                    isbn: null,
                })))
                .run(client);
            assert.equal(ins.rowCount, 2, `BC-16 INSERT: expected rowCount=2, got ${ins.rowCount}`);

            const sel = await QueryBuilder
                .select('books')
                .columns('book_id', 'title')
                .where('book_id IN (?, ?)', ...ids)
                .orderBy('book_id')
                .run(client);
            assert.deepEqual(rows(sel).column('book_id').map(String), ids, `BC-16 SELECT-back: ids mismatch`);
        } finally {
            await QueryBuilder.delete('books').where('book_id IN (?, ?)', ...ids).run(client).catch(() => {});
        }
    }

    // ==========================================================================
    // BC-17: RETURNING/OUTPUT — writes hand back rows on postgres/sqlite/mssql;
    // mysql/oracle reject at compile time with UnsupportedEngineException
    // ==========================================================================
    {
        const tempId = 'bc-ret-tmp';
        const row = {
            book_id: tempId,
            title: 'Returning Test Book',
            author: 'Builder Author',
            genre: 'Fiction',
            description: 'RETURNING test.',
            price: 5.49,
            cover_image: null,
            stock: 7,
            isbn: null,
        };
        if (e === 'mysql' || e === 'oracle') {
            assert.throws(
                () => QueryBuilder.insert('books').values(row).returning('book_id').toSql(client.dialect),
                UnsupportedEngineException,
                `BC-17 ${e}: returning() should throw UnsupportedEngineException`,
            );
        } else {
            try {
                const ins = await QueryBuilder.insert('books').values(row).returning('book_id', 'title').run(client);
                const insRow = rows(ins).one();
                assert.equal(insRow.string('book_id'), tempId, `BC-17 INSERT..RETURNING: book_id mismatch`);
                assert.equal(insRow.string('title'), 'Returning Test Book', `BC-17 INSERT..RETURNING: title mismatch`);

                const upd = await QueryBuilder
                    .update('books')
                    .set({ stock: 9 })
                    .where('book_id = ?', tempId)
                    .returning('stock')
                    .run(client);
                assert.equal(rows(upd).one().number('stock'), 9, `BC-17 UPDATE..RETURNING: stock should be 9`);

                const del = await QueryBuilder
                    .delete('books')
                    .where('book_id = ?', tempId)
                    .returning()
                    .run(client);
                assert.equal(rows(del).one().string('book_id'), tempId, `BC-17 DELETE..RETURNING: book_id mismatch`);
            } finally {
                await QueryBuilder.delete('books').where('book_id = ?', tempId).run(client).catch(() => {});
            }
        }
    }
}
