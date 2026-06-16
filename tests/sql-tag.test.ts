import assert from 'node:assert/strict';
import { sql, SqlFragment, SqlIdentifier } from '../src/builder/SqlTag';
import { PostgresDialect, MySqlDialect, MssqlDialect, OracleDialect } from '../src/builder/Dialect';
import { SqlClient } from '../src/client/SqlClient';

const pg = new PostgresDialect();
const my = new MySqlDialect();
const ms = new MssqlDialect();
const ora = new OracleDialect();

// tag returns a fragment carrying raw parts
const frag = sql`SELECT * FROM books WHERE author_id = ${7} AND price > ${9.99}`;
assert.ok(frag instanceof SqlFragment);

// placeholder numbering per dialect
assert.deepEqual(frag.render(pg), {
    text: 'SELECT * FROM books WHERE author_id = $1 AND price > $2',
    values: [7, 9.99],
});
assert.deepEqual(frag.render(my), {
    text: 'SELECT * FROM books WHERE author_id = ? AND price > ?',
    values: [7, 9.99],
});
assert.deepEqual(frag.render(ms), {
    text: 'SELECT * FROM books WHERE author_id = @p1 AND price > @p2',
    values: [7, 9.99],
});
assert.deepEqual(frag.render(ora), {
    text: 'SELECT * FROM books WHERE author_id = :1 AND price > :2',
    values: [7, 9.99],
});

// startIndex seeds the numbering (used by callers that splice fragments into larger statements)
assert.deepEqual(sql`id = ${1}`.render(pg, 3), { text: 'id = $3', values: [1] });

// nesting: an embedded fragment threads numbering through, mid-query
const cond = sql`price BETWEEN ${5} AND ${20}`;
const outer = sql`SELECT * FROM books WHERE ${cond} AND stock > ${0}`;
assert.deepEqual(outer.render(pg), {
    text: 'SELECT * FROM books WHERE price BETWEEN $1 AND $2 AND stock > $3',
    values: [5, 20, 0],
});
// ...and when a value precedes the embedded fragment
assert.deepEqual(sql`UPDATE books SET price = ${9} WHERE ${cond}`.render(pg), {
    text: 'UPDATE books SET price = $1 WHERE price BETWEEN $2 AND $3',
    values: [9, 5, 20],
});
assert.deepEqual(outer.render(ora), {
    text: 'SELECT * FROM books WHERE price BETWEEN :1 AND :2 AND stock > :3',
    values: [5, 20, 0],
});

// sql.id: identifier spliced into text, dialect-quoted, never parameterized
assert.ok(sql.id('books') instanceof SqlIdentifier);
const byId = sql`SELECT ${sql.id('title')} FROM ${sql.id('books')} WHERE id = ${1}`;
assert.deepEqual(byId.render(pg), { text: 'SELECT "title" FROM "books" WHERE id = $1', values: [1] });
assert.deepEqual(byId.render(my), { text: 'SELECT `title` FROM `books` WHERE id = ?', values: [1] });
assert.deepEqual(byId.render(ms), { text: 'SELECT [title] FROM [books] WHERE id = @p1', values: [1] });
assert.deepEqual(byId.render(ora), { text: 'SELECT title FROM books WHERE id = :1', values: [1] }); // bare → Oracle folds to upper

// dotted identifiers quote per segment
const dotted = sql`SELECT ${sql.id('a.b')} FROM t`;
assert.equal(dotted.render(pg).text, 'SELECT "a"."b" FROM t');
assert.equal(dotted.render(my).text, 'SELECT `a`.`b` FROM t');
assert.equal(dotted.render(ms).text, 'SELECT [a].[b] FROM t');
assert.equal(dotted.render(ora).text, 'SELECT a.b FROM t');

// empty interpolation
assert.deepEqual(sql`SELECT 1`.render(pg), { text: 'SELECT 1', values: [] });

// live round-trip on sqlite :memory: through client.query(sql`...`)
async function live() {
    const db = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });
    await db.execute(sql`CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, price REAL)`);
    await db.execute(sql`INSERT INTO books (id, ${sql.id('title')}, price) VALUES (${1}, ${'Dune'}, ${9.99})`);
    await db.execute(sql`INSERT INTO books (id, title, price) VALUES (${2}, ${'Solaris'}, ${12.5})`);
    const res = await db.query<{ id: number; title: string }>(
        sql`SELECT id, ${sql.id('title')} FROM books WHERE price < ${10}`,
    );
    assert.equal(res.rowCount, 1);
    assert.deepEqual(res.rows[0], { id: 1, title: 'Dune' });
    await db.end();
}

live().then(() => console.log('sql-tag.test.ts PASSED')).catch((e) => { console.error(e); process.exit(1); });
