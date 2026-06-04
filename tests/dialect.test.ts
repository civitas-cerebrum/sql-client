import assert from 'node:assert/strict';
import { PostgresDialect } from '../src/builder/Dialect';

const d = new PostgresDialect();

// placeholder() renders 1-based positional placeholders
assert.equal(d.placeholder(1), '$1');
assert.equal(d.placeholder(2), '$2');

// quoteIdentifier() double-quotes and escapes embedded quotes
assert.equal(d.quoteIdentifier('books'), '"books"');
assert.equal(d.quoteIdentifier('order_items'), '"order_items"');
assert.equal(d.quoteIdentifier('we"ird'), '"we""ird"');

console.log('dialect.test.ts PASSED');
