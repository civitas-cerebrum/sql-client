import assert from 'node:assert/strict';
import { getValue, getString, getNumber, getBoolean } from '../src/result/accessors';

const row = { title: 'To Kill a Mockingbird', price: '12.99', stock: 15, active: 1, sold: 't', missingNull: null };
const oracleRow = { TITLE: '1984', PRICE: '11.99' };

// getValue: case-insensitive, null-aware, absent→undefined
assert.equal(getValue(row, 'title'), 'To Kill a Mockingbird');
assert.equal(getValue(oracleRow, 'title'), '1984');           // UPPERCASE key (Oracle)
assert.equal(getValue(row, 'missingNull'), null);             // present-null → null
assert.equal(getValue(row, 'nope'), undefined);               // absent → undefined

// getString
assert.equal(getString(row, 'title'), 'To Kill a Mockingbird');
assert.equal(getString(row, 'price'), '12.99');
assert.equal(getString(row, 'missingNull'), null);
assert.equal(getString(row, 'nope'), undefined);

// getNumber (decimal-as-string → number)
assert.equal(getNumber(row, 'price'), 12.99);
assert.equal(getNumber(oracleRow, 'price'), 11.99);
assert.equal(getNumber(row, 'stock'), 15);
assert.equal(getNumber(row, 'missingNull'), null);
assert.equal(getNumber(row, 'nope'), undefined);

// getBoolean (engine variants)
assert.equal(getBoolean(row, 'active'), true);                // 1
assert.equal(getBoolean(row, 'sold'), true);                  // 't'
assert.equal(getBoolean({ x: 0 }, 'x'), false);
assert.equal(getBoolean({ x: 'false' }, 'x'), false);
assert.equal(getBoolean({ x: true }, 'x'), true);
assert.equal(getBoolean(row, 'missingNull'), null);
assert.equal(getBoolean(row, 'nope'), undefined);
assert.throws(() => getBoolean({ x: 'maybe' }, 'x'), RangeError);

console.log('result.test.ts core PASSED');

import { getColumn, findRow, filterRows, getScalar } from '../src/result/accessors';

const books = [
    { book_id: 'book-001', genre: 'Fiction', price: '12.99' },
    { book_id: 'book-006', genre: 'Non-Fiction', price: '18.99' },
    { book_id: 'book-008', genre: 'Fantasy', price: '14.99' },
];

// getColumn
assert.deepEqual(getColumn(books, 'book_id'), ['book-001', 'book-006', 'book-008']);

// findRow (loose String() compare, case-insensitive key)
assert.equal(findRow(books, { genre: 'Fantasy' })?.book_id, 'book-008');
assert.equal(findRow(books, { GENRE: 'Non-Fiction' })?.book_id, 'book-006'); // UPPERCASE key in partial
assert.equal(findRow(books, { genre: 'Horror' }), undefined);

// filterRows
assert.equal(filterRows(books, { genre: 'Fiction' }).length, 1);
assert.equal(filterRows(books, { genre: 'Nope' }).length, 0);

// getScalar — named column from first row, then field-based default
const result = { rows: [{ n: '8' }], rowCount: 1, fields: [{ name: 'n', dataTypeID: 0 }] };
assert.equal(getScalar(result, 'n'), '8');
assert.equal(getScalar(result), '8');                  // defaults to first field
assert.equal(getScalar({ rows: [], rowCount: 0, fields: [] }), undefined); // empty

console.log('result.test.ts collections PASSED');
