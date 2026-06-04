import assert from 'node:assert/strict';
import { QueryBuilder } from '../src/builder/QueryBuilder';
import { PostgresDialect, MssqlDialect, OracleDialect } from '../src/builder/Dialect';

// Postgres: LIMIT/OFFSET
{
    const { text } = QueryBuilder.select('books').orderBy('title').limit(5).offset(2).toSql(new PostgresDialect());
    assert.equal(text, 'SELECT * FROM "books" ORDER BY "title" asc LIMIT 5 OFFSET 2');
}
// SQL Server: OFFSET..FETCH, bracket quoting
{
    const { text } = QueryBuilder.select('books').orderBy('title').limit(5).offset(2).toSql(new MssqlDialect());
    assert.equal(text, 'SELECT * FROM [books] ORDER BY [title] asc OFFSET 2 ROWS FETCH NEXT 5 ROWS ONLY');
}
// Oracle: OFFSET..FETCH, bare identifiers
{
    const { text } = QueryBuilder.select('books').orderBy('title').limit(5).offset(2).toSql(new OracleDialect());
    assert.equal(text, 'SELECT * FROM books ORDER BY title asc OFFSET 2 ROWS FETCH NEXT 5 ROWS ONLY');
}
console.log('pagination.test.ts PASSED');
