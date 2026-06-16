/**
 * Database Coverage Workflow — bookhive dogfooding pass.
 *
 * Exports `runDbCoverage(client)`, run on all five engines after the existing
 * use-case / lookup / builder harnesses. It closes the coverage gaps named in
 * docs/db-coverage-workflow.md:
 *
 *   Phase 7 — API-surface sweep: the 0.1.1 client/builder surface
 *     (whereIn/whereNull/whereNotNull, count/exists, fetch/one/maybeOne/scalar,
 *     the `sql` tag) exercised LIVE per engine — previously only unit/SQLite.
 *   Phase 5 — Constraints & edges: UNIQUE / NOT NULL / FK violations expect a
 *     QueryFailedException; transaction ROLLBACK leaves no trace.
 *
 * Conventions follow the rest of the harness: parametrise via the dialect,
 * read through rows()/Row, bind timestamps as Date, clean up every mutation so
 * the function is rerunnable. Seed facts are from tests/sql/*.seed.sql:
 *   books = 8 (Fiction = 5); book-001 isbn '978-0-06-112008-4'; alice = user-001.
 */

import assert from 'node:assert/strict';
import { SqlClient } from '../../src/client/SqlClient';
import { QueryBuilder } from '../../src/builder/QueryBuilder';
import { sql } from '../../src/builder/SqlTag';
import { QueryFailedException } from '../../src/exceptions/SqlException';
import { rows } from '../../src/result/ResultSet';

