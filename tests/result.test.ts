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

import { rows, ResultSet, Row } from '../src/result/ResultSet';
import { ResultError } from '../src/exceptions/SqlException';

const oneResult = { rows: [{ title: '1984', price: '11.99', active: 1 }], rowCount: 1, fields: [{ name: 'title', dataTypeID: 0 }] };
const manyResult = { rows: books, rowCount: 3, fields: [{ name: 'book_id', dataTypeID: 0 }] };
const emptyResult = { rows: [] as Record<string, unknown>[], rowCount: 0, fields: [] };

// factory accepts SqlResult and a raw array
assert.ok(rows(oneResult) instanceof ResultSet);
assert.ok(rows(books) instanceof ResultSet);

// ResultSet basics
assert.equal(rows(manyResult).length, 3);
assert.equal(rows(manyResult).rowCount, 3);
assert.equal(rows(emptyResult).isEmpty(), true);
assert.equal(rows(manyResult).isEmpty(), false);

// one() / maybeOne()
const r = rows(oneResult).one();
assert.ok(r instanceof Row);
assert.throws(() => rows(emptyResult).one(), ResultError);
assert.throws(() => rows(manyResult).one(), ResultError);
assert.equal(rows(emptyResult).maybeOne(), undefined);
assert.throws(() => rows(manyResult).maybeOne(), ResultError);

// first / at
assert.equal(rows(manyResult).first()?.get('book_id'), 'book-001');
assert.equal(rows(emptyResult).first(), undefined);
assert.equal(rows(manyResult).at(2)?.get('book_id'), 'book-008');
assert.equal(rows(manyResult).at(9), undefined);

// Row accessors (delegate to functions; case-insensitive + coercion)
assert.equal(r.string('title'), '1984');
assert.equal(r.number('price'), 11.99);
assert.equal(r.boolean('active'), true);
assert.equal(r.get('title'), '1984');
assert.equal(r.has('title'), true);
assert.equal(r.has('nope'), false);
assert.deepEqual(r.raw(), { title: '1984', price: '11.99', active: 1 });

// scalar / column / find / where / map / all / raw
assert.equal(rows(oneResult).scalar(), '1984');           // first field
assert.equal(rows(oneResult).scalar('price'), '11.99');
assert.equal(rows(emptyResult).scalar(), undefined);
assert.deepEqual(rows(manyResult).column('book_id'), ['book-001', 'book-006', 'book-008']);
assert.equal(rows(manyResult).find({ genre: 'Fantasy' })?.get('book_id'), 'book-008');
assert.equal(rows(manyResult).find({ genre: 'Horror' }), undefined);
assert.equal(rows(manyResult).where({ genre: 'Fiction' }).length, 1);
assert.deepEqual(rows(manyResult).map((row) => row.get('book_id')), ['book-001', 'book-006', 'book-008']);
assert.equal(rows(manyResult).all().length, 3);
assert.ok(rows(manyResult).all()[0] instanceof Row);
assert.deepEqual(rows(manyResult).raw(), books);

console.log('result.test.ts wrapper PASSED');
