import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlScript } from '../src/script/SqlScript';
import { SqlEngine } from '../src/models/SqlEngine';

const load = (name: string) => readFileSync(join(__dirname, 'sql', name), 'utf8');
const count = (name: string, engine: SqlEngine) => splitSqlScript(load(name), engine).length;

// Repo corpus: exact statement counts (ground truth: the files under tests/sql/).
assert.equal(count('postgres.schema.sql', 'postgres'), 11);  // 6 CREATE TABLE + 5 CREATE INDEX
assert.equal(count('postgres.seed.sql', 'postgres'), 6);     // one multi-row INSERT per table
assert.equal(count('mysql.schema.sql', 'mysql'), 11);
assert.equal(count('mysql.seed.sql', 'mysql'), 6);
assert.equal(count('sqlite.schema.sql', 'sqlite'), 11);
assert.equal(count('sqlite.seed.sql', 'sqlite'), 6);
assert.equal(count('mssql.schema.sql', 'mssql'), 17);        // 6 DROP + 6 CREATE TABLE + 5 CREATE INDEX
assert.equal(count('mssql.seed.sql', 'mssql'), 23);          // single-row INSERTs: 8+3+3+4+2+3
assert.equal(count('oracle.schema.sql', 'oracle'), 17);      // 6 PL/SQL drop blocks + 6 CREATE TABLE + 5 CREATE INDEX
assert.equal(count('oracle.seed.sql', 'oracle'), 23);

// Parity with the hand-rolled splitters these files were written for.
const oldOracleSplit = (sql: string) => sql.split(/\n\/\s*\n?/).map((s) => s.trim()).filter(Boolean);
assert.deepEqual(splitSqlScript(load('oracle.schema.sql'), 'oracle'), oldOracleSplit(load('oracle.schema.sql')));
assert.deepEqual(splitSqlScript(load('oracle.seed.sql'), 'oracle'), oldOracleSplit(load('oracle.seed.sql')));
const oldMssqlSplit = (sql: string) => sql.split(';').map((s) => s.trim()).filter(Boolean);
assert.deepEqual(splitSqlScript(load('mssql.schema.sql'), 'mssql'), oldMssqlSplit(load('mssql.schema.sql')));
assert.deepEqual(splitSqlScript(load('mssql.seed.sql'), 'mssql'), oldMssqlSplit(load('mssql.seed.sql')));
const oldSqliteSplit = (sql: string) => sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
assert.deepEqual(splitSqlScript(load('sqlite.schema.sql'), 'sqlite'), oldSqliteSplit(load('sqlite.schema.sql')));
assert.deepEqual(splitSqlScript(load('sqlite.seed.sql'), 'sqlite'), oldSqliteSplit(load('sqlite.seed.sql')));

// Semicolons inside single-quoted strings (with '' escape) do not split.
assert.deepEqual(splitSqlScript("INSERT INTO t VALUES ('a;b'); SELECT 1;"), ["INSERT INTO t VALUES ('a;b')", 'SELECT 1']);
assert.deepEqual(splitSqlScript("INSERT INTO t VALUES ('it''s; fine');"), ["INSERT INTO t VALUES ('it''s; fine')"]);

// Semicolons inside double-quoted identifiers do not split.
assert.deepEqual(splitSqlScript('SELECT "a;b" FROM t;'), ['SELECT "a;b" FROM t']);

// Semicolons inside -- line comments and /* */ block comments do not split; comments are preserved.
assert.deepEqual(splitSqlScript('SELECT 1 -- not a split; honest\n+ 2;'), ['SELECT 1 -- not a split; honest\n+ 2']);
assert.deepEqual(splitSqlScript('SELECT /* a;b */ 1; SELECT 2;'), ['SELECT /* a;b */ 1', 'SELECT 2']);

// Trim + drop empties: stray separators and whitespace yield no statements.
assert.deepEqual(splitSqlScript(' ;; \n ; '), []);
assert.deepEqual(splitSqlScript(''), []);

// oracle: BEGIN..END suppresses ';' splitting (block-closing ';' kept), '/' on its own line flushes.
const plsql = [
    'CREATE TABLE t (id NUMBER)',
    '/',
    'BEGIN',
    "    INSERT INTO t VALUES (1);",
    '    IF 1 = 1 THEN NULL; END IF;',
    'END;',
    '/',
    'INSERT INTO t VALUES (2)',
    '/',
].join('\n');
assert.deepEqual(splitSqlScript(plsql, 'oracle'), [
    'CREATE TABLE t (id NUMBER)',
    "BEGIN\n    INSERT INTO t VALUES (1);\n    IF 1 = 1 THEN NULL; END IF;\nEND;",
    'INSERT INTO t VALUES (2)',
]);
// oracle: the repo schema's drop-block shape survives as one statement, END; retained.
const dropBlock = "BEGIN EXECUTE IMMEDIATE 'DROP TABLE x'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;\n/\n";
assert.deepEqual(splitSqlScript(dropBlock, 'oracle'),
    ["BEGIN EXECUTE IMMEDIATE 'DROP TABLE x'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;"]);
// oracle: plain top-level ';' still splits outside blocks.
assert.deepEqual(splitSqlScript('SELECT 1 FROM dual; SELECT 2 FROM dual;', 'oracle'), ['SELECT 1 FROM dual', 'SELECT 2 FROM dual']);
// oracle: BEGIN/END are matched as whole words only.
assert.deepEqual(splitSqlScript('UPDATE t SET trend = 1; SELECT beginner FROM t;', 'oracle'),
    ['UPDATE t SET trend = 1', 'SELECT beginner FROM t']);

// mssql: a line consisting solely of GO (any case, trailing whitespace ok) flushes; ';' still splits.
const tsql = 'CREATE TABLE a (id INT)\nGO\nINSERT INTO a VALUES (1);\nINSERT INTO a VALUES (2)\ngo  \nSELECT * FROM a';
assert.deepEqual(splitSqlScript(tsql, 'mssql'),
    ['CREATE TABLE a (id INT)', 'INSERT INTO a VALUES (1)', 'INSERT INTO a VALUES (2)', 'SELECT * FROM a']);
// mssql: GO embedded mid-line or mid-word is not a separator.
assert.deepEqual(splitSqlScript('SELECT gold FROM mine; UPDATE t SET x = 1 -- GO\n;', 'mssql'),
    ['SELECT gold FROM mine', 'UPDATE t SET x = 1 -- GO']);

console.log('sql-script.test.ts PASSED');