export async function runDbCoverage(client: SqlClient): Promise<void> {
    const e = client.engine;

    // =========================================================================
    // PHASE 7 — API-surface sweep (0.1.1), live per engine
    // =========================================================================

    // DC-1: whereIn expands one placeholder per value; threads correctly when
    // sandwiched between raw where() fragments.
    {
        const res = await QueryBuilder.select('books')
            .columns('book_id')
            .where('genre = ?', 'Fiction')
            .whereIn('book_id', ['book-001', 'book-003', 'book-006'])  // book-006 is Non-Fiction → excluded
            .orderBy('book_id')
            .fetch(client);
        assert.deepEqual(res.column('book_id').map(String), ['book-001', 'book-003'],
            `DC-1: whereIn ∩ genre filter mismatch`);
    }

    // DC-2: whereIn throws on an empty array (never compiles IN ()).
    assert.throws(() => QueryBuilder.select('books').whereIn('book_id', []),
        /non-empty/, `DC-2: empty whereIn should throw`);

    // DC-3: whereNull / whereNotNull. isbn is nullable+UNIQUE; seed rows all have
    // one, so a single temp NULL row is safe even on mssql (one NULL per UNIQUE).
    {
        const tmp = 'dc-null-isbn';
        await QueryBuilder.insert('books')
            .values({ book_id: tmp, title: 'Null Isbn', author: 'A', genre: 'Fiction', price: 1.0, stock: 0, isbn: null })
            .run(client);
        try {
            const nulls = await QueryBuilder.select('books').whereNull('isbn').fetch(client);
            assert.equal(nulls.column('book_id').map(String).includes(tmp), true, `DC-3: whereNull should find the temp row`);
            const notNull = await QueryBuilder.select('books').whereNotNull('isbn').count(client);
            assert.equal(notNull, 8, `DC-3: whereNotNull('isbn') should count the 8 seeded books`);
        } finally {
            await QueryBuilder.delete('books').where('book_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // DC-4: count() — total, filtered, and via the where surface.
    {
        assert.equal(await QueryBuilder.select('books').count(client), 8, `DC-4: total book count`);
        assert.equal(await QueryBuilder.select('books').where('genre = ?', 'Fiction').count(client), 5, `DC-4: Fiction count`);
        assert.equal(await QueryBuilder.select('orders').where('user_id = ?', 'user-001').count(client), 2, `DC-4: alice order count`);
    }

    // DC-5: exists() — present and absent.
    {
        assert.equal(await QueryBuilder.select('books').where('book_id = ?', 'book-001').exists(client), true, `DC-5: book-001 exists`);
        assert.equal(await QueryBuilder.select('books').where('book_id = ?', 'nope').exists(client), false, `DC-5: missing book absent`);
    }

    // DC-6: builder result terminals — one / maybeOne / scalar — coerce per engine.
    {
        const one = await QueryBuilder.select('books').columns('title', 'price').where('book_id = ?', 'book-003').one(client);
        assert.equal(one.string('title'), '1984', `DC-6: one().string`);
        assert.equal(one.number('price'), 11.99, `DC-6: one().number coerces NUMERIC-as-string`);
        const missing = await QueryBuilder.select('books').where('book_id = ?', 'nope').maybeOne(client);
        assert.equal(missing, undefined, `DC-6: maybeOne on no rows → undefined`);
        const title = await QueryBuilder.select('books').columns('title').where('book_id = ?', 'book-008').scalar<string>(client);
        assert.equal(title, 'The Hobbit', `DC-6: scalar() first cell`);
    }

    // DC-7: the `sql` tag compiles to engine-correct placeholders; sql.id() quotes
    // an identifier; a nested fragment threads placeholder numbering. Live round-trip.
    {
        const genre = 'Fiction', maxPrice = 10;
        const res = rows(await client.query(
            sql`SELECT ${sql.id('book_id')} FROM books WHERE genre = ${genre} AND price < ${maxPrice} ${sql`ORDER BY book_id`}`));
        // Fiction under $10: book-004 (9.99), book-005 (8.99)
        assert.deepEqual(res.column('book_id').map(String), ['book-004', 'book-005'], `DC-7: sql tag round-trip`);
    }

    // =========================================================================
    // PHASE 5 — Constraints & edges (adversarial)
    // =========================================================================

    // DC-8: UNIQUE violation — duplicate isbn is rejected.
    {
        const tmp = 'dc-dup-isbn';
        try {
            await assert.rejects(
                QueryBuilder.insert('books')
                    .values({ book_id: tmp, title: 'Dup', author: 'A', genre: 'Fiction', price: 1.0, stock: 0, isbn: '978-0-06-112008-4' }) // book-001's isbn
                    .run(client),
                QueryFailedException, `DC-8: duplicate isbn should violate UNIQUE`);
        } finally {
            await QueryBuilder.delete('books').where('book_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // DC-9: NOT NULL violation — a null title is rejected.
    {
        const tmp = 'dc-null-title';
        try {
            await assert.rejects(
                QueryBuilder.insert('books')
                    .values({ book_id: tmp, title: null, author: 'A', genre: 'Fiction', price: 1.0, stock: 0, isbn: null })
                    .run(client),
                QueryFailedException, `DC-9: null title should violate NOT NULL`);
        } finally {
            await QueryBuilder.delete('books').where('book_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // DC-10: FK violation — an order referencing a missing user is rejected.
    // SQLite does not enforce foreign keys unless PRAGMA foreign_keys = ON (off by
    // default in better-sqlite3), so the rejection is only asserted where the
    // engine enforces FKs by default.
    if (e !== 'sqlite') {
        const tmp = 'dc-fk-order';
        try {
            await assert.rejects(
                QueryBuilder.insert('orders')
                    .values({ order_id: tmp, user_id: 'user-does-not-exist', total_price: 1.0, status: 'PENDING', purchased_at: new Date('2026-05-01T00:00:00Z') })
                    .run(client),
                QueryFailedException, `DC-10: missing user_id should violate FK`);
        } finally {
            await QueryBuilder.delete('orders').where('order_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // DC-11: transaction ROLLBACK integrity — a failing transaction leaves no trace.
    {
        const tmp = 'dc-rollback';
        await assert.rejects(client.transaction(async (tx) => {
            await QueryBuilder.insert('books')
                .values({ book_id: tmp, title: 'Rolled Back', author: 'A', genre: 'Fiction', price: 1.0, stock: 0, isbn: null })
                .run(tx);
            throw new Error('boom');  // forces ROLLBACK
        }), /boom/, `DC-11: transaction should propagate the throw`);
        const after = await QueryBuilder.select('books').where('book_id = ?', tmp).count(client);
        assert.equal(after, 0, `DC-11: rolled-back insert must leave no row`);
    }
}
