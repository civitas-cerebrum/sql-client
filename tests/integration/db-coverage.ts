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
                    .values({ book_id: tmp, title: null, author: 'A', genre: 'Fiction', price: 1.0, stock: 0, isbn: 'dc-isbn-9' })
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
                .values({ book_id: tmp, title: 'Rolled Back', author: 'A', genre: 'Fiction', price: 1.0, stock: 0, isbn: 'dc-isbn-11' })
                .run(tx);
            throw new Error('boom');  // forces ROLLBACK
        }), /boom/, `DC-11: transaction should propagate the throw`);
        const after = await QueryBuilder.select('books').where('book_id = ?', tmp).count(client);
        assert.equal(after, 0, `DC-11: rolled-back insert must leave no row`);
    }

    // The marketplace_listings `condition` column is renamed to `item_condition`
    // on Oracle (reserved word); the builder quotes the key per dialect on the rest.
    const condKey = e === 'oracle' ? 'item_condition' : 'condition';

    // =========================================================================
    // PHASE 3 — CRUD round-trips for the tables the harness never mutated
    // (books + cart_items already covered by BC-14 / UC9).
    // =========================================================================

    // DC-12: users — INSERT → SELECT-back → UPDATE → DELETE.
    {
        const tmp = 'dc-user-tmp';
        await QueryBuilder.insert('users')
            .values({ user_id: tmp, username: 'dc-temp-user', email: 'dc-temp@bookhive.test', password_hash: 'x', created_at: new Date('2026-05-01T00:00:00Z') })
            .run(client);
        try {
            const sel = await QueryBuilder.select('users').columns('username').where('user_id = ?', tmp).one(client);
            assert.equal(sel.string('username'), 'dc-temp-user', `DC-12: users SELECT-back`);
            const upd = await QueryBuilder.update('users').set({ email: 'dc-temp2@bookhive.test' }).where('user_id = ?', tmp).run(client);
            assert.equal(upd.rowCount, 1, `DC-12: users UPDATE`);
            assert.equal((await QueryBuilder.select('users').columns('email').where('user_id = ?', tmp).one(client)).string('email'), 'dc-temp2@bookhive.test', `DC-12: users UPDATE verify`);
            assert.equal((await QueryBuilder.delete('users').where('user_id = ?', tmp).run(client)).rowCount, 1, `DC-12: users DELETE`);
            assert.equal(await QueryBuilder.select('users').where('user_id = ?', tmp).count(client), 0, `DC-12: users DELETE verify`);
        } finally {
            await QueryBuilder.delete('users').where('user_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // DC-13: order_items — full lifecycle (FK to a seeded order + book).
    {
        const tmp = 'dc-oi-tmp';
        await QueryBuilder.insert('order_items')
            .values({ order_item_id: tmp, order_id: 'order-001', book_id: 'book-002', quantity: 3, price_at_purchase: 10.99 })
            .run(client);
        try {
            assert.equal((await QueryBuilder.select('order_items').columns('quantity').where('order_item_id = ?', tmp).one(client)).number('quantity'), 3, `DC-13: order_items SELECT-back`);
            await QueryBuilder.update('order_items').set({ quantity: 5 }).where('order_item_id = ?', tmp).run(client);
            assert.equal((await QueryBuilder.select('order_items').columns('quantity').where('order_item_id = ?', tmp).one(client)).number('quantity'), 5, `DC-13: order_items UPDATE verify`);
            assert.equal((await QueryBuilder.delete('order_items').where('order_item_id = ?', tmp).run(client)).rowCount, 1, `DC-13: order_items DELETE`);
        } finally {
            await QueryBuilder.delete('order_items').where('order_item_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // DC-14: marketplace_listings — full lifecycle (FK to seeded seller + book).
    {
        const tmp = 'dc-ml-tmp';
        await QueryBuilder.insert('marketplace_listings')
            .values({ listing_id: tmp, seller_id: 'user-001', book_id: 'book-002', [condKey]: 'USED_GOOD', price: 5.55, listed_at: new Date('2026-05-02T00:00:00Z'), status: 'ACTIVE' })
            .run(client);
        try {
            const sel = await QueryBuilder.select('marketplace_listings').columns('price', 'status').where('listing_id = ?', tmp).one(client);
            assert.equal(sel.number('price'), 5.55, `DC-14: listings SELECT-back price`);
            assert.equal(sel.string('status'), 'ACTIVE', `DC-14: listings SELECT-back status`);
            await QueryBuilder.update('marketplace_listings').set({ price: 6.66, status: 'SOLD' }).where('listing_id = ?', tmp).run(client);
            const upd = await QueryBuilder.select('marketplace_listings').columns('price', 'status').where('listing_id = ?', tmp).one(client);
            assert.equal(upd.number('price'), 6.66, `DC-14: listings UPDATE verify price`);
            assert.equal(upd.string('status'), 'SOLD', `DC-14: listings UPDATE verify status`);
            assert.equal((await QueryBuilder.delete('marketplace_listings').where('listing_id = ?', tmp).run(client)).rowCount, 1, `DC-14: listings DELETE`);
        } finally {
            await QueryBuilder.delete('marketplace_listings').where('listing_id = ?', tmp).run(client).catch(() => {});
        }
    }

    // =========================================================================
    // PHASE 4 — aggregates on money columns vs known seed values
    // =========================================================================

    // DC-15: SUM(price_at_purchase) = 12.99+11.99+18.99+14.99 = 58.96; AVG(books.price) = 105.92/8 = 13.24.
    {
        const sum = rows(await client.query('SELECT SUM(price_at_purchase) AS s FROM order_items')).one().number('s');
        assert.equal(sum, 58.96, `DC-15: SUM(price_at_purchase) seed total`);
        const avg = rows(await client.query('SELECT AVG(price) AS a FROM books')).one().number('a')!;
        assert.equal(Math.round(avg * 100) / 100, 13.24, `DC-15: AVG(price) seed average`);
    }

    // =========================================================================
    // PHASE 5 (cont.) — remaining UNIQUE / FK / NOT NULL rejections
    // =========================================================================

    // DC-16: UNIQUE violations on users.username and users.email.
    for (const [label, dup] of [['username', { user_id: 'dc-u1', username: 'alice', email: 'dc-u1@x.test', password_hash: 'x', created_at: new Date('2026-05-03T00:00:00Z') }],
                                ['email', { user_id: 'dc-u2', username: 'dc-uniq-user', email: 'alice@bookhive.test', password_hash: 'x', created_at: new Date('2026-05-03T00:00:00Z') }]] as const) {
        try {
            await assert.rejects(QueryBuilder.insert('users').values(dup).run(client), QueryFailedException, `DC-16: duplicate ${label} should violate UNIQUE`);
        } finally {
            await QueryBuilder.delete('users').where('user_id = ?', dup.user_id).run(client).catch(() => {});
        }
    }

    // DC-17: FK violations across every remaining FK edge. SQLite does not enforce
    // FKs by default, so the rejection is asserted only where the engine does.
    if (e !== 'sqlite') {
        const fkCases: Array<[string, string, Record<string, unknown>]> = [
            ['order_items.order_id', 'order_items', { order_item_id: 'dc-fk1', order_id: 'nope', book_id: 'book-001', quantity: 1, price_at_purchase: 1.0 }],
            ['order_items.book_id', 'order_items', { order_item_id: 'dc-fk2', order_id: 'order-001', book_id: 'nope', quantity: 1, price_at_purchase: 1.0 }],
            ['cart_items.user_id', 'cart_items', { cart_item_id: 'dc-fk3', user_id: 'nope', book_id: 'book-001', quantity: 1, added_at: new Date('2026-05-04T00:00:00Z') }],
            ['cart_items.book_id', 'cart_items', { cart_item_id: 'dc-fk4', user_id: 'user-001', book_id: 'nope', quantity: 1, added_at: new Date('2026-05-04T00:00:00Z') }],
            ['marketplace_listings.seller_id', 'marketplace_listings', { listing_id: 'dc-fk5', seller_id: 'nope', book_id: 'book-001', [condKey]: 'USED_GOOD', price: 1.0, listed_at: new Date('2026-05-04T00:00:00Z'), status: 'ACTIVE' }],
            ['marketplace_listings.book_id', 'marketplace_listings', { listing_id: 'dc-fk6', seller_id: 'user-001', book_id: 'nope', [condKey]: 'USED_GOOD', price: 1.0, listed_at: new Date('2026-05-04T00:00:00Z'), status: 'ACTIVE' }],
        ];
        for (const [label, table, row] of fkCases) {
            const idCol = Object.keys(row)[0];
            try {
                await assert.rejects(QueryBuilder.insert(table).values(row).run(client), QueryFailedException, `DC-17: ${label} should violate FK`);
            } finally {
                await QueryBuilder.delete(table).where(`${idCol} = ?`, row[idCol]).run(client).catch(() => {});
            }
        }
    }

    // DC-18: NOT NULL rejection — one representative column per remaining table.
    // (NOT-NULL enforcement is a single uniform code path, so one per table proves
    // it; books.title is already covered by DC-9. Enforced on every engine.)
    const notNullCases: Array<[string, string, Record<string, unknown>]> = [
        ['users.email', 'users', { user_id: 'dc-nn1', username: 'dc-nn1', email: null, password_hash: 'x', created_at: new Date('2026-05-05T00:00:00Z') }],
        ['orders.status', 'orders', { order_id: 'dc-nn2', user_id: 'user-001', total_price: 1.0, status: null, purchased_at: new Date('2026-05-05T00:00:00Z') }],
        ['order_items.quantity', 'order_items', { order_item_id: 'dc-nn3', order_id: 'order-001', book_id: 'book-001', quantity: null, price_at_purchase: 1.0 }],
        ['cart_items.added_at', 'cart_items', { cart_item_id: 'dc-nn4', user_id: 'user-001', book_id: 'book-001', quantity: 1, added_at: null }],
        ['marketplace_listings.status', 'marketplace_listings', { listing_id: 'dc-nn5', seller_id: 'user-001', book_id: 'book-001', [condKey]: 'USED_GOOD', price: 1.0, listed_at: new Date('2026-05-05T00:00:00Z'), status: null }],
    ];
    for (const [label, table, row] of notNullCases) {
        const idCol = Object.keys(row)[0];
        try {
            await assert.rejects(QueryBuilder.insert(table).values(row).run(client), QueryFailedException, `DC-18: null ${label} should violate NOT NULL`);
        } finally {
            await QueryBuilder.delete(table).where(`${idCol} = ?`, row[idCol]).run(client).catch(() => {});
        }
    }

    // =========================================================================
    // PHASE 6 — timestamp fidelity via ordering (tz-immune: column types vary —
    // TIMESTAMPTZ / DATETIME / TEXT / DATETIMEOFFSET — so assert relative order
    // rather than an exact instant).
    // =========================================================================

    // DC-19: two rows with distinct added_at sort in timestamp order.
    {
        const older = 'dc-ts-old', newer = 'dc-ts-new';
        await QueryBuilder.insert('cart_items').values({ cart_item_id: older, user_id: 'user-001', book_id: 'book-001', quantity: 1, added_at: new Date('2026-06-01T08:00:00Z') }).run(client);
        await QueryBuilder.insert('cart_items').values({ cart_item_id: newer, user_id: 'user-001', book_id: 'book-002', quantity: 1, added_at: new Date('2026-06-02T08:00:00Z') }).run(client);
        try {
            const ordered = await QueryBuilder.select('cart_items')
                .columns('cart_item_id')
                .whereIn('cart_item_id', [older, newer])
                .orderBy('added_at', 'desc')
                .fetch(client);
            assert.deepEqual(ordered.column('cart_item_id').map(String), [newer, older], `DC-19: timestamp ordering round-trip`);
        } finally {
            await QueryBuilder.delete('cart_items').whereIn('cart_item_id', [older, newer]).run(client).catch(() => {});
        }
    }

    // =========================================================================
    // PHASE 7 (cont.) — client lifecycle methods exercised live
    // =========================================================================

    // DC-20: ping() resolves against a healthy connection.
    await client.ping();

    // DC-21: runScript() executes a multi-statement script; verify + clean up.
    {
        // Distinct non-null isbns: SQL Server treats two NULLs in a UNIQUE column as duplicates.
        await client.runScript(
            "INSERT INTO books (book_id,title,author,genre,price,stock,isbn) VALUES ('dc-rs-1','Script One','A','Fiction',1.00,0,'dc-isbn-rs1');" +
            "INSERT INTO books (book_id,title,author,genre,price,stock,isbn) VALUES ('dc-rs-2','Script Two','A','Fiction',1.00,0,'dc-isbn-rs2');");
        try {
            assert.equal(await QueryBuilder.select('books').whereIn('book_id', ['dc-rs-1', 'dc-rs-2']).count(client), 2, `DC-21: runScript inserted both rows`);
        } finally {
            await QueryBuilder.delete('books').whereIn('book_id', ['dc-rs-1', 'dc-rs-2']).run(client).catch(() => {});
        }
    }
}
