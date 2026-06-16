/**
 * QueryBuilder terminals + SqlClient conveniences against a real sqlite ':memory:'
 * database (zero infra). Covers: run(tx) inside client.transaction() (the tx handle
 * carries the dialect), fetch/one/maybeOne/scalar, count/exists, client.fetch, ping.
 */
import assert from 'node:assert/strict';
import { SqlClient } from '../src/client/SqlClient';
import { QueryBuilder } from '../src/builder/QueryBuilder';
import { SqlException, ResultError } from '../src/exceptions/SqlException';

async function main() {
    const db = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });
    await db.execute('CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT, genre TEXT, price REAL)');
    await QueryBuilder.insert('books')
        .values([
            { book_id: 'b1', title: 'Dune', genre: 'SciFi', price: 9.99 },
            { book_id: 'b2', title: '1984', genre: 'Fiction', price: 7.49 },
            { book_id: 'b3', title: 'Emma', genre: 'Fiction', price: 5.0 },
        ])
        .run(db);

    // transaction handle carries the dialect → builder statements run inside the tx
    await db.transaction(async (tx) => {
        await QueryBuilder.insert('books').values({ book_id: 'b4', title: 'Tx', genre: 'Fiction', price: 1 }).run(tx);
        const inTx = await QueryBuilder.select('books').where('book_id = ?', 'b4').one(tx);
        assert.equal(inTx.string('title'), 'Tx');
    });
    assert.equal(await QueryBuilder.select('books').count(db), 4);

    // throw inside the callback → rolled back
    await assert.rejects(
        db.transaction(async (tx) => {
            await QueryBuilder.delete('books').where('book_id = ?', 'b4').run(tx);
            throw new Error('boom');
        }),
        /boom/,
    );
    assert.equal(await QueryBuilder.select('books').where('book_id = ?', 'b4').count(db), 1);
    await QueryBuilder.delete('books').where('book_id = ?', 'b4').run(db);
    console.log('builder-terminals.test.ts TRANSACTION PASSED');

    // fetch → ResultSet
    const fiction = await QueryBuilder.select('books').where('genre = ?', 'Fiction').orderBy('title').fetch(db);
    assert.equal(fiction.length, 2);
    assert.deepEqual(fiction.column('title'), ['1984', 'Emma']);

    // one / maybeOne / scalar
    const dune = await QueryBuilder.select('books').where('book_id = ?', 'b1').one(db);
    assert.equal(dune.string('title'), 'Dune');
    await assert.rejects(QueryBuilder.select('books').where('genre = ?', 'Fiction').one(db), ResultError);
    assert.equal(await QueryBuilder.select('books').where('book_id = ?', 'nope').maybeOne(db), undefined);
    assert.equal(await QueryBuilder.select('books').columns('title').where('book_id = ?', 'b2').scalar<string>(db), '1984');
    assert.equal(await QueryBuilder.select('books').where('book_id = ?', 'b2').scalar<number>(db, 'price'), 7.49);
    console.log('builder-terminals.test.ts RESULT TERMINALS PASSED');

    // count / exists honour only the WHERE clauses
    assert.equal(await QueryBuilder.select('books').count(db), 3);
    assert.equal(await QueryBuilder.select('books').where('genre = ?', 'Fiction').count(db), 2);
    assert.equal(await QueryBuilder.select('books').whereIn('book_id', ['b1', 'b3']).count(db), 2);
    assert.equal(await QueryBuilder.select('books').whereNotNull('title').count(db), 3);
    assert.equal(await QueryBuilder.select('books').where('genre = ?', 'Fiction').exists(db), true);
    assert.equal(await QueryBuilder.select('books').where('genre = ?', 'Horror').exists(db), false);
    // ambiguous shapes are rejected rather than silently miscounted
    await assert.rejects(QueryBuilder.select('books').groupBy('genre').count(db), SqlException);
    await assert.rejects(QueryBuilder.select('books').join('t', 't.id = books.book_id').count(db), SqlException);
    await assert.rejects(QueryBuilder.select('books').having('COUNT(*) > ?', 1).count(db), SqlException);
    console.log('builder-terminals.test.ts COUNT/EXISTS PASSED');

    // client conveniences: fetch + ping
    const rs = await db.fetch('SELECT title FROM books WHERE genre = ? ORDER BY title', ['Fiction']);
    assert.deepEqual(rs.column('title'), ['1984', 'Emma']);
    await db.ping();

    await db.end();
    console.log('builder-terminals.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
