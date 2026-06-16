import assert from 'node:assert/strict';
import { QueryFailedException, wrapQueryError, isModuleNotFound } from '../src/exceptions/SqlException';
import { SqliteDriver } from '../src/driver/SqliteDriver';

// ---------------------------------------------------------------------------
// wrapQueryError — message format
// ---------------------------------------------------------------------------
{
    const cause = new Error('relation "books" does not exist');
    const err = wrapQueryError('postgres', 'SELECT *\n   FROM books\n   WHERE id = $1', [7], cause);
    assert.ok(err instanceof QueryFailedException);
    const lines = err.message.split('\n');
    assert.equal(lines[0], 'Query failed (postgres): relation "books" does not exist');
    assert.equal(lines[1], '  sql: SELECT * FROM books WHERE id = $1', 'sql line is single-line, whitespace-collapsed');
    assert.equal(lines[2], '  params: [7]');
    assert.equal(lines.length, 3, 'matching placeholder style must not produce a hint');
    // carried properties are the originals, untouched
    assert.equal(err.sql, 'SELECT *\n   FROM books\n   WHERE id = $1');
    assert.deepEqual(err.params, [7]);
    assert.equal((err as { cause?: unknown }).cause, cause);
}

// non-Error cause stringifies
{
    const err = wrapQueryError('oracle', 'SELECT 1 FROM DUAL', [], 'ORA-00942: table or view does not exist');
    assert.equal(err.message.split('\n')[0], 'Query failed (oracle): ORA-00942: table or view does not exist');
}

// ---------------------------------------------------------------------------
// wrapQueryError — truncation
// ---------------------------------------------------------------------------
{
    const err = wrapQueryError('sqlite', `SELECT '${'x'.repeat(600)}'`, ['y'.repeat(300)], new Error('boom'));
    const [, sqlLine, paramsLine] = err.message.split('\n');
    assert.equal(sqlLine.length, '  sql: '.length + 501, 'sql truncated to 500 chars + ellipsis');
    assert.ok(sqlLine.endsWith('…'));
    assert.equal(paramsLine.length, '  params: '.length + 201, 'params truncated to 200 chars + ellipsis');
    assert.ok(paramsLine.endsWith('…'));
    assert.equal(err.sql.length, 609, '.sql property keeps the full statement');
}

// ---------------------------------------------------------------------------
// wrapQueryError — placeholder-mismatch hints
// ---------------------------------------------------------------------------
{
    // '?' on postgres
    const err = wrapQueryError('postgres', 'SELECT * FROM books WHERE id = ?', [7], new Error('syntax error at end of input'));
    assert.match(err.message, /\n {2}hint: postgres placeholders are \$1\.\.\$N; this SQL contains '\?' \(mysql\/sqlite style\)\.$/);
}
{
    // '$1' on mysql
    const err = wrapQueryError('mysql', 'SELECT * FROM books WHERE id = $1', [7], new Error('You have an error in your SQL syntax'));
    assert.match(err.message, /\n {2}hint: mysql placeholders are \?; this SQL contains '\$1' \(postgres style\)\.$/);
}
{
    // '?' on mssql
    const err = wrapQueryError('mssql', 'SELECT * FROM books WHERE id = ?', [7], new Error('Incorrect syntax near ?'));
    assert.match(err.message, /\n {2}hint: mssql placeholders are @p1\.\.@pN; this SQL contains '\?' \(mysql\/sqlite style\)\.$/);
}
{
    // '@p1' on oracle
    const err = wrapQueryError('oracle', 'SELECT * FROM books WHERE id = @p1', [7], new Error('ORA-00936'));
    assert.match(err.message, /\n {2}hint: oracle placeholders are :1\.\.:N; this SQL contains '@p1' \(mssql style\)\.$/);
}
{
    // no hint without params (a literal '?' in SQL text is not a placeholder problem)
    const err = wrapQueryError('postgres', "SELECT 'really?'", [], new Error('boom'));
    assert.ok(!err.message.includes('hint:'));
}

// ---------------------------------------------------------------------------
// isModuleNotFound — only flags the module itself being absent
// ---------------------------------------------------------------------------
{
    const missing = Object.assign(new Error("Cannot find module 'pg'"), { code: 'MODULE_NOT_FOUND' });
    assert.equal(isModuleNotFound(missing, 'pg'), true);
    const abi = new Error('NODE_MODULE_VERSION mismatch');
    assert.equal(isModuleNotFound(abi, 'pg'), false);
    const otherMissing = Object.assign(new Error("Cannot find module 'left-pad'"), { code: 'MODULE_NOT_FOUND' });
    assert.equal(isModuleNotFound(otherMissing, 'pg'), false);
}

// ---------------------------------------------------------------------------
// SqliteDriver param normalization: Date → ISO string, boolean → 1/0, undefined → null
// ---------------------------------------------------------------------------
async function sqliteNormalization() {
    const db = new SqliteDriver({ connectionString: ':memory:' });
    await db.execute('CREATE TABLE t (d TEXT, b INTEGER, n TEXT)');
    await db.execute('INSERT INTO t (d, b, n) VALUES (?, ?, ?)', [new Date('2026-01-02T03:04:05.000Z'), true, undefined]);
    await db.execute('INSERT INTO t (d, b, n) VALUES (?, ?, ?)', [new Date('2026-01-02T03:04:05.000Z'), false, 'set']);
    const res = await db.query<{ d: string; b: number; n: string | null }>('SELECT d, b, n FROM t ORDER BY b DESC');
    assert.deepEqual(res.rows, [
        { d: '2026-01-02T03:04:05.000Z', b: 1, n: null },
        { d: '2026-01-02T03:04:05.000Z', b: 0, n: 'set' },
    ]);
    await db.end();
}

sqliteNormalization()
    .then(() => console.log('driver-errors.test.ts PASSED'))
    .catch((e) => { console.error(e); process.exit(1); });
