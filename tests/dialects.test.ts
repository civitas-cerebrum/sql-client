import assert from 'node:assert/strict';
import { PostgresDialect, MySqlDialect, SqliteDialect, MssqlDialect, OracleDialect } from '../src/builder/Dialect';
import { UnsupportedEngineException } from '../src/exceptions/SqlException';

// placeholders
assert.equal(new PostgresDialect().placeholder(1), '$1');
assert.equal(new MySqlDialect().placeholder(1), '?');
assert.equal(new MySqlDialect().placeholder(3), '?');
assert.equal(new SqliteDialect().placeholder(2), '?');
assert.equal(new MssqlDialect().placeholder(1), '@p1');
assert.equal(new MssqlDialect().placeholder(2), '@p2');
assert.equal(new OracleDialect().placeholder(1), ':1');
assert.equal(new OracleDialect().placeholder(2), ':2');

// identifier quoting
assert.equal(new PostgresDialect().quoteIdentifier('books'), '"books"');
assert.equal(new PostgresDialect().quoteIdentifier('we"ird'), '"we""ird"');
assert.equal(new MySqlDialect().quoteIdentifier('books'), '`books`');
assert.equal(new MySqlDialect().quoteIdentifier('we`ird'), '`we``ird`');
assert.equal(new SqliteDialect().quoteIdentifier('books'), '"books"');
assert.equal(new SqliteDialect().quoteIdentifier('we"ird'), '"we""ird"');
assert.equal(new MssqlDialect().quoteIdentifier('books'), '[books]');
assert.equal(new MssqlDialect().quoteIdentifier('we]ird'), '[we]]ird]');
assert.equal(new OracleDialect().quoteIdentifier('books'), 'books'); // bare → Oracle folds to upper

// pagination
assert.equal(new PostgresDialect().compilePagination(5, 2), ' LIMIT 5 OFFSET 2');
assert.equal(new PostgresDialect().compilePagination(5, undefined), ' LIMIT 5');
assert.equal(new PostgresDialect().compilePagination(undefined, 2), ' OFFSET 2');
assert.equal(new MySqlDialect().compilePagination(5, 2), ' LIMIT 5 OFFSET 2');
assert.equal(new MySqlDialect().compilePagination(3, undefined), ' LIMIT 3');
assert.equal(new MySqlDialect().compilePagination(undefined, 5), ' LIMIT 18446744073709551615 OFFSET 5');
assert.equal(new SqliteDialect().compilePagination(5, 2), ' LIMIT 5 OFFSET 2');
assert.equal(new SqliteDialect().compilePagination(undefined, 5), ' LIMIT -1 OFFSET 5');
assert.equal(new MssqlDialect().compilePagination(5, 2), ' OFFSET 2 ROWS FETCH NEXT 5 ROWS ONLY');
assert.equal(new MssqlDialect().compilePagination(5, undefined), ' OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
assert.equal(new MssqlDialect().compilePagination(undefined, 2), ' OFFSET 2 ROWS');
assert.equal(new MssqlDialect().compilePagination(undefined, undefined), '');
assert.equal(new OracleDialect().compilePagination(5, 2), ' OFFSET 2 ROWS FETCH NEXT 5 ROWS ONLY');
assert.equal(new OracleDialect().compilePagination(undefined, undefined), '');

// returning rows from writes (RETURNING / OUTPUT)
assert.deepEqual(
    new PostgresDialect().compileReturning(['book_id', 'title'], 'inserted'),
    { sql: 'RETURNING "book_id", "title"', placement: 'suffix' },
);
assert.deepEqual(
    new PostgresDialect().compileReturning([], 'inserted'),
    { sql: 'RETURNING *', placement: 'suffix' },
);
assert.deepEqual(
    new SqliteDialect().compileReturning(['book_id'], 'deleted'),
    { sql: 'RETURNING "book_id"', placement: 'suffix' },
);
assert.deepEqual(
    new MssqlDialect().compileReturning(['book_id', 'title'], 'inserted'),
    { sql: 'OUTPUT INSERTED.[book_id], INSERTED.[title]', placement: 'inline' },
);
assert.deepEqual(
    new MssqlDialect().compileReturning([], 'deleted'),
    { sql: 'OUTPUT DELETED.*', placement: 'inline' },
);
assert.throws(() => new MySqlDialect().compileReturning(['id'], 'inserted'), UnsupportedEngineException);
assert.throws(() => new OracleDialect().compileReturning(['id'], 'inserted'), UnsupportedEngineException);

console.log('dialects.test.ts PASSED');
