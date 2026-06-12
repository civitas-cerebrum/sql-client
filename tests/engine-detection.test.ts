import assert from 'node:assert/strict';
import { detectEngine } from '../src/factory/EngineFactory';

assert.equal(detectEngine('postgres://u:p@h:5432/db'), 'postgres');
assert.equal(detectEngine('postgresql://u:p@h/db'), 'postgres');
assert.equal(detectEngine('mysql://u:p@h:3306/db'), 'mysql');
assert.equal(detectEngine('mariadb://u:p@h/db'), 'mysql');
assert.equal(detectEngine('sqlite::memory:'), 'sqlite');
assert.equal(detectEngine('sqlite:///abs/path.db'), 'sqlite');
assert.equal(detectEngine('file:./local.sqlite'), 'sqlite');
assert.equal(detectEngine('mssql://u:p@h:1433/db'), 'mssql');
assert.equal(detectEngine('sqlserver://u:p@h/db'), 'mssql');
assert.equal(detectEngine('oracle://u:p@h:1521/svc'), 'oracle');
assert.equal(detectEngine('oracledb://u:p@h/svc'), 'oracle');
assert.throws(() => detectEngine('mongodb://h/db'), /Unable to detect SQL engine/);
console.log('engine-detection.test.ts PASSED');
